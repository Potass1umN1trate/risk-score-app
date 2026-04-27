import { NextRequest, NextResponse } from "next/server";

const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL;

export async function POST(req: NextRequest) {
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
