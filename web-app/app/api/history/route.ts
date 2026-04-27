import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { authorizeFreshUser } from "@/lib/authz";
import { getAnalysisHistory } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const authz = await authorizeFreshUser(session?.user.id, "user");

  if (!authz.ok) {
    if (authz.status === 500) {
      return NextResponse.json({ error: "Authentication service unavailable" }, { status: 500 });
    }
    return NextResponse.json(
      { error: authz.status === 401 ? "Authentication required" : "Forbidden" },
      { status: authz.status }
    );
  }

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const rawLimit = parseInt(searchParams.get("limit") ?? "20", 10) || 20;
  const limit = Math.min(100, Math.max(1, rawLimit));
  const offset = (page - 1) * limit;

  // admin sees all; user/moderator see only own
  const isAdmin = authz.user.role === "admin";
  const ownerFilter = isAdmin ? null : authz.user.id;

  try {
    const { items, total } = await getAnalysisHistory(ownerFilter, limit, offset);
    return NextResponse.json({ items, total, page, limit });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
