// Types mirroring the analytics-service API contract (analytics/app/api/analyze.py).
// ANALYTICS_SERVICE_URL must only be used server-side (API routes).

export const SUPPORTED_NETWORKS = [
  "BTC", "ETH", "TRX", "SOL", "BNB", "XRP", "LTC", "DOGE", "ADA", "TON",
] as const;

export type NetworkCode = (typeof SUPPORTED_NETWORKS)[number];

export type AnalyticsErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_ADDRESS"
  | "UNSUPPORTED_NETWORK"
  | "BLOCKCHAIN_RATE_LIMITED"
  | "BLOCKCHAIN_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface AnalyticsErrorResponse {
  error_code: AnalyticsErrorCode | string;
  detail: string;
  request_id: string | null;
}

export interface AnalyzeRequest {
  address: string;
  network: string;
  depth: number;
  tx_limit: number;
  period_days?: number | null;
}

export interface NodeOut {
  address: string;
  depth: number;
  is_root: boolean;
  is_flagged: boolean;
  flag_types: string[];
}

export interface EdgeOut {
  from_address: string;
  to_address: string;
  tx_count: number;
  total_amount: number;
  first_seen: number | null;
  last_seen: number | null;
}

export interface RiskFactor {
  key: string;
  label: string;
  value: unknown;
  severity: "LOW" | "MEDIUM" | "HIGH";
  description: string;
}

export interface AnalyzeResponse {
  request_id: string;
  result_id: string;
  address: string;
  network: string;
  risk_score: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  model_version: string;
  scoring_method: "ml_model" | "database";
  flag_type: string | null;
  nodes_count: number;
  edges_count: number;
  nodes: NodeOut[];
  edges: EdgeOut[];
  factors: RiskFactor[];
  features: Record<string, number>;
  analyzed_at: string;
}

export type AnalyzeResult =
  | { ok: true; data: AnalyzeResponse }
  | { ok: false; error: AnalyticsErrorResponse };

// Browser-facing helper: submits to the web-app's own /api/analyze proxy route.
export async function submitAnalysis(
  req: AnalyzeRequest
): Promise<AnalyzeResult> {
  let res: Response;
  try {
    res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  } catch {
    return {
      ok: false,
      error: {
        error_code: "INTERNAL_ERROR",
        detail: "Analytics service is unavailable",
        request_id: null,
      },
    };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return {
      ok: false,
      error: {
        error_code: "INTERNAL_ERROR",
        detail: "Invalid response from analytics service",
        request_id: null,
      },
    };
  }

  if (res.ok) {
    return { ok: true, data: json as AnalyzeResponse };
  }
  return { ok: false, error: json as AnalyticsErrorResponse };
}
