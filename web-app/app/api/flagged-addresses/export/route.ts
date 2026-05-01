import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { authorizeFreshUser } from "@/lib/authz";
import { exportFlaggedAddresses, logAuditEvent } from "@/lib/db";

export const runtime = "nodejs";

function authError(authz: { ok: false; status: 401 | 403 | 500 }) {
  if (authz.status === 500) {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 500 });
  }
  return NextResponse.json(
    { error: authz.status === 401 ? "Authentication required" : "Forbidden" },
    { status: authz.status }
  );
}

function toCsv(items: Awaited<ReturnType<typeof exportFlaggedAddresses>>): string {
  const header = "id,network_code,address,risk_category_code,risk_category_name,comment,created_by_email,created_at,is_active";
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const rows = items.map((r) =>
    [
      r.id,
      r.network_code,
      r.address,
      r.risk_category_code,
      r.risk_category_name,
      r.comment ?? "",
      r.created_by_email ?? "",
      r.created_at,
      r.is_active,
    ]
      .map(escape)
      .join(",")
  );
  return [header, ...rows].join("\n");
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const authz = await authorizeFreshUser(session?.user.id, "moderator");
  if (!authz.ok) return authError(authz);

  const format = req.nextUrl.searchParams.get("format") ?? "json";

  try {
    const items = await exportFlaggedAddresses();

    void logAuditEvent({
      userId: authz.user.id,
      action: "FLAGGED_ADDRESS_EXPORT",
      entity: "flagged_address",
      entityId: null,
      details: { role: authz.user.role, format, count: items.length },
    });

    if (format === "csv") {
      const csv = toCsv(items);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="flagged-addresses.csv"`,
        },
      });
    }

    return new NextResponse(JSON.stringify(items, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="flagged-addresses.json"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
