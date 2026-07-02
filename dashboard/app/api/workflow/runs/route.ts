import { NextRequest, NextResponse } from "next/server";
import { getWorkflowRuns, getWorkflowRun } from "@/lib/workflow-executor";

// GET /api/workflow/runs?workflowId=... — list all runs (optionally filtered by workflowId)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const workflowId = searchParams.get("workflowId") || undefined;
    const limit = parseInt(searchParams.get("limit") || "50");
    const runs = getWorkflowRuns(workflowId).slice(0, limit);
    return NextResponse.json({ runs, total: runs.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
