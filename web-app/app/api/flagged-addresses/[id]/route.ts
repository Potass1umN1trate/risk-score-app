import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { authorizeFreshUser } from "@/lib/authz";
import {
  getFlaggedAddressById,
  updateFlaggedAddress,
  deactivateFlaggedAddress,
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const authz = await authorizeFreshUser(session?.user.id, "moderator");
  if (!authz.ok) return authError(authz);

  const { id } = await params;

  try {
    const record = await getFlaggedAddressById(id);
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(record);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const authz = await authorizeFreshUser(session?.user.id, "moderator");
  if (!authz.ok) return authError(authz);

  const { id } = await params;

  // Ownership: moderator may only edit own records; admin may edit any.
  if (authz.user.role !== "admin") {
    try {
      const record = await getFlaggedAddressById(id);
      if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (record.created_by_user_id !== authz.user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const patch: { risk_category_code?: string; comment?: string | null } = {};
  if (typeof b.risk_category_code === "string") {
    patch.risk_category_code = b.risk_category_code.trim();
  }
  if ("comment" in b) {
    patch.comment = typeof b.comment === "string" ? b.comment.trim() || null : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const updated = await updateFlaggedAddress(id, patch);
    if (!updated) return NextResponse.json({ error: "Not found or already deactivated" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.startsWith("Unknown risk category")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const authz = await authorizeFreshUser(session?.user.id, "moderator");
  if (!authz.ok) return authError(authz);

  const { id } = await params;

  // Ownership: moderator may only deactivate own records; admin may deactivate any.
  try {
    const record = await getFlaggedAddressById(id);
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (authz.user.role !== "admin" && record.created_by_user_id !== authz.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const deactivated = await deactivateFlaggedAddress(id);
    if (!deactivated) {
      return NextResponse.json({ error: "Record not found or already deactivated" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
