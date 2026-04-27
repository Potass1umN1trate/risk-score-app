import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { LoginForm } from "@/components/LoginForm";
import Link from "next/link";

export default async function LoginPage() {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="narrow-page">
      <h1>Sign in</h1>
      <p className="muted-text">
        Use your account email and password to access risk analysis tools.
      </p>
      <LoginForm />
      <p className="muted-text" style={{ marginTop: "1rem", textAlign: "center" }}>
        No account?{" "}
        <Link href="/register">
          Create one
        </Link>
      </p>
    </div>
  );
}
