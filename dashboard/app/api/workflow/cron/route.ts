import { NextRequest, NextResponse } from "next/server";
import { fireScheduledWorkflows, fireWorkflowEvent } from "@/lib/workflow-trigger-engine";
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

// GET /api/workflow/cron — process scheduled workflows and resume queued delay entries
// Call this endpoint periodically (every minute) from the dashboard via setInterval
export async function GET(req: NextRequest) {
  const dashboardUrl = process.env.DASHBOARD_URL || `http://localhost:${process.env.PORT || 3000}`;
  const results: any[] = [];

  // 1. Fire scheduled (cron) workflows
  try {
    const scheduledRuns = await fireScheduledWorkflows(dashboardUrl);
    results.push({ type: "scheduled", count: scheduledRuns.length });
  } catch (err: any) {
    console.error("[Cron] Error firing scheduled workflows:", err);
    results.push({ type: "scheduled", error: err.message });
  }

  // 2. Resume any wait_delay entries that are now due
  try {
    const dueEntries = getDueQueueEntries();
    const workflows = readWorkflows();

    for (const entry of dueEntries) {
      const workflow = workflows.find((w: any) => w.id === entry.workflowId);
      if (!workflow) continue;

      try {
        const { executeWorkflow } = await import("@/lib/workflow-executor");
        await executeWorkflow(
          workflow,
          entry.context.$trigger?.eventType || "resumed",
          entry.triggerPayload,
          {
            dashboardUrl,
            startNodeId: entry.nextNodeId,
            existingRunId: entry.runId,
            previousSteps: entry.steps,
            initialContext: entry.context,
          }
        );
        results.push({ type: "resumed_delay", workflowId: entry.workflowId, runId: entry.runId });
      } catch (err: any) {
        console.error("[Cron] Error resuming queued entry:", err);
        results.push({ type: "resumed_delay_error", runId: entry.runId, error: err.message });
      }
    }
  } catch (err: any) {
    console.error("[Cron] Error processing queue:", err);
    results.push({ type: "queue", error: err.message });
  }

  return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), results });
}
