import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { authorizeFreshUser } from "@/lib/authz";
import {
  getFlaggedAddressById,
  updateFlaggedAddress,
  deactivateFlaggedAddress,
  activateFlaggedAddress,
  logAuditEvent,
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

function canManageFlaggedAddress(
  record: { created_by_user_id: string | null },
  user: { id: string; role: string }
): boolean {
  return user.role === "admin" || record.created_by_user_id === user.id;
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
    return NextResponse.json({
      ...record,
      can_manage: canManageFlaggedAddress(record, authz.user),
    });
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

  let record;
  try {
    record = await getFlaggedAddressById(id);
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canManageFlaggedAddress(record, authz.user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  if ("is_active" in b) {
    if (Object.keys(b).length !== 1) {
      return NextResponse.json(
        { error: "Activation cannot be combined with other updates" },
        { status: 400 }
      );
    }
    if (b.is_active !== true) {
      return NextResponse.json(
        { error: "Use DELETE to deactivate records" },
        { status: 400 }
      );
    }

    try {
      const activated = await activateFlaggedAddress(id);
      if (!activated) {
        return NextResponse.json({ error: "Record not found or already active" }, { status: 404 });
      }
      void logAuditEvent({
        userId: authz.user.id,
        action: "FLAGGED_ADDRESS_REACTIVATED",
        actorRole: authz.user.role,
        entity: "flagged_address",
        entityId: id,
        details: {
          address: record.address,
          network_code: record.network_code,
        },
      });
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

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
    void logAuditEvent({
      userId: authz.user.id,
      action: "FLAGGED_ADDRESS_UPDATED",
      actorRole: authz.user.role,
      entity: "flagged_address",
      entityId: id,
      details: { changes: patch },
    });
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

    if (!canManageFlaggedAddress(record, authz.user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const deactivated = await deactivateFlaggedAddress(id);
    if (!deactivated) {
      return NextResponse.json({ error: "Record not found or already deactivated" }, { status: 404 });
    }
    void logAuditEvent({
      userId: authz.user.id,
      action: "FLAGGED_ADDRESS_DEACTIVATED",
      actorRole: authz.user.role,
      entity: "flagged_address",
      entityId: id,
      details: {
        address: record.address,
        network_code: record.network_code,
      },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
