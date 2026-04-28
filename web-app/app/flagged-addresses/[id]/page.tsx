"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FlaggedAddressForm, type FlaggedAddressFormData } from "@/components/FlaggedAddressForm";

interface FlaggedAddressItem {
  id: string;
  network_code: string;
  network_name: string;
  address: string;
  risk_category_code: string;
  risk_category_name: string;
  comment: string | null;
  created_by_email: string | null;
  created_at: string;
  is_active: boolean;
}

interface Network { code: string; name: string; }
interface Category { code: string; name: string; }

export default function FlaggedAddressDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [record, setRecord] = useState<FlaggedAddressItem | null>(null);
  const [networks, setNetworks] = useState<Network[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/flagged-addresses/${id}`).then((r) => {
        if (r.status === 404) throw new Error("not_found");
        if (r.status === 403) throw new Error("forbidden");
        if (!r.ok) throw new Error("load_error");
        return r.json();
      }),
      fetch("/api/flagged-addresses/networks").then((r) => r.json()),
      fetch("/api/flagged-addresses/categories").then((r) => r.json()),
    ])
      .then(([rec, nets, cats]) => {
        setRecord(rec as FlaggedAddressItem);
        setNetworks(nets as Network[]);
        setCategories(cats as Category[]);
      })
      .catch((err: Error) => {
        if (err.message === "not_found") setLoadError("Record not found.");
        else if (err.message === "forbidden") setLoadError("You do not have access to this record.");
        else setLoadError("Failed to load record.");
      });
  }, [id]);

  async function handleSubmit(data: FlaggedAddressFormData) {
    const res = await fetch(`/api/flagged-addresses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        risk_category_code: data.risk_category_code,
        comment: data.comment || null,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? "Failed to update record.");
    }
    router.push("/flagged-addresses");
  }

  async function handleDeactivate() {
    if (!confirm("Deactivate this flagged address? This cannot be undone.")) return;
    setDeactivating(true);
    setDeactivateError(null);
    try {
      const res = await fetch(`/api/flagged-addresses/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDeactivateError((body as { error?: string }).error ?? "Failed to deactivate.");
        return;
      }
      router.push("/flagged-addresses");
    } catch {
      setDeactivateError("Failed to deactivate.");
    } finally {
      setDeactivating(false);
    }
  }

  if (loadError) {
    return (
      <div>
        <div className="page-header">
          <h1>Flagged Address</h1>
          <p className="muted-text"><Link href="/flagged-addresses">← Back to list</Link></p>
        </div>
        <div className="alert error">{loadError}</div>
      </div>
    );
  }

  if (!record) {
    return (
      <div>
        <div className="page-header">
          <h1>Flagged Address</h1>
        </div>
        <div className="card" style={{ textAlign: "center", color: "var(--color-muted)" }}>Loading…</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Edit flagged address</h1>
        <p className="muted-text"><Link href="/flagged-addresses">← Back to list</Link></p>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <p className="section-title">Record details</p>
        <div className="stat-row">
          <div className="stat-item">
            <label>Network</label>
            <span className="val">{record.network_code} — {record.network_name}</span>
          </div>
          <div className="stat-item">
            <label>Address</label>
            <span className="val mono" style={{ fontSize: "0.82rem", wordBreak: "break-all" }}>{record.address}</span>
          </div>
          <div className="stat-item">
            <label>Status</label>
            <span className="val" style={{ color: record.is_active ? "var(--color-low)" : "var(--color-muted)" }}>
              {record.is_active ? "Active" : "Inactive"}
            </span>
          </div>
          <div className="stat-item">
            <label>Created by</label>
            <span className="val">{record.created_by_email ?? "system"}</span>
          </div>
          <div className="stat-item">
            <label>Created at</label>
            <span className="val">{new Date(record.created_at).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {record.is_active && (
        <div className="card">
          <p className="section-title">Update</p>
          <FlaggedAddressForm
            networks={networks}
            categories={categories}
            initial={{
              network_code: record.network_code,
              address: record.address,
              risk_category_code: record.risk_category_code,
              comment: record.comment ?? "",
            }}
            submitLabel="Save changes"
            onSubmit={handleSubmit}
            onCancel={() => router.push("/flagged-addresses")}
            lockAddress
          />
        </div>
      )}

      {record.is_active && (
        <div className="card" style={{ borderColor: "var(--color-high)" }}>
          <p className="section-title" style={{ color: "var(--color-high)" }}>Deactivate</p>
          <p style={{ fontSize: "0.9rem", color: "var(--color-muted)", marginBottom: "1rem" }}>
            Soft-deletes this record. The address will no longer be flagged in future analyses.
          </p>
          {deactivateError && <div className="alert error" style={{ marginBottom: "1rem" }}>{deactivateError}</div>}
          <button
            className="btn"
            style={{ background: "var(--color-high)" }}
            onClick={handleDeactivate}
            disabled={deactivating}
          >
            {deactivating ? <><span className="spinner" />Deactivating…</> : "Deactivate address"}
          </button>
        </div>
      )}
    </div>
  );
}
