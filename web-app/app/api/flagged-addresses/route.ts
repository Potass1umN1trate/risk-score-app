import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { authorizeFreshUser } from "@/lib/authz";
import {
  getFlaggedAddresses,
  createFlaggedAddress,
  type FlaggedAddressFilters,
} from "@/lib/db";

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

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const authz = await authorizeFreshUser(session?.user.id, "moderator");
  if (!authz.ok) return authError(authz);

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const rawLimit = parseInt(searchParams.get("limit") ?? "20", 10) || 20;
  const limit = Math.min(100, Math.max(1, rawLimit));
  const offset = (page - 1) * limit;

  const filters: FlaggedAddressFilters = {};
  const network = searchParams.get("network");
  const category = searchParams.get("category");
  const search = searchParams.get("search");
  const activeParam = searchParams.get("active");

  if (network) filters.network = network;
  if (category) filters.category = category;
  if (search) filters.search = search;
  if (activeParam !== null) filters.active = activeParam !== "false";

  try {
    const { items, total } = await getFlaggedAddresses(filters, limit, offset);
    return NextResponse.json({ items, total, page, limit });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const authz = await authorizeFreshUser(session?.user.id, "moderator");
  if (!authz.ok) return authError(authz);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const network_code = typeof b.network_code === "string" ? b.network_code.trim() : "";
  const address = typeof b.address === "string" ? b.address.trim() : "";
  const risk_category_code = typeof b.risk_category_code === "string" ? b.risk_category_code.trim() : "";
  const comment = typeof b.comment === "string" ? b.comment.trim() || null : null;

  if (!network_code) return NextResponse.json({ error: "network_code is required" }, { status: 400 });
  if (!address || address.length < 10 || address.length > 128) {
    return NextResponse.json({ error: "address must be 10–128 characters" }, { status: 400 });
  }
  if (!risk_category_code) return NextResponse.json({ error: "risk_category_code is required" }, { status: 400 });

  try {
    const created = await createFlaggedAddress(
      { network_code, address, risk_category_code, comment },
      authz.user.id
    );
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.startsWith("Unknown network") || msg.startsWith("Unknown risk category")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    // Unique constraint violation (network_id, address)
    if (msg.includes("unique") || msg.includes("duplicate") || (err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "This address is already flagged on this network" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
