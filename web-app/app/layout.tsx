import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { SignOutButton } from "@/components/SignOutButton";
import { hasRequiredRole } from "@/lib/rbac";
import "./globals.css";

export const metadata: Metadata = {
  title: "Risk Score — Crypto Address Analysis",
  description: "Analyze blockchain addresses for risk signals",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user.role;

  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="nav-inner">
            <Link href={session ? "/dashboard" : "/"} className="nav-brand">
              Risk Score
            </Link>
            <div className="nav-links">
              {session ? (
                <>
                  <Link href="/dashboard">Dashboard</Link>
                  <Link href="/analyze">Analyze</Link>
                  {role && hasRequiredRole(role, "moderator") && (
                    <Link href="/moderator">Moderator</Link>
                  )}
                  {role && hasRequiredRole(role, "admin") && (
                    <Link href="/admin">Admin</Link>
                  )}
                  <SignOutButton />
                </>
              ) : (
                <Link href="/login">Sign in</Link>
              )}
            </div>
          </div>
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
