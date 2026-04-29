import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { authorizeFreshUser } from "@/lib/authz";
import { setNetworkActive } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ code: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const authz = await authorizeFreshUser(session?.user.id, "admin");

  if (!authz.ok) {
    if (authz.status === 500) {
      return NextResponse.json({ error: "Authentication service unavailable" }, { status: 500 });
    }
    return NextResponse.json(
      { error: authz.status === 401 ? "Authentication required" : "Forbidden" },
      { status: authz.status }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).is_active !== "boolean"
  ) {
    return NextResponse.json(
      { error: "is_active must be a boolean" },
      { status: 400 }
    );
  }

  const { code } = await params;
  const isActive = (body as Record<string, unknown>).is_active as boolean;

  try {
    const updated = await setNetworkActive(code, isActive);
    if (!updated) {
      return NextResponse.json({ error: "Network not found" }, { status: 404 });
    }
    return NextResponse.json({ code: code.trim().toUpperCase(), is_active: isActive });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
