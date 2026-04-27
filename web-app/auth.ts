import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { findUserByEmail } from "@/lib/db";
import { comparePassword } from "@/lib/password";

export const authOptions: NextAuthOptions = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim();
        const password = credentials?.password ?? "";

        if (!email || !password) return null;

        try {
          const user = await findUserByEmail(email);
          if (!user?.passwordHash || user.isBlocked) return null;

          const passwordMatches = await comparePassword(password, user.passwordHash);
          if (!passwordMatches) return null;

          return {
            id: user.id,
            email: user.email,
            role: user.role,
            isBlocked: user.isBlocked,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.role = user.role;
        token.isBlocked = user.isBlocked;
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
