/**
 * Workflow Trigger Engine
 *
 * Matches an incoming event against all active workflows and kicks off execution
 * for every matching workflow.
 */

import fs from "fs";
import path from "path";
import type { Workflow } from "./workflow-types";
import { executeWorkflow } from "./workflow-executor";
import type { WorkflowRun } from "./workflow-executor";

const DATA_DIR = path.join(process.cwd(), "..", "data");
const WORKFLOWS_FILE = path.join(DATA_DIR, "workflows.json");

function readWorkflows(): Workflow[] {
  try {
    if (!fs.existsSync(WORKFLOWS_FILE)) return [];
    return JSON.parse(fs.readFileSync(WORKFLOWS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

// ── Trigger Matching ──────────────────────────────────────────────────────────

function doesTriggerMatch(workflow: Workflow, eventType: string, payload: Record<string, any>): boolean {
  const triggerNode = workflow.nodes.find((n) => n.category === "trigger");
  if (!triggerNode) return false;

  const cfg = triggerNode.config || {};

  // Manual trigger only runs on explicit "manual" event
  if (triggerNode.type === "manual_trigger") {
    return eventType === "manual";
  }

  // Scheduled trigger is handled by cron endpoint, not event-based
  if (triggerNode.type === "scheduled") {
    return eventType === "cron";
  }

  if (triggerNode.type !== eventType) return false;

  // Additional filter checks per trigger type
  switch (eventType) {
    case "call_completed": {
      const dir = cfg.callDirection || "any";
      if (dir !== "any" && payload.direction && dir !== payload.direction) return false;
      return true;
    }
    case "lead_status_changed": {
      if (cfg.fromStatus && cfg.fromStatus !== "any" && cfg.fromStatus !== payload.fromStatus) return false;
      if (cfg.toStatus && cfg.toStatus !== "any" && cfg.toStatus !== payload.toStatus) return false;
      return true;
    }
    case "lead_tag_added": {
      if (cfg.tagName && cfg.tagName !== payload.tagName) return false;
      return true;
    }
    case "sentiment_detected": {
      if (cfg.sentimentType && cfg.sentimentType !== payload.sentiment) return false;
      return true;
    }
    case "new_lead":
    case "form_submitted":
    case "webhook_received":
    case "error_trigger":
      return true;
    default:
      return triggerNode.type === eventType;
  }
}

// ── Main Entry Point ──────────────────────────────────────────────────────────

export async function fireWorkflowEvent(
  eventType: string,
  payload: Record<string, any>,
  dashboardUrl?: string
): Promise<WorkflowRun[]> {
  const workflows = readWorkflows();
  const activeWorkflows = workflows.filter((w) => w.isActive);
  const matchingWorkflows = activeWorkflows.filter((w) => doesTriggerMatch(w, eventType, payload));

  if (matchingWorkflows.length === 0) {
    console.log(`[WorkflowTrigger] No active workflows matched event: ${eventType}`);
    return [];
  }

  console.log(`[WorkflowTrigger] Event "${eventType}" matched ${matchingWorkflows.length} workflow(s)`);

  const results = await Promise.allSettled(
    matchingWorkflows.map((wf) =>
      executeWorkflow(wf, eventType, payload, { dashboardUrl }).catch((err) => {
        console.error(`[WorkflowTrigger] Workflow "${wf.name}" failed:`, err);
        throw err;
      })
    )
  );

  return results
    .filter((r): r is PromiseFulfilledResult<WorkflowRun> => r.status === "fulfilled")
    .map((r) => r.value);
}

// ── Cron Helper: evaluate if a cron expression is due ────────────────────────

export function isCronDue(cronExpression: string, lastRunAt?: string): boolean {
  try {
    const now = new Date();
    const [minute, hour, dom, month, dow] = cronExpression.split(" ");

    const matchField = (field: string, value: number): boolean => {
      if (field === "*") return true;
      if (field.startsWith("*/")) {
        const step = parseInt(field.slice(2));
        return value % step === 0;
      }
      return parseInt(field) === value;
    };

    const due =
      matchField(minute, now.getMinutes()) &&
      matchField(hour, now.getHours()) &&
      matchField(dom, now.getDate()) &&
      matchField(month, now.getMonth() + 1) &&
      matchField(dow, now.getDay());

    if (!due) return false;

    // Prevent double-firing within the same minute
    if (lastRunAt) {
      const last = new Date(lastRunAt);
      if (
        last.getFullYear() === now.getFullYear() &&
        last.getMonth() === now.getMonth() &&
        last.getDate() === now.getDate() &&
        last.getHours() === now.getHours() &&
        last.getMinutes() === now.getMinutes()
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function fireScheduledWorkflows(dashboardUrl?: string): Promise<WorkflowRun[]> {
  const workflows = readWorkflows();
  const scheduledActive = workflows.filter(
    (w) => w.isActive && w.nodes.some((n) => n.type === "scheduled")
  );

  const runsFile = path.join(DATA_DIR, "workflow_runs.json");
  let runs: any[] = [];
  try {
    if (fs.existsSync(runsFile)) runs = JSON.parse(fs.readFileSync(runsFile, "utf-8"));
  } catch {}

  const results: WorkflowRun[] = [];

  for (const wf of scheduledActive) {
    const triggerNode = wf.nodes.find((n) => n.type === "scheduled");
    if (!triggerNode) continue;

    const cronExpr = triggerNode.config?.cronExpression || "0 9 * * *";
    const lastRun = runs.find((r) => r.workflowId === wf.id);
    const lastRunAt = lastRun?.startedAt;

    if (isCronDue(cronExpr, lastRunAt)) {
      console.log(`[WorkflowCron] Firing scheduled workflow: "${wf.name}"`);
      const run = await executeWorkflow(wf, "cron", { scheduled: true, cronExpression: cronExpr }, { dashboardUrl });
      results.push(run);
    }
  }

  return results;
}
