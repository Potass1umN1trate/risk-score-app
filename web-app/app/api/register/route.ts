import { NextRequest, NextResponse } from "next/server";
import { createUser, findUserByEmail, logAuditEvent } from "@/lib/db";
import { hashPassword } from "@/lib/password";

const MIN_PASSWORD_LENGTH = 8;

export async function POST(req: NextRequest) {
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

  const email = (
    (body as Record<string, unknown>).email as string
  )
    .trim()
    .toLowerCase();
  const password = (body as Record<string, unknown>).password as string;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser(email, passwordHash);

  void logAuditEvent({
    userId: user.id,
    action: "USER_REGISTERED",
    actorRole: "user",
    entity: "user",
    entityId: user.id,
    details: { email: user.email },
  });

  return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
}
