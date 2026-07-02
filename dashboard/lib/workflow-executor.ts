/**
 * Workflow Execution Engine — Phase 2
 *
 * Walks a saved Workflow's node graph starting from the trigger,
 * resolves {{expressions}}, evaluates conditions, and executes action handlers.
 * Writes a timestamped run log to data/workflow_runs.json.
 */

import fs from "fs";
import path from "path";
import type { Workflow, WorkflowNode, WorkflowEdge } from "./workflow-types";
import { resolveConfigTemplates, evaluateSwitchRule } from "./expression-engine";
import type { ExpressionContext } from "./expression-engine";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkflowRunStep {
  nodeId: string;
  label: string;
  type: string;
  status: "success" | "error" | "skipped";
  durationMs: number;
  output?: Record<string, any>;
  error?: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: "success" | "partial" | "error" | "running";
  trigger: { eventType: string; payload: Record<string, any> };
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  steps: WorkflowRunStep[];
}

// ── Storage ───────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "..", "data");
const RUNS_FILE = path.join(DATA_DIR, "workflow_runs.json");
const QUEUE_FILE = path.join(DATA_DIR, "workflow_queue.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readRuns(): WorkflowRun[] {
  try {
    if (!fs.existsSync(RUNS_FILE)) return [];
    return JSON.parse(fs.readFileSync(RUNS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeRun(run: WorkflowRun) {
  ensureDataDir();
  const runs = readRuns();
  const existingIdx = runs.findIndex((r) => r.id === run.id);
  if (existingIdx >= 0) {
    runs[existingIdx] = run;
  } else {
    runs.unshift(run);
  }
  fs.writeFileSync(RUNS_FILE, JSON.stringify(runs.slice(0, 500), null, 2), "utf-8");
}

function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ── Queue (for wait_delay) ────────────────────────────────────────────────────

export interface QueueEntry {
  id: string;
  workflowId: string;
  runId: string;
  nextNodeId: string;
  context: ExpressionContext;
  triggerPayload: Record<string, any>;
  dueAt: string;
  steps: WorkflowRunStep[];
}

function readQueue(): QueueEntry[] {
  try {
    if (!fs.existsSync(QUEUE_FILE)) return [];
    return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeQueue(queue: QueueEntry[]) {
  ensureDataDir();
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), "utf-8");
}

export function enqueueDelayedExecution(entry: QueueEntry) {
  const queue = readQueue();
  queue.push(entry);
  writeQueue(queue);
}

export function getDueQueueEntries(): QueueEntry[] {
  const queue = readQueue();
  const now = new Date();
  const due = queue.filter((e) => new Date(e.dueAt) <= now);
  const remaining = queue.filter((e) => new Date(e.dueAt) > now);
  writeQueue(remaining);
  return due;
}

// ── Graph Helpers ─────────────────────────────────────────────────────────────

function getOutgoingEdges(edges: WorkflowEdge[], nodeId: string): WorkflowEdge[] {
  return edges.filter((e) => e.sourceId === nodeId);
}

function getEdgesForPort(edges: WorkflowEdge[], nodeId: string, port: string): WorkflowEdge[] {
  return edges.filter((e) => e.sourceId === nodeId && (e.sourcePort === port || (!e.sourcePort && port === "default")));
}

function getNodeById(nodes: WorkflowNode[], id: string): WorkflowNode | undefined {
  return nodes.find((n) => n.id === id);
}

// ── Action Handlers ───────────────────────────────────────────────────────────

async function executeActionNode(
  node: WorkflowNode,
  resolvedConfig: Record<string, any>,
  ctx: ExpressionContext,
  dashboardUrl: string
): Promise<{ success: boolean; output: Record<string, any>; error?: string }> {
  const type = node.type;

  try {
    if (type === "send_gmail") {
      const integrationsFile = path.join(DATA_DIR, "integrations.json");
      let gmailTokens: { access_token?: string; refresh_token?: string } = {};
      try {
        if (fs.existsSync(integrationsFile)) {
          const integrations = JSON.parse(fs.readFileSync(integrationsFile, "utf-8"));
          gmailTokens = integrations.gmail || {};
        }
      } catch {}

      if (!gmailTokens.access_token && !gmailTokens.refresh_token) {
        return { success: false, output: {}, error: "Gmail not connected. Please connect Gmail in Integrations." };
      }

      const res = await fetch(`${dashboardUrl}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: resolvedConfig.to,
          subject: resolvedConfig.subject,
          body: resolvedConfig.body,
          accessToken: gmailTokens.access_token || "",
          refreshToken: gmailTokens.refresh_token || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, output: data, error: data.error };
      return { success: true, output: { messageId: data.messageId } };
    }

    if (type === "read_csv_leads") {
      const csvPath = path.resolve(process.cwd(), "..", resolvedConfig.filePath || "data/leads.csv");
      if (!fs.existsSync(csvPath)) {
        return { success: false, output: {}, error: `File not found: ${csvPath}` };
      }
      try {
        const content = fs.readFileSync(csvPath, "utf-8");
        const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length < 2) return { success: true, output: { leads: [] } };
        
        const headers = lines[0].split(",").map(h => h.trim());
        let leads = [];
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(",").map(v => v.trim());
          const obj: any = {};
          headers.forEach((h, idx) => {
            obj[h] = vals[idx] || "";
          });
          leads.push(obj);
        }
        
        if (resolvedConfig.limit && Number(resolvedConfig.limit) > 0) {
          leads = leads.slice(0, Number(resolvedConfig.limit));
        }
        
        // Also stick it on context so following nodes can use {{$json.leads}}
        if (!ctx.$json) ctx.$json = {};
        ctx.$json.leads = leads;
        
        return { success: true, output: { leads, count: leads.length } };
      } catch (err: any) {
        return { success: false, output: {}, error: err.message };
      }
    }

    if (type === "trigger_outbound_call") {
      const res = await fetch(`${dashboardUrl}/api/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: resolvedConfig.phoneNumber,
          prompt: resolvedConfig.message || resolvedConfig.agentConfig || "",
          overrideSystemPrompt: true,
          workflowRunId: ctx.$json?.runId || "",
          leadName: ctx.lead?.name || "",
          leadEmail: ctx.lead?.email || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, output: data, error: data.error };
      return { success: true, output: { roomName: data.roomName, dispatchId: data.dispatchId } };
    }

    if (type === "http_webhook") {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(resolvedConfig.headers || {}),
      };
      if (resolvedConfig.authentication === "bearer" && resolvedConfig.authToken) {
        headers["Authorization"] = `Bearer ${resolvedConfig.authToken}`;
      }
      const res = await fetch(resolvedConfig.url, {
        method: resolvedConfig.method || "POST",
        headers,
        body:
          resolvedConfig.method !== "GET"
            ? typeof resolvedConfig.body === "string"
              ? resolvedConfig.body
              : JSON.stringify(resolvedConfig.body || {})
            : undefined,
        signal: AbortSignal.timeout(resolvedConfig.timeout || 15000),
      });
      const text = await res.text();
      let parsed: any = text;
      try { parsed = JSON.parse(text); } catch {}
      if (!res.ok) return { success: false, output: { status: res.status, body: parsed }, error: `HTTP ${res.status}` };
      return { success: true, output: { status: res.status, body: parsed } };
    }

    if (type === "update_lead_status") {
      const phone = ctx.lead?.phone || ctx.$json?.phone || "";
      if (!phone) return { success: false, output: {}, error: "No phone number in context" };
      const leadsMetaFile = path.join(DATA_DIR, "leads_meta.json");
      const meta: Record<string, any> = fs.existsSync(leadsMetaFile)
        ? JSON.parse(fs.readFileSync(leadsMetaFile, "utf-8"))
        : {};
      if (!meta[phone]) meta[phone] = {};
      meta[phone].status = resolvedConfig.newStatus;
      meta[phone].lastActivity = new Date().toISOString();
      fs.writeFileSync(leadsMetaFile, JSON.stringify(meta, null, 2), "utf-8");
      return { success: true, output: { phone, newStatus: resolvedConfig.newStatus } };
    }

    if (type === "add_tag") {
      const phone = ctx.lead?.phone || ctx.$json?.phone || "";
      if (!phone) return { success: false, output: {}, error: "No phone number in context" };
      const leadsMetaFile = path.join(DATA_DIR, "leads_meta.json");
      const meta: Record<string, any> = fs.existsSync(leadsMetaFile)
        ? JSON.parse(fs.readFileSync(leadsMetaFile, "utf-8"))
        : {};
      if (!meta[phone]) meta[phone] = {};
      const tags: string[] = meta[phone].tags || [];
      if (!tags.includes(resolvedConfig.tagName)) tags.push(resolvedConfig.tagName);
      meta[phone].tags = tags;
      meta[phone].lastActivity = new Date().toISOString();
      fs.writeFileSync(leadsMetaFile, JSON.stringify(meta, null, 2), "utf-8");
      return { success: true, output: { phone, tagAdded: resolvedConfig.tagName } };
    }

    if (type === "remove_tag") {
      const phone = ctx.lead?.phone || ctx.$json?.phone || "";
      if (!phone) return { success: false, output: {}, error: "No phone number in context" };
      const leadsMetaFile = path.join(DATA_DIR, "leads_meta.json");
      const meta: Record<string, any> = fs.existsSync(leadsMetaFile)
        ? JSON.parse(fs.readFileSync(leadsMetaFile, "utf-8"))
        : {};
      if (!meta[phone]) meta[phone] = {};
      meta[phone].tags = (meta[phone].tags || []).filter((t: string) => t !== resolvedConfig.tagName);
      meta[phone].lastActivity = new Date().toISOString();
      fs.writeFileSync(leadsMetaFile, JSON.stringify(meta, null, 2), "utf-8");
      return { success: true, output: { phone, tagRemoved: resolvedConfig.tagName } };
    }

    if (type === "add_note") {
      const phone = ctx.lead?.phone || ctx.$json?.phone || "";
      if (!phone) return { success: false, output: {}, error: "No phone number in context" };
      const leadsMetaFile = path.join(DATA_DIR, "leads_meta.json");
      const meta: Record<string, any> = fs.existsSync(leadsMetaFile)
        ? JSON.parse(fs.readFileSync(leadsMetaFile, "utf-8"))
        : {};
      if (!meta[phone]) meta[phone] = {};
      if (!meta[phone].notes) meta[phone].notes = [];
      meta[phone].notes.push({ text: resolvedConfig.noteText, timestamp: new Date().toISOString() });
      meta[phone].lastActivity = new Date().toISOString();
      fs.writeFileSync(leadsMetaFile, JSON.stringify(meta, null, 2), "utf-8");
      return { success: true, output: { phone, noteAdded: true } };
    }

    if (type === "send_notification") {
      const notificationsFile = path.join(DATA_DIR, "notifications.json");
      const notifications: any[] = fs.existsSync(notificationsFile)
        ? JSON.parse(fs.readFileSync(notificationsFile, "utf-8"))
        : [];
      notifications.unshift({
        id: `notif_${Date.now()}`,
        message: resolvedConfig.message,
        channel: resolvedConfig.channel || "in_app",
        timestamp: new Date().toISOString(),
        read: false,
      });
      fs.writeFileSync(notificationsFile, JSON.stringify(notifications.slice(0, 200), null, 2), "utf-8");
      return { success: true, output: { notified: true } };
    }

    if (type === "send_whatsapp") {
      const waToken = process.env.WHATSAPP_API_TOKEN;
      const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      if (!waToken || !waPhoneId) {
        console.warn("[Workflow] send_whatsapp: credentials not configured. Skipping.");
        return { success: true, output: { skipped: true, reason: "WhatsApp not configured" } };
      }
      const phone = resolvedConfig.phoneNumber?.replace(/\D/g, "");
      const res = await fetch(`https://graph.facebook.com/v18.0/${waPhoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: { body: resolvedConfig.message },
        }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, output: data, error: data.error?.message };
      return { success: true, output: { messageId: data.messages?.[0]?.id } };
    }

    if (type === "wait_delay") {
      return { success: true, output: { queued: true, duration: resolvedConfig.duration, unit: resolvedConfig.unit } };
    }

    if (type === "sticky_note") {
      return { success: true, output: { skipped: true } };
    }

    if (type === "code_node") {
      try {
        const $json = ctx.$json ?? {};
        const $input = {
          all: () => [$json],
          first: () => $json,
          item: { json: $json },
        };
        // eslint-disable-next-line no-new-func
        const fn = new Function("$input", "$json", `"use strict";\n${resolvedConfig.code}`);
        const result = fn($input, $json);
        return { success: true, output: typeof result === "object" ? result : { result } };
      } catch (err: any) {
        return { success: false, output: {}, error: err.message };
      }
    }

    console.warn(`[Workflow] Unknown action node type: ${type}. Skipping.`);
    return { success: true, output: { skipped: true, reason: `Unsupported node type: ${type}` } };

  } catch (err: any) {
    return { success: false, output: {}, error: err?.message ?? String(err) };
  }
}

// ── Condition Evaluator ───────────────────────────────────────────────────────

function evaluateCondition(
  node: WorkflowNode,
  resolvedConfig: Record<string, any>,
  ctx: ExpressionContext
): { passed: boolean; port: string } {
  const type = node.type;

  if (type === "if_else") {
    const passed = evaluateSwitchRule(
      { field: resolvedConfig.field, operator: resolvedConfig.operator, value: resolvedConfig.value },
      ctx
    );
    return { passed, port: passed ? "yes" : "no" };
  }

  if (type === "switch_router") {
    for (const rule of (resolvedConfig.rules || [])) {
      if (evaluateSwitchRule(rule, ctx)) {
        return { passed: true, port: `output_${rule.outputIndex}` };
      }
    }
    return { passed: resolvedConfig.fallthrough, port: "fallback" };
  }

  if (type === "filter_by_tag") {
    const tags: string[] = ctx.lead?.tags || ctx.$json?.tags || [];
    const has = tags.includes(resolvedConfig.tagName);
    const passed = resolvedConfig.hasTag ? has : !has;
    return { passed, port: passed ? "yes" : "no" };
  }

  if (type === "check_lead_field") {
    const passed = evaluateSwitchRule(
      { field: resolvedConfig.field, operator: resolvedConfig.operator, value: resolvedConfig.value },
      ctx
    );
    return { passed, port: passed ? "yes" : "no" };
  }

  if (type === "check_call_count") {
    const count = ctx.call?.count ?? ctx.$json?.call_count ?? 0;
    let passed = false;
    if (resolvedConfig.operator === "greater_than") passed = count > resolvedConfig.value;
    else if (resolvedConfig.operator === "less_than") passed = count < resolvedConfig.value;
    else passed = count === resolvedConfig.value;
    return { passed, port: passed ? "yes" : "no" };
  }

  if (type === "check_sentiment") {
    const sentiment = ctx.call?.sentiment ?? ctx.$json?.sentiment ?? "";
    const passed = sentiment === resolvedConfig.sentiment;
    return { passed, port: passed ? "yes" : "no" };
  }

  if (type === "loop_items") {
    if (!ctx.$loopState) ctx.$loopState = {};
    const state = ctx.$loopState[node.id];
    
    // Initialize loop state if not exists
    if (!state) {
      let items: any[] = [];
      const exprItems = resolvedConfig.itemsExpression;
      if (Array.isArray(exprItems)) items = exprItems;
      else if (typeof exprItems === "string" && exprItems.trim().startsWith("[") || exprItems.trim().startsWith("{")) {
        try { items = JSON.parse(exprItems); } catch {}
        if (!Array.isArray(items)) items = [items];
      } else if (exprItems) {
        items = [exprItems];
      }
      
      // Look for any arrays in the resolved config if no expression, or fallback to $json array
      if (items.length === 0) {
        if (Array.isArray(ctx.$json)) items = ctx.$json;
        else if (Array.isArray(ctx.$json.leads)) items = ctx.$json.leads;
        else if (Array.isArray(ctx.$json.items)) items = ctx.$json.items;
      }
      
      ctx.$loopState[node.id] = { index: 0, items };
    }
    
    const currentState = ctx.$loopState[node.id];
    if (currentState.index < currentState.items.length) {
      // Loop: set next item into context
      const item = currentState.items[currentState.index];
      if (!ctx.$json) ctx.$json = {};
      ctx.$json.item = item; 
      ctx.$runIndex = currentState.index;
      
      // Increment for next time
      currentState.index++;
      
      return { passed: true, port: "loop" };
    } else {
      // Done: cleanup state and output to done port
      delete ctx.$loopState[node.id];
      ctx.$runIndex = 0;
      if (ctx.$json) delete ctx.$json.item;
      return { passed: true, port: "done" };
    }
  }

  return { passed: true, port: "default" };
}

// ── Main Executor ─────────────────────────────────────────────────────────────

export async function executeWorkflow(
  workflow: Workflow,
  eventType: string,
  triggerPayload: Record<string, any>,
  opts: {
    dashboardUrl?: string;
    startNodeId?: string;
    existingRunId?: string;
    previousSteps?: WorkflowRunStep[];
    initialContext?: ExpressionContext;
  } = {}
): Promise<WorkflowRun> {
  const runId = opts.existingRunId || generateRunId();
  const startedAt = new Date().toISOString();
  const dashboardUrl = opts.dashboardUrl || process.env.DASHBOARD_URL || "http://localhost:3000";
  const steps: WorkflowRunStep[] = opts.previousSteps ? [...opts.previousSteps] : [];

  const ctx: ExpressionContext = opts.initialContext || {
    $json: { ...triggerPayload, runId },
    $nodes: {},
    $runIndex: 0,
    $trigger: { eventType, ...triggerPayload },
    lead: {
      name: triggerPayload.name || triggerPayload.lead_name || "",
      phone: triggerPayload.phone || triggerPayload.phone_number || "",
      email: triggerPayload.email || triggerPayload.lead_email || "",
      city: triggerPayload.city || "",
      status: triggerPayload.status || "",
      tags: triggerPayload.tags || [],
    },
    call: {
      direction: triggerPayload.direction || "outbound",
      duration: triggerPayload.duration || 0,
      sentiment: triggerPayload.sentiment || "",
      summary: triggerPayload.summary || "",
      transcript: triggerPayload.transcript || "",
    },
  };

  const startNode = opts.startNodeId
    ? workflow.nodes.find((n) => n.id === opts.startNodeId)
    : workflow.nodes.find((n) => n.category === "trigger");

  if (!startNode) {
    const run: WorkflowRun = {
      id: runId, workflowId: workflow.id, workflowName: workflow.name,
      status: "error", trigger: { eventType, payload: triggerPayload },
      startedAt, completedAt: new Date().toISOString(), durationMs: 0,
      steps: [{ nodeId: "unknown", label: "Trigger", type: "trigger", status: "error", durationMs: 0, error: "No trigger node found" }],
    };
    writeRun(run);
    return run;
  }

  // Write initial running state
  writeRun({ id: runId, workflowId: workflow.id, workflowName: workflow.name, status: "running", trigger: { eventType, payload: triggerPayload }, startedAt, steps });

  const queue: string[] = [startNode.id];
  const visitCounts = new Map<string, number>();
  const MAX_VISITS_PER_NODE = 100;
  let hasError = false;

  // Mark trigger as visited and log it
  if (!opts.startNodeId) {
    steps.push({
      nodeId: startNode.id, label: startNode.label, type: startNode.type,
      status: "success", durationMs: 0, output: { eventType, ...triggerPayload },
    });
    if (ctx.$nodes) ctx.$nodes[startNode.label] = { json: { eventType, ...triggerPayload } };
    visitCounts.set(startNode.id, 1);

    // Queue trigger's children
    for (const edge of getOutgoingEdges(workflow.edges, startNode.id)) {
      queue.push(edge.targetId);
    }
    queue.shift(); // remove startNode from front since we handled it
  }

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const visits = visitCounts.get(currentId) || 0;
    
    if (visits >= MAX_VISITS_PER_NODE) {
      console.warn(`[Workflow Engine] Node ${currentId} reached max visit limit (${MAX_VISITS_PER_NODE}). Breaking possible infinite loop.`);
      continue;
    }
    visitCounts.set(currentId, visits + 1);

    const node = getNodeById(workflow.nodes, currentId);
    if (!node) continue;

    // Merge all previous node outputs into $json for expression resolution
    const mergedJson: Record<string, any> = { ...triggerPayload, runId };
    for (const [, v] of Object.entries(ctx.$nodes || {})) {
      Object.assign(mergedJson, v.json);
    }
    ctx.$json = mergedJson;

    const resolvedConfig = resolveConfigTemplates(node.config || {}, ctx);
    const nodeStart = Date.now();

    // ── Condition / Flow Nodes ────────────────────────────────────────────
    if (node.category === "condition" || node.category === "flow") {
      const { passed, port } = evaluateCondition(node, resolvedConfig, ctx);
      const durationMs = Date.now() - nodeStart;

      steps.push({
        nodeId: node.id, label: node.label, type: node.type,
        status: "success", durationMs,
        output: { evaluated: true, result: passed, port },
      });
      if (ctx.$nodes) ctx.$nodes[node.label] = { json: { result: passed, port } };

      // Follow matching port edges
      const portEdges = getEdgesForPort(workflow.edges, node.id, port);
      for (const edge of portEdges) {
        queue.push(edge.targetId);
      }
      // Fallback to default edges if no port-specific ones exist
      if (portEdges.length === 0 && passed) {
        for (const edge of getOutgoingEdges(workflow.edges, node.id)) {
          if (edge.sourcePort === "default" || !edge.sourcePort) {
            queue.push(edge.targetId);
          }
        }
      }
      continue;
    }

    // ── Wait Delay ────────────────────────────────────────────────────────
    if (node.type === "wait_delay") {
      const durationMs = Date.now() - nodeStart;
      const unitMultipliers: Record<string, number> = {
        seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000,
      };
      const delayMs = (resolvedConfig.duration || 0) * (unitMultipliers[resolvedConfig.unit] || 60000);
      const dueAt = new Date(Date.now() + delayMs).toISOString();

      const nextEdges = getOutgoingEdges(workflow.edges, node.id);
      if (nextEdges.length > 0) {
        enqueueDelayedExecution({
          id: `queue_${Date.now()}`,
          workflowId: workflow.id,
          runId,
          nextNodeId: nextEdges[0].targetId,
          context: ctx,
          triggerPayload,
          dueAt,
          steps: [...steps, {
            nodeId: node.id, label: node.label, type: node.type,
            status: "success", durationMs,
            output: { queued: true, dueAt, duration: resolvedConfig.duration, unit: resolvedConfig.unit },
          }],
        });
      }

      steps.push({
        nodeId: node.id, label: node.label, type: node.type,
        status: "success", durationMs,
        output: { queued: true, dueAt, duration: resolvedConfig.duration, unit: resolvedConfig.unit },
      });

      const finalRun: WorkflowRun = {
        id: runId, workflowId: workflow.id, workflowName: workflow.name,
        status: "partial", trigger: { eventType, payload: triggerPayload },
        startedAt, completedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(startedAt).getTime(), steps,
      };
      writeRun(finalRun);
      return finalRun;
    }

    // ── Action Nodes ──────────────────────────────────────────────────────
    const { success, output, error } = await executeActionNode(node, resolvedConfig, ctx, dashboardUrl);
    const durationMs = Date.now() - nodeStart;

    steps.push({
      nodeId: node.id, label: node.label, type: node.type,
      status: success ? "success" : "error", durationMs, output, error,
    });

    if (!success) hasError = true;
    if (ctx.$nodes) ctx.$nodes[node.label] = { json: output || {} };

    // Queue next nodes
    for (const edge of getOutgoingEdges(workflow.edges, node.id)) {
      queue.push(edge.targetId);
    }
  }

  const completedAt = new Date().toISOString();
  const totalMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

  const finalRun: WorkflowRun = {
    id: runId, workflowId: workflow.id, workflowName: workflow.name,
    status: hasError ? "partial" : "success",
    trigger: { eventType, payload: triggerPayload },
    startedAt, completedAt, durationMs: totalMs, steps,
  };

  writeRun(finalRun);
  console.log(`[WorkflowExecutor] Run ${runId}: ${finalRun.status} in ${totalMs}ms, ${steps.length} steps`);
  return finalRun;
}

// ── Read Helpers ──────────────────────────────────────────────────────────────

export function getWorkflowRuns(workflowId?: string): WorkflowRun[] {
  const all = readRuns();
  if (!workflowId) return all;
  return all.filter((r) => r.workflowId === workflowId);
}

export function getWorkflowRun(runId: string): WorkflowRun | null {
  return readRuns().find((r) => r.id === runId) || null;
}
