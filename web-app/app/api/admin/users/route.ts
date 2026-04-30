import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { authorizeFreshUser } from "@/lib/authz";
import {
  listUsers,
  adminCreateUser,
  findUserByEmail,
  logAuditEvent,
  type UserListFilters,
} from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { isRole, type Role } from "@/lib/rbac";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MIN_PASSWORD_LENGTH = 8;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const auth = await authorizeFreshUser(session?.user?.id, "admin");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const { searchParams } = req.nextUrl;

  const rawLimit = parseInt(searchParams.get("limit") ?? "", 10);
  const rawPage = parseInt(searchParams.get("page") ?? "", 10);
  const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);
  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
  const offset = (page - 1) * limit;

  const filters: UserListFilters = {};
  const emailParam = searchParams.get("email");
  if (emailParam) filters.email = emailParam;

  const roleParam = searchParams.get("role");
  if (roleParam && isRole(roleParam)) filters.role = roleParam as Role;

  const blockedParam = searchParams.get("blocked");
  if (blockedParam === "true") filters.isBlocked = true;
  else if (blockedParam === "false") filters.isBlocked = false;

  try {
    const { items, total } = await listUsers(filters, limit, offset);
    return NextResponse.json({ items, total, page, limit });
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const auth = await authorizeFreshUser(session?.user?.id, "admin");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).email !== "string" ||
    typeof (body as Record<string, unknown>).password !== "string"
  ) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 }
    );
  }

  const email = ((body as Record<string, unknown>).email as string).trim().toLowerCase();
  const password = (body as Record<string, unknown>).password as string;
  const roleRaw = (body as Record<string, unknown>).role;
  const role: Role = isRole(roleRaw) ? (roleRaw as Role) : "user";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }

  try {
    const existing = await findUserByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);
    const user = await adminCreateUser(email, passwordHash, role);
    void logAuditEvent({
      userId: auth.user.id,
      action: "USER_CREATED",
      entity: "user",
      entityId: user.id,
      details: { email: user.email, role },
    });
    return NextResponse.json({ id: user.id, email: user.email, role }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
