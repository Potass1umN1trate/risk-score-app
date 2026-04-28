import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { authorizeFreshUser } from "@/lib/authz";
import { getRiskCategories } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  const authz = await authorizeFreshUser(session?.user.id, "moderator");
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
    const categories = await getRiskCategories();
    return NextResponse.json(categories);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
