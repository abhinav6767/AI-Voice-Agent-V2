import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "..", "data");

// ── GET /api/campaign/download?campaignId=<id> ─────────────────────────────────
// Merges the original leads data with the call results (Status + Remarks)
// and returns a downloadable CSV file with Content-Disposition header.
// The frontend stores the original parsed leads in state and passes them
// as a query param (or we read from a temp store).
// To keep it stateless: the frontend POSTs the original rows + campaignId.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { campaignId, leads, columns } = body;
    // leads: Array<Record<string, string>> — original rows from uploaded file
    // columns: string[] — original column names (in order)
    // campaignId: string

    if (!campaignId || !leads || !columns) {
      return NextResponse.json(
        { error: "campaignId, leads, and columns are required" },
        { status: 400 }
      );
    }

    // Sanitize campaignId
    if (!/^[a-zA-Z0-9_-]+$/.test(campaignId)) {
      return NextResponse.json({ error: "Invalid campaignId" }, { status: 400 });
    }

    // Load campaign results
    const campaignFile = path.join(DATA_DIR, `campaign_${campaignId}.json`);
    let results: any[] = [];
    if (fs.existsSync(campaignFile)) {
      results = JSON.parse(fs.readFileSync(campaignFile, "utf-8"));
    }

    // Build a Map of rowIndex → result for quick lookup
    const resultMap = new Map<number, any>();
    for (const r of results) {
      resultMap.set(r.row_index, r);
    }

    // Merge original columns + new Status + Remarks columns
    const allColumns = [...columns, "Call Status", "Call Remarks", "Call Sentiment"];

    // Escape a CSV cell value
    const escapeCell = (val: string) => {
      const s = String(val ?? "");
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows: string[] = [];

    // Header row
    rows.push(allColumns.map(escapeCell).join(","));

    // Data rows
    leads.forEach((lead: Record<string, string>, index: number) => {
      const result = resultMap.get(index);
      const rowCells = columns.map((col: string) => escapeCell(lead[col] ?? ""));
      rowCells.push(escapeCell(result?.status ?? "Pending"));
      rowCells.push(escapeCell(result?.remarks ?? ""));
      rowCells.push(escapeCell(result?.sentiment ?? ""));
      rows.push(rowCells.join(","));
    });

    const csvContent = rows.join("\n");

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="campaign_${campaignId}_results.csv"`,
      },
    });
  } catch (err: any) {
    console.error("[Campaign Download]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
