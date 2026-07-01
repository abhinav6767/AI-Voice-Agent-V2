import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "..", "data");

// ── GET /api/campaign/results?campaignId=<id> ──────────────────────────────────
// Returns the per-lead call results written by the Python analytics module
// after each call completes. The frontend polls this to show live progress.

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const campaignId = searchParams.get("campaignId");

    if (!campaignId) {
      return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
    }

    // Sanitize campaignId — only allow alphanumeric and underscores/dashes
    if (!/^[a-zA-Z0-9_-]+$/.test(campaignId)) {
      return NextResponse.json({ error: "Invalid campaignId" }, { status: 400 });
    }

    const campaignFile = path.join(DATA_DIR, `campaign_${campaignId}.json`);

    if (!fs.existsSync(campaignFile)) {
      // No results yet — return empty array (campaign may just have started)
      return NextResponse.json({ results: [] });
    }

    const raw = fs.readFileSync(campaignFile, "utf-8");
    const results = JSON.parse(raw);

    return NextResponse.json({ results });
  } catch (err: any) {
    console.error("[Campaign Results]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
