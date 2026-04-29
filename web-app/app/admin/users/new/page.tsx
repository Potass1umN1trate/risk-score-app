"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Role } from "@/lib/rbac";

export default function NewUserPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const errs: { email?: string; password?: string } = {};
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = "Valid email is required";
    }
    if (password.length < 8) {
      errs.password = "Password must be at least 8 characters";
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, role }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      router.push("/admin/users");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: "480px" }}>
      <div className="page-header">
        <h1>Create user</h1>
        <p className="muted-text">Add a new credentials-based user account.</p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label className="form-label" htmlFor="email">Email</label>
          <input
            id="email"
            className={`form-input${fieldErrors.email ? " input-error" : ""}`}
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {fieldErrors.email && <p className="field-error">{fieldErrors.email}</p>}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="password">Password</label>
          <input
            id="password"
            className={`form-input${fieldErrors.password ? " input-error" : ""}`}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {fieldErrors.password && <p className="field-error">{fieldErrors.password}</p>}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="role">Role</label>
          <select
            id="role"
            className="form-input"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="user">user</option>
            <option value="moderator">moderator</option>
            <option value="admin">admin</option>
          </select>
        </div>

        {error && <div className="error-banner" style={{ marginBottom: "1rem" }}>{error}</div>}

        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "Creating…" : "Create user"}
          </button>
          <Link href="/admin/users" className="btn btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
