import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { authorizeFreshUser } from "@/lib/authz";
import {
  getNetworkAnalysisConfig,
  updateNetworkConfig,
  logAuditEvent,
  type NetworkConfigPatch,
} from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ code: string }> };

const ANALYTICS_LIMIT_CAPS = {
  max_depth: 5,
  max_tx_limit: 200,
  max_period_days: 3650,
} as const;

const LIMIT_FIELDS = [
  "default_depth",
  "max_depth",
  "default_tx_limit",
  "max_tx_limit",
  "default_period_days",
  "max_period_days",
] as const;

function isLimitField(field: string): field is (typeof LIMIT_FIELDS)[number] {
  return (LIMIT_FIELDS as readonly string[]).includes(field);
}

function validateIntegerField(
  body: Record<string, unknown>,
  field: (typeof LIMIT_FIELDS)[number],
  patch: NetworkConfigPatch
): string | null {
  if (!(field in body)) return null;

  const value = body[field];
  if (field === "default_period_days" && value === null) {
    patch[field] = null;
    return null;
  }

  if (!Number.isInteger(value)) {
    return `${field} must be an integer${field === "default_period_days" ? " or null" : ""}`;
  }

  patch[field] = value as number;
  return null;
}

function validateLimits(config: {
  default_depth: number;
  max_depth: number;
  default_tx_limit: number;
  max_tx_limit: number;
  default_period_days: number | null;
  max_period_days: number;
}): string | null {
  if (config.default_depth < 1) return "default_depth must be at least 1";
  if (config.max_depth > ANALYTICS_LIMIT_CAPS.max_depth) {
    return `max_depth must be at most ${ANALYTICS_LIMIT_CAPS.max_depth}`;
  }
  if (config.max_depth < config.default_depth) {
    return "max_depth must be greater than or equal to default_depth";
  }
  if (config.default_tx_limit < 1) return "default_tx_limit must be at least 1";
  if (config.max_tx_limit > ANALYTICS_LIMIT_CAPS.max_tx_limit) {
    return `max_tx_limit must be at most ${ANALYTICS_LIMIT_CAPS.max_tx_limit}`;
  }
  if (config.max_tx_limit < config.default_tx_limit) {
    return "max_tx_limit must be greater than or equal to default_tx_limit";
  }
  if (config.default_period_days !== null && config.default_period_days < 1) {
    return "default_period_days must be at least 1 or null";
  }
  if (config.max_period_days < 1) return "max_period_days must be at least 1";
  if (config.max_period_days > ANALYTICS_LIMIT_CAPS.max_period_days) {
    return `max_period_days must be at most ${ANALYTICS_LIMIT_CAPS.max_period_days}`;
  }
  if (
    config.default_period_days !== null &&
    config.default_period_days > config.max_period_days
  ) {
    return "default_period_days must be less than or equal to max_period_days";
  }
  return null;
}

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

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
  }

  const { code } = await params;
  const input = body as Record<string, unknown>;
  const patch: NetworkConfigPatch = {};

  if ("is_active" in input) {
    if (typeof input.is_active !== "boolean") {
      return NextResponse.json(
        { error: "is_active must be a boolean" },
        { status: 400 }
      );
    }
    patch.is_active = input.is_active;
  }

  for (const field of LIMIT_FIELDS) {
    const error = validateIntegerField(input, field, patch);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: `At least one of is_active or ${LIMIT_FIELDS.join(", ")} is required` },
      { status: 400 }
    );
  }

  for (const key of Object.keys(input)) {
    if (key !== "is_active" && !isLimitField(key)) {
      return NextResponse.json({ error: `Unknown field: ${key}` }, { status: 400 });
    }
  }

  try {
    const current = await getNetworkAnalysisConfig(code);
    if (!current) {
      return NextResponse.json({ error: "Network not found" }, { status: 404 });
    }

    const merged = {
      default_depth: patch.default_depth ?? current.default_depth,
      max_depth: patch.max_depth ?? current.max_depth,
      default_tx_limit: patch.default_tx_limit ?? current.default_tx_limit,
      max_tx_limit: patch.max_tx_limit ?? current.max_tx_limit,
      default_period_days:
        patch.default_period_days !== undefined
          ? patch.default_period_days
          : current.default_period_days,
      max_period_days: patch.max_period_days ?? current.max_period_days,
    };
    const validationError = validateLimits(merged);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const updated = await updateNetworkConfig(code, patch);
    if (!updated) {
      return NextResponse.json({ error: "Network not found" }, { status: 404 });
    }
    void logAuditEvent({
      userId: authz.user.id,
      action: "NETWORK_CONFIG_CHANGED",
      entity: "network",
      entityId: updated.code,
      details: { code: updated.code, changes: patch },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message.includes("violates check constraint")) {
      return NextResponse.json({ error: "Invalid network limits" }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
