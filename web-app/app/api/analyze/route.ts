import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { authorizeFreshUser } from "@/lib/authz";
import { getNetworkAnalysisConfig, patchAnalysisRequestUserId, logAuditEvent } from "@/lib/db";

const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL;

export const runtime = "nodejs";

const ANALYTICS_LIMIT_CAPS = {
  max_depth: 5,
  max_tx_limit: 200,
  max_period_days: 3650,
} as const;

function invalidRequest(detail: string) {
  return NextResponse.json(
    {
      error_code: "INVALID_REQUEST",
      detail,
      request_id: null,
    },
    { status: 422 }
  );
}

function readInteger(
  body: Record<string, unknown>,
  field: string,
  fallback: number
): number | null {
  if (body[field] === undefined) return fallback;
  return Number.isInteger(body[field]) ? (body[field] as number) : null;
}

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

  const network = typeof body === "object" && body !== null
    ? (body as Record<string, unknown>).network
    : undefined;

  if (typeof network !== "string" || !network.trim()) {
    return NextResponse.json(
      {
        error_code: "INVALID_REQUEST",
        detail: "network is required",
        request_id: null,
      },
      { status: 422 }
    );
  }

  let networkConfig: Awaited<ReturnType<typeof getNetworkAnalysisConfig>>;
  try {
    networkConfig = await getNetworkAnalysisConfig(network);
  } catch {
    return NextResponse.json(
      {
        error_code: "INTERNAL_ERROR",
        detail: "Network configuration is unavailable",
        request_id: null,
      },
      { status: 500 }
    );
  }

  if (!networkConfig?.is_active) {
    return NextResponse.json(
      {
        error_code: "UNSUPPORTED_NETWORK",
        detail: "This network is not supported.",
        request_id: null,
      },
      { status: 400 }
    );
  }

  const bodyRecord = body as Record<string, unknown>;
  const maxDepth = Math.min(networkConfig.max_depth, ANALYTICS_LIMIT_CAPS.max_depth);
  const maxTxLimit = Math.min(networkConfig.max_tx_limit, ANALYTICS_LIMIT_CAPS.max_tx_limit);
  const maxPeriodDays = Math.min(
    networkConfig.max_period_days,
    ANALYTICS_LIMIT_CAPS.max_period_days
  );

  const depth = readInteger(bodyRecord, "depth", networkConfig.default_depth);
  if (depth === null || depth < 1 || depth > maxDepth) {
    return invalidRequest(`depth must be an integer between 1 and ${maxDepth}`);
  }

  const txLimit = readInteger(bodyRecord, "tx_limit", networkConfig.default_tx_limit);
  if (txLimit === null || txLimit < 1 || txLimit > maxTxLimit) {
    return invalidRequest(
      `tx_limit must be an integer between 1 and ${maxTxLimit}`
    );
  }

  let periodDays: number | null;
  if (bodyRecord.period_days === undefined) {
    periodDays = networkConfig.default_period_days;
  } else if (bodyRecord.period_days === null) {
    periodDays = null;
  } else if (Number.isInteger(bodyRecord.period_days)) {
    periodDays = bodyRecord.period_days as number;
  } else {
    return invalidRequest(
      `period_days must be an integer between 1 and ${maxPeriodDays}, or null`
    );
  }

  if (
    periodDays !== null &&
    (periodDays < 1 || periodDays > maxPeriodDays)
  ) {
    return invalidRequest(
      `period_days must be an integer between 1 and ${maxPeriodDays}, or null`
    );
  }

  const upstreamBody = {
    ...bodyRecord,
    network: networkConfig.code,
    depth,
    tx_limit: txLimit,
    period_days: periodDays,
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${ANALYTICS_SERVICE_URL}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(upstreamBody),
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

  // Backfill user_id on the analysis_requests row created by analytics-service.
  // The analytics-service runs without web-app auth context so it always writes
  // user_id = NULL. Patch it here now that we have the request_id and the
  // authenticated user's ID. Only fires on success (2xx) with a valid request_id.
  if (upstream.ok && typeof data?.request_id === "string" && authz.user?.id) {
    patchAnalysisRequestUserId(data.request_id, authz.user.id).catch(() => {
      // Non-fatal: history will simply not show this analysis for the user.
    });
    void logAuditEvent({
      userId: authz.user.id,
      action: "RUN_ANALYSIS",
      actorRole: authz.user.role,
      entity: "analysis",
      entityId: data.request_id,
      details: {
        address: upstreamBody.address,
        network: upstreamBody.network,
        risk_level: data.risk_level ?? null,
        request_id: data.request_id,
        result_id: data.result_id ?? null,
      },
    });
  }

  return NextResponse.json(data, { status: upstream.status });
}
