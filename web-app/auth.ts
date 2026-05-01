import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import { findUserByEmail, findOrCreateOAuthUser, logAuditEvent } from "@/lib/db";
import { comparePassword } from "@/lib/password";

if (!process.env.AUTH_SECRET && !process.env.NEXTAUTH_SECRET) {
  throw new Error(
    "AUTH_SECRET is not set. Set AUTH_SECRET in your .env.local before starting the app."
  );
}

export const authOptions: NextAuthOptions = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    }),
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password ?? "";

        if (!email || !password) return null;

        let user: Awaited<ReturnType<typeof findUserByEmail>> = null;
        try {
          user = await findUserByEmail(email);
        } catch {
          return null;
        }

        // Blocked user — deny before password check.
        if (user?.isBlocked) {
          void logAuditEvent({
            userId: user.id,
            action: "LOGIN_FAILURE",
            entity: "user",
            entityId: user.id,
            details: { email, reason: "blocked", role: user.role },
          });
          return null;
        }

        // No password hash — OAuth-only account or missing credentials.
        if (!user?.passwordHash) {
          void logAuditEvent({
            userId: user?.id ?? null,
            action: "LOGIN_FAILURE",
            entity: "user",
            entityId: user?.id ?? null,
            details: { email, reason: "missing_hash", role: user?.role ?? null },
          });
          return null;
        }

        let passwordMatches: boolean;
        try {
          passwordMatches = await comparePassword(password, user.passwordHash);
        } catch {
          return null;
        }

        if (!passwordMatches) {
          void logAuditEvent({
            userId: user.id,
            action: "LOGIN_FAILURE",
            entity: "user",
            entityId: user.id,
            details: { email, reason: "wrong_password", role: user.role },
          });
          return null;
        }

        void logAuditEvent({
          userId: user.id,
          action: "LOGIN_SUCCESS",
          entity: "user",
          entityId: user.id,
          details: { email: user.email, role: user.role },
        });

        return {
          id: user.id,
          email: user.email,
          role: user.role,
          isBlocked: user.isBlocked,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "github") {
        const email = profile?.email;
        if (!email) return false;

        try {
          const user = await findOrCreateOAuthUser(
            account.provider,
            account.providerAccountId,
            email
          );
          if (user.isBlocked) return false;
          void logAuditEvent({
            userId: user.id,
            action: "OAUTH_LOGIN_SUCCESS",
            entity: "user",
            entityId: user.id,
            details: { email: user.email, role: user.role, provider: account.provider },
          });
          return true;
        } catch {
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user, account, profile }) {
      // Credentials path: user object populated by authorize().
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.role = user.role;
        token.isBlocked = user.isBlocked;
      }

      // GitHub OAuth path: first sign-in, account is present.
      if (account?.provider === "github" && profile?.email) {
        try {
          const dbUser = await findOrCreateOAuthUser(
            account.provider,
            account.providerAccountId,
            profile.email
          );
          token.id = dbUser.id;
          token.email = dbUser.email;
          token.role = dbUser.role;
          token.isBlocked = dbUser.isBlocked;
        } catch {
          // Propagate failure by leaving claims unset; middleware will deny.
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.id);
        session.user.email = token.email ?? session.user.email;
        session.user.role = token.role;
        session.user.isBlocked = Boolean(token.isBlocked);
      }
      return session;
    },
  },
};
