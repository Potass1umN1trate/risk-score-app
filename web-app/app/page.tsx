import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);

  return (
    <div className="narrow-page">
      <h1 style={{ fontSize: "1.8rem", marginBottom: "0.75rem" }}>
        Crypto Address Risk Analysis
      </h1>
      <p style={{ color: "var(--color-muted)", marginBottom: "2rem" }}>
        Submit a blockchain address to score it for risk signals using on-chain
        graph analysis and machine learning.
      </p>
      <Link
        href={session ? "/dashboard" : "/login"}
        className="btn"
        style={{ display: "inline-block" }}
      >
        {session ? "Open dashboard" : "Sign in"}
      </Link>
    </div>
  );
}
