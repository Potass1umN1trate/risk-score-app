import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="narrow-page">
      <h1>Unauthorized</h1>
      <p className="muted-text">
        Your account does not have access to this page or action.
      </p>
      <Link href="/dashboard" className="btn">
        Back to dashboard
      </Link>
    </div>
  );
}
