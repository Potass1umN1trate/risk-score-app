import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { authorizeFreshUser } from "@/lib/authz";
import { getAuditLogs, type AuditLogFilters } from "@/lib/db";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const auth = await authorizeFreshUser(session?.user?.id, "admin");
  if (!auth.ok) {
    if (auth.status === 500) {
      return NextResponse.json({ error: "Authentication service unavailable" }, { status: 500 });
    }
    return NextResponse.json(
      { error: auth.status === 401 ? "Authentication required" : "Forbidden" },
      { status: auth.status }
    );
  }

  const { searchParams } = req.nextUrl;

  const rawLimit = parseInt(searchParams.get("limit") ?? "", 10);
  const rawPage = parseInt(searchParams.get("page") ?? "", 10);
  const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);
  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
  const offset = (page - 1) * limit;

  const filters: AuditLogFilters = {};
  const action = searchParams.get("action");
  const userId = searchParams.get("userId");
  const entity = searchParams.get("entity");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  if (action) filters.action = action;
  if (userId) filters.userId = userId;
  if (entity) filters.entity = entity;
  if (dateFrom) filters.dateFrom = dateFrom;
  if (dateTo) filters.dateTo = dateTo;

  try {
    const { items, total } = await getAuditLogs(filters, limit, offset);
    return NextResponse.json({ items, total, page, limit });
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
