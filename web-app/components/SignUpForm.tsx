"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

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
    <div className="card auth-card">
      <form onSubmit={handleSubmit} noValidate>
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
      </form>

      <div className="oauth-divider">
        <span>or</span>
      </div>

      <button
        type="button"
        className="btn btn-secondary btn-github"
        onClick={() => signIn("github", { callbackUrl: "/dashboard" })}
      >
        <GitHubIcon />
        Continue with GitHub
      </button>

      <p className="muted-text" style={{ marginTop: "1rem", textAlign: "center" }}>
        Already have an account?{" "}
        <Link href="/login">
          Sign in
        </Link>
      </p>
    </div>
  );
}
