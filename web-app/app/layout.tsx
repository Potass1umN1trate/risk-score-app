import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Risk Score — Crypto Address Analysis",
  description: "Analyze blockchain addresses for risk signals",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="nav-inner">
            <span className="nav-brand">Risk Score</span>
            <a href="/analyze">Analyze Address</a>
          </div>
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
