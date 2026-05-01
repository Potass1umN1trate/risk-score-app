import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { authorizeFreshUser } from "@/lib/authz";
import { importFlaggedAddresses, logAuditEvent, type ImportRecord } from "@/lib/db";

export const runtime = "nodejs";

function authError(authz: { ok: false; status: 401 | 403 | 500 }) {
  if (authz.status === 500) {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 500 });
  }
  return NextResponse.json(
    { error: authz.status === 401 ? "Authentication required" : "Forbidden" },
    { status: authz.status }
  );
}

// Minimal CSV parser: handles quoted fields with commas and escaped quotes.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        // Quoted field
        i++;
        let field = "";
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') {
            field += '"';
            i += 2;
          } else if (line[i] === '"') {
            i++;
            break;
          } else {
            field += line[i++];
          }
        }
        fields.push(field);
        if (line[i] === ",") i++;
      } else {
        const end = line.indexOf(",", i);
        if (end === -1) {
          fields.push(line.slice(i));
          break;
        }
        fields.push(line.slice(i, end));
        i = end + 1;
      }
    }
    return fields;
  };

  const headers = parseRow(lines[0]).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = parseRow(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] ?? "";
    });
    return obj;
  });
}

function rowsToImportRecords(rows: Record<string, string>[]): ImportRecord[] {
  return rows
    .map((r) => ({
      network_code: (r["network_code"] ?? r["network"] ?? "").trim(),
      address: (r["address"] ?? "").trim(),
      risk_category_code: (r["risk_category_code"] ?? r["category"] ?? r["risk_category"] ?? "").trim(),
      comment: (r["comment"] ?? "").trim() || null,
    }))
    .filter((r) => r.network_code && r.address && r.risk_category_code);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const authz = await authorizeFreshUser(session?.user.id, "moderator");
  if (!authz.ok) return authError(authz);

  const contentType = req.headers.get("content-type") ?? "";
  let records: ImportRecord[] = [];

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
      }
      const text = await file.text();
      const filename = file.name ?? "";

      if (filename.endsWith(".json") || contentType.includes("json")) {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) {
          return NextResponse.json({ error: "JSON file must contain an array of records" }, { status: 400 });
        }
        records = (parsed as Record<string, unknown>[]).map((r) => ({
          network_code: String(r.network_code ?? r.network ?? "").trim(),
          address: String(r.address ?? "").trim(),
          risk_category_code: String(r.risk_category_code ?? r.category ?? r.risk_category ?? "").trim(),
          comment: r.comment != null ? String(r.comment).trim() || null : null,
        })).filter((r) => r.network_code && r.address && r.risk_category_code);
      } else {
        // Treat as CSV by default
        const rows = parseCsv(text);
        records = rowsToImportRecords(rows);
      }
    } else if (contentType.includes("application/json")) {
      const parsed = await req.json();
      if (!Array.isArray(parsed)) {
        return NextResponse.json({ error: "Body must be an array of records" }, { status: 400 });
      }
      records = (parsed as Record<string, unknown>[]).map((r) => ({
        network_code: String(r.network_code ?? r.network ?? "").trim(),
        address: String(r.address ?? "").trim(),
        risk_category_code: String(r.risk_category_code ?? r.category ?? "").trim(),
        comment: r.comment != null ? String(r.comment).trim() || null : null,
      })).filter((r) => r.network_code && r.address && r.risk_category_code);
    } else {
      return NextResponse.json(
        { error: "Unsupported content type. Use multipart/form-data with a file or application/json." },
        { status: 415 }
      );
    }
  } catch {
    return NextResponse.json({ error: "Failed to parse import file" }, { status: 400 });
  }

  if (records.length === 0) {
    return NextResponse.json({ error: "No valid records found in file" }, { status: 400 });
  }

  try {
    const result = await importFlaggedAddresses(records, authz.user.id);
    void logAuditEvent({
      userId: authz.user.id,
      action: "FLAGGED_ADDRESS_IMPORT",
      entity: "flagged_address",
      entityId: null,
      details: {
        role: authz.user.role,
        inserted: result.inserted,
        skipped: result.skipped,
        error_count: result.errors.length,
      },
    });
    return NextResponse.json(result, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
