"use client";

import { useState } from "react";

export interface FlaggedAddressFormData {
  network_code: string;
  address: string;
  risk_category_code: string;
  comment: string;
}

interface FlaggedAddressFormProps {
  networks: { code: string; name: string }[];
  categories: { code: string; name: string }[];
  initial?: Partial<FlaggedAddressFormData>;
  submitLabel: string;
  onSubmit: (data: FlaggedAddressFormData) => Promise<void>;
  onCancel?: () => void;
  lockAddress?: boolean;
}

interface FormErrors {
  network_code?: string;
  address?: string;
  risk_category_code?: string;
}

function validate(data: FlaggedAddressFormData): FormErrors {
  const errors: FormErrors = {};
  if (!data.network_code) errors.network_code = "Select a network.";
  if (!data.address.trim() || data.address.trim().length < 10) {
    errors.address = "Address must be at least 10 characters.";
  } else if (data.address.trim().length > 128) {
    errors.address = "Address must be at most 128 characters.";
  }
  if (!data.risk_category_code) errors.risk_category_code = "Select a risk category.";
  return errors;
}

export function FlaggedAddressForm({
  networks,
  categories,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  lockAddress = false,
}: FlaggedAddressFormProps) {
  const [form, setForm] = useState<FlaggedAddressFormData>({
    network_code: initial?.network_code ?? "",
    address: initial?.address ?? "",
    risk_category_code: initial?.risk_category_code ?? "",
    comment: initial?.comment ?? "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate(form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setSubmitError(null);
    setLoading(true);
    try {
      await onSubmit(form);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "An error occurred.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {submitError && <div className="alert error" style={{ marginBottom: "1rem" }}>{submitError}</div>}

      <div className="form-grid">
        <div className="form-group">
          <label htmlFor="network_code">Network</label>
          <select
            id="network_code"
            name="network_code"
            value={form.network_code}
            onChange={handleChange}
            disabled={lockAddress}
          >
            <option value="">Select network…</option>
            {networks.map((n) => (
              <option key={n.code} value={n.code}>{n.code} — {n.name}</option>
            ))}
          </select>
          {errors.network_code && <span className="field-error">{errors.network_code}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="risk_category_code">Risk category</label>
          <select
            id="risk_category_code"
            name="risk_category_code"
            value={form.risk_category_code}
            onChange={handleChange}
          >
            <option value="">Select category…</option>
            {categories.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
          {errors.risk_category_code && <span className="field-error">{errors.risk_category_code}</span>}
        </div>

        <div className="form-group full">
          <label htmlFor="address">Address</label>
          <input
            id="address"
            name="address"
            type="text"
            value={form.address}
            onChange={handleChange}
            placeholder="Enter blockchain address"
            disabled={lockAddress}
            style={{ fontFamily: "var(--font-mono)", fontSize: "0.88rem" }}
          />
          {errors.address && <span className="field-error">{errors.address}</span>}
        </div>

        <div className="form-group full">
          <label htmlFor="comment">Comment (optional)</label>
          <textarea
            id="comment"
            name="comment"
            value={form.comment}
            onChange={handleChange}
            placeholder="Add context or notes"
            rows={3}
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              color: "var(--color-text)",
              fontFamily: "inherit",
              fontSize: "0.95rem",
              padding: "0.5rem 0.75rem",
              width: "100%",
              outline: "none",
              resize: "vertical",
            }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem" }}>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? <><span className="spinner" />Saving…</> : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
