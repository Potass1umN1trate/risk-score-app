// pages/api/auth/[...nextauth].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import NextAuth, { type NextAuthOptions } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';
import CredentialsProvider from 'next-auth/providers/credentials';
import { ethers } from 'ethers';
import crypto from 'crypto';

import { verifyPassword, hashPassword } from '@/lib/auth-password';
import { getUserByEmail, createUserWithEmail } from '@/lib/db';
import {
  findUserByGithubId,
  linkGithubToUser,
  findUserByMetamaskAddress,
  createUserWithMetamaskAddress,
} from '@/lib/users-nextauth';
import type { UserRole } from '@/lib/types';

function getCookie(req: NextApiRequest, name: string): string | null {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function parseSignedMessage(message: string) {
  // Формат, который ты будешь подписывать на фронте:
  // Risk Score Crypto App Login
  // Domain: example.com
  // Address: 0x...
  // Nonce: abc
  // Issued At: 2025-...
  const lines = message.split('\n').map((l) => l.trim());
  const domain = lines.find((l) => l.toLowerCase().startsWith('domain:'))?.split(':').slice(1).join(':').trim();
  const address = lines.find((l) => l.toLowerCase().startsWith('address:'))?.split(':').slice(1).join(':').trim();
  const nonce = lines.find((l) => l.toLowerCase().startsWith('nonce:'))?.split(':').slice(1).join(':').trim();

  return { domain, address, nonce };
}

const APP_DOMAIN =
  process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).host : undefined;

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,

  session: { strategy: 'jwt' },

  providers: [
    // 1) Email + password
    CredentialsProvider({
      id: 'credentials',
      name: 'Email & Password',
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;

        const email = credentials.email.trim().toLowerCase();
        const user = await getUserByEmail(email);
        if (!user || !user.password_hash) return null;

        const ok = await verifyPassword(credentials.password, user.password_hash);
        if (!ok) return null;

        return {
          id: String(user.id),
          email: user.email,
          role: user.role as UserRole,
        };
      },
    }),

    // 2) GitHub OAuth
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),

    // 3) MetaMask (подпись + nonce)
    CredentialsProvider({
      id: 'metamask',
      name: 'MetaMask',
      credentials: {
        message: { label: 'Message', type: 'text' },
        signature: { label: 'Signature', type: 'text' },
      },
      async authorize(credentials, req) {
        const message = credentials?.message;
        const signature = credentials?.signature;

        if (!message || !signature) return null;

        // 1) Парсим домен/адрес/nonce из сообщения
        const { domain, address, nonce } = parseSignedMessage(message);
        if (!domain || !address || !nonce) return null;

        // 2) Domain check (защита от подписи для чужого домена)
        if (APP_DOMAIN && domain !== APP_DOMAIN) return null;

        // 3) Nonce check (anti-replay) — nonce должен совпасть с httpOnly cookie
        const apiReq = req as unknown as NextApiRequest;
        const cookieNonce = getCookie(apiReq, 'mm_nonce');
        if (!cookieNonce || cookieNonce !== nonce) return null;

        // 4) Verify signature
        let recovered: string;
        try {
          recovered = ethers.verifyMessage(message, signature);
        } catch {
          return null;
        }

        if (recovered.toLowerCase() !== address.toLowerCase()) return null;

        // 5) upsert user по адресу
        const normalized = address.toLowerCase();
        let user = await findUserByMetamaskAddress(normalized);
        if (!user) user = await createUserWithMetamaskAddress(normalized);

        return {
          id: String(user.id),
          email: user.email ?? null,
          role: user.role as UserRole,
          wallet: normalized,
        } as any;
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account, profile }) {
      // GitHub: связываем/создаем юзера и пробрасываем id/role
      if (account?.provider === 'github') {
        const githubId = account.providerAccountId;
        const email = (user.email || '').toLowerCase();

        let dbUser = await findUserByGithubId(githubId);

        if (!dbUser && email) {
          const existingByEmail = await getUserByEmail(email);
          if (existingByEmail) {
            await linkGithubToUser(existingByEmail.id, githubId);
            dbUser = existingByEmail;
          }
        }

        if (!dbUser) {
          // ❌ НЕ храним пустой пароль. Кладём рандомный хеш, чтобы нельзя было логиниться паролем.
          const fakePass = crypto.randomBytes(24).toString('hex');
          const fakeHash = await hashPassword(fakePass);

          const safeEmail = email || `${githubId}@github.local`;
          dbUser = await createUserWithEmail(safeEmail, fakeHash);
          await linkGithubToUser(dbUser.id, githubId);
        }

        (user as any).id = String(dbUser.id);
        (user as any).role = dbUser.role as UserRole;
      }

      // credentials/metamask уже возвращают id/role из authorize
      return true;
    },

    async jwt({ token, user }) {
      if (user) {
        token.userId = (user as any).id;
        token.role = (user as any).role;
        token.wallet = (user as any).wallet ?? null;
      }
      return token;
    },

    async session({ session, token }) {
      if (!session.user) session.user = {} as any;
      (session.user as any).id = token.userId as any;
      (session.user as any).role = token.role as any;
      (session.user as any).wallet = (token as any).wallet ?? null;
      return session;
    },
  },

  pages: {
    signIn: '/login',
  },
};

export default function auth(req: NextApiRequest, res: NextApiResponse) {
  return NextAuth(req, res, authOptions);
}
