import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { authorizeFreshUser } from "@/lib/authz";

const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL;

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const authz = await authorizeFreshUser(session?.user.id, "user");

  if (!authz.ok) {
    if (authz.status === 500) {
      return NextResponse.json(
        {
          error_code: "INTERNAL_ERROR",
          detail: "Authentication service is unavailable",
          request_id: null,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        error: authz.status === 401 ? "Authentication required" : "Forbidden",
        reason: authz.reason,
      },
      { status: authz.status }
    );
  }

  if (!ANALYTICS_SERVICE_URL) {
    return NextResponse.json(
      {
        error_code: "INTERNAL_ERROR",
        detail: "Analytics service is not configured",
        request_id: null,
      },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        error_code: "INVALID_REQUEST",
        detail: "Invalid JSON body",
        request_id: null,
      },
      { status: 422 }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${ANALYTICS_SERVICE_URL}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json(
      {
        error_code: "INTERNAL_ERROR",
        detail: "Analytics service is unavailable",
        request_id: null,
      },
      { status: 500 }
    );
  }

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
