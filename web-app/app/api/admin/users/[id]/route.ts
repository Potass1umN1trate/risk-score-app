import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { authorizeFreshUser } from "@/lib/authz";
import {
  getUserById,
  setUserRole,
  setUserBlocked,
  deleteUser,
  countAdminUsers,
  logAuditEvent,
} from "@/lib/db";
import { isRole, type Role } from "@/lib/rbac";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const auth = await authorizeFreshUser(session?.user?.id, "admin");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const { id } = await params;

  try {
    const user = await getUserById(id);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json(user);
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const auth = await authorizeFreshUser(session?.user?.id, "admin");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const { id } = await params;

  if (id === auth.user.id) {
    return NextResponse.json(
      { error: "Cannot perform this action on your own account" },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const patch = body as Record<string, unknown>;
  const hasRole = "role" in patch;
  const hasBlocked = "isBlocked" in patch;

  if (!hasRole && !hasBlocked) {
    return NextResponse.json(
      { error: "Provide role or isBlocked to update" },
      { status: 400 }
    );
  }

  try {
    const target = await getUserById(id);
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (hasRole) {
      const newRole = patch.role;
      if (!isRole(newRole)) {
        return NextResponse.json({ error: "Invalid role value" }, { status: 400 });
      }

      // Last-admin guard: prevent demoting the last admin.
      if (target.role === "admin" && newRole !== "admin") {
        const adminCount = await countAdminUsers();
        if (adminCount <= 1) {
          return NextResponse.json(
            { error: "Cannot remove the last admin account" },
            { status: 400 }
          );
        }
      }

      await setUserRole(id, newRole as Role);
      void logAuditEvent({
        userId: auth.user.id,
        action: "USER_ROLE_CHANGED",
        actorRole: auth.user.role,
        entity: "user",
        entityId: id,
        details: { old_role: target.role, new_role: newRole },
      });
    }

    if (hasBlocked) {
      if (typeof patch.isBlocked !== "boolean") {
        return NextResponse.json({ error: "isBlocked must be a boolean" }, { status: 400 });
      }
      await setUserBlocked(id, patch.isBlocked);
      void logAuditEvent({
        userId: auth.user.id,
        action: patch.isBlocked ? "USER_BLOCKED" : "USER_UNBLOCKED",
        actorRole: auth.user.role,
        entity: "user",
        entityId: id,
        details: { email: target.email },
      });
    }

    const updated = await getUserById(id);
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const auth = await authorizeFreshUser(session?.user?.id, "admin");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const { id } = await params;

  if (id === auth.user.id) {
    return NextResponse.json(
      { error: "Cannot perform this action on your own account" },
      { status: 400 }
    );
  }

  try {
    const target = await getUserById(id);
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Last-admin guard: prevent deleting the last admin.
    if (target.role === "admin") {
      const adminCount = await countAdminUsers();
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot remove the last admin account" },
          { status: 400 }
        );
      }
    }

    await deleteUser(id);
    void logAuditEvent({
      userId: auth.user.id,
      action: "USER_DELETED",
      actorRole: auth.user.role,
      entity: "user",
      entityId: id,
      details: { email: target.email, role: target.role },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
