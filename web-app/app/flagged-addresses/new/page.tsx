"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FlaggedAddressForm, type FlaggedAddressFormData } from "@/components/FlaggedAddressForm";

interface Network { code: string; name: string; }
interface Category { code: string; name: string; }

export default function NewFlaggedAddressPage() {
  const router = useRouter();
  const [networks, setNetworks] = useState<Network[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/flagged-addresses/networks").then((r) => r.json()),
      fetch("/api/flagged-addresses/categories").then((r) => r.json()),
    ])
      .then(([nets, cats]) => {
        setNetworks(nets as Network[]);
        setCategories(cats as Category[]);
      })
      .catch(() => setLoadError("Failed to load form data."));
  }, []);

  async function handleSubmit(data: FlaggedAddressFormData) {
    const res = await fetch("/api/flagged-addresses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? "Failed to create record.");
    }
    router.push("/flagged-addresses");
  }

  return (
    <div>
      <div className="page-header">
        <h1>Add flagged address</h1>
        <p className="muted-text">
          <Link href="/flagged-addresses">← Back to list</Link>
        </p>
      </div>

      {loadError && <div className="alert error">{loadError}</div>}

      <div className="card">
        <FlaggedAddressForm
          networks={networks}
          categories={categories}
          submitLabel="Add flagged address"
          onSubmit={handleSubmit}
          onCancel={() => router.push("/flagged-addresses")}
        />
      </div>
    </div>
  );
}
