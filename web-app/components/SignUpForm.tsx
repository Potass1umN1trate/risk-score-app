"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

export function SignUpForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldError, setFieldError] = useState<Partial<Record<"email" | "password" | "confirmPassword", string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldError({});

    const errors: typeof fieldError = {};
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      errors.email = "Enter a valid email address";
    }
    if (password.length < 8) {
      errors.password = "Password must be at least 8 characters";
    }
    if (password !== confirmPassword) {
      errors.confirmPassword = "Passwords do not match";
    }
    if (Object.keys(errors).length > 0) {
      setFieldError(errors);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          setFieldError({ email: "An account with this email already exists" });
        } else {
          setError(data.error ?? "Registration failed. Please try again.");
        }
        setLoading(false);
        return;
      }
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
      return;
    }

    const result = await signIn("credentials", {
      email: normalizedEmail,
      password,
      redirect: false,
      callbackUrl: "/dashboard",
    });

    setLoading(false);

    if (!result?.ok) {
      setError("Account created but sign-in failed. Please sign in manually.");
      return;
    }

    window.location.href = result.url ?? "/dashboard";
  }

  return (
    <form onSubmit={handleSubmit} className="card auth-card" noValidate>
      {error && <div className="alert error">{error}</div>}

      <div className="form-group">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {fieldError.email && (
          <span className="field-error">{fieldError.email}</span>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {fieldError.password && (
          <span className="field-error">{fieldError.password}</span>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="confirmPassword">Confirm password</label>
        <input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
        {fieldError.confirmPassword && (
          <span className="field-error">{fieldError.confirmPassword}</span>
        )}
      </div>

      <button type="submit" className="btn" disabled={loading}>
        {loading ? "Creating account..." : "Create account"}
      </button>

      <p className="muted-text" style={{ marginTop: "1rem", textAlign: "center" }}>
        Already have an account?{" "}
        <Link href="/login">
          Sign in
        </Link>
      </p>
    </form>
  );
}
