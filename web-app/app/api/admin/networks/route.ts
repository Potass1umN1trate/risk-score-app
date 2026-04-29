import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { authorizeFreshUser } from "@/lib/authz";
import { listAllNetworks } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
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

  try {
    const networks = await listAllNetworks();
    return NextResponse.json(networks);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
