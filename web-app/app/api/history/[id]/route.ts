import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { authorizeFreshUser } from "@/lib/authz";
import { getAnalysisResult } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing result ID" }, { status: 400 });
  }

  const isAdmin = authz.user.role === "admin";
  const ownerFilter = isAdmin ? null : authz.user.id;

  try {
    const detail = await getAnalysisResult(id, ownerFilter);
    if (!detail) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Extract factors and features from factors_json JSONB blob
    const fj = detail.factors_json as Record<string, unknown> | null;
    const factors = Array.isArray(fj?.factors) ? fj.factors : [];
    const features = (fj?.features && typeof fj.features === "object" && !Array.isArray(fj.features))
      ? (fj.features as Record<string, number>)
      : {};

    // Normalize to ResultData shape (compatible with ResultPanel)
    const response = {
      request_id: detail.request_id,
      result_id: detail.result_id,
      address: detail.address,
      network: detail.network_code,
      risk_score: detail.risk_score,
      risk_level: detail.risk_level,
      model_version: detail.model_version,
      scoring_method: detail.scoring_method,
      flag_type: detail.flag_type,
      nodes_count: detail.nodes_count,
      edges_count: detail.edges_count,
      analyzed_at: detail.analyzed_at,
      user_id: detail.user_id,
      user_email: detail.user_email,
      factors,
      features,
      nodes: detail.nodes,
      // Normalize edges: DB `amount` → `total_amount`; TIMESTAMPTZ → Unix seconds
      edges: detail.edges.map((e) => ({
        from_address: e.from_address,
        to_address: e.to_address,
        tx_count: e.tx_count,
        total_amount: parseFloat(e.amount ?? "0"),
        first_seen: e.first_seen ? Math.floor(new Date(e.first_seen).getTime() / 1000) : null,
        last_seen: e.last_seen ? Math.floor(new Date(e.last_seen).getTime() / 1000) : null,
      })),
    };

    return NextResponse.json(response);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
