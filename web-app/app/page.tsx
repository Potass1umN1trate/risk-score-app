import Link from "next/link";

export default function Home() {
  return (
    <div style={{ maxWidth: 560, paddingTop: "3rem" }}>
      <h1 style={{ fontSize: "1.8rem", marginBottom: "0.75rem" }}>
        Crypto Address Risk Analysis
      </h1>
      <p style={{ color: "var(--color-muted)", marginBottom: "2rem" }}>
        Submit a blockchain address to score it for risk signals using on-chain
        graph analysis and machine learning.
      </p>
      <Link href="/analyze" className="btn" style={{ display: "inline-block" }}>
        Analyze an address →
      </Link>
    </div>
  );
}
