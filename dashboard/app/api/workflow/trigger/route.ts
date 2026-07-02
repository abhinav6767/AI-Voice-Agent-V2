import { NextRequest, NextResponse } from "next/server";
import { fireWorkflowEvent } from "@/lib/workflow-trigger-engine";
import { getWorkflowRun, getWorkflowRuns } from "@/lib/workflow-executor";
import { getDueQueueEntries } from "@/lib/workflow-executor";
import fs from "fs";
import path from "path";

const WORKFLOWS_FILE = path.join(process.cwd(), "..", "data", "workflows.json");

function readWorkflows() {
  try {
    if (!fs.existsSync(WORKFLOWS_FILE)) return [];
    return JSON.parse(fs.readFileSync(WORKFLOWS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

// POST /api/workflow/trigger — fire an event and kick off matching workflows
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { eventType, payload } = body;

    if (!eventType) {
      return NextResponse.json({ error: "eventType is required" }, { status: 400 });
    }

    const dashboardUrl = process.env.DASHBOARD_URL || `http://localhost:${process.env.PORT || 3000}`;
    const runs = await fireWorkflowEvent(eventType, payload || {}, dashboardUrl);

    return NextResponse.json({
      success: true,
      triggered: runs.length,
      runs: runs.map((r) => ({ id: r.id, workflowId: r.workflowId, workflowName: r.workflowName, status: r.status })),
    });
  } catch (err: any) {
    console.error("[POST /api/workflow/trigger]", err);
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}

// GET /api/workflow/trigger?runId=... — get a specific run (used by frontend polling)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("runId");
  const workflowId = searchParams.get("workflowId");

  if (runId) {
    const run = getWorkflowRun(runId);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json(run);
  }

  const runs = getWorkflowRuns(workflowId || undefined);
  return NextResponse.json({ runs });
}
