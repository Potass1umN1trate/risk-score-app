import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { SignUpForm } from "@/components/SignUpForm";

export default async function RegisterPage() {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="narrow-page">
      <h1>Create account</h1>
      <p className="muted-text">
        Register to access risk analysis tools.
      </p>
      <SignUpForm />
    </div>
  );
}
