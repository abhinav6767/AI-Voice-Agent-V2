"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  X, CheckCircle, XCircle, Clock, Loader2, RefreshCw,
  ChevronDown, ChevronRight, Play, Zap, PhoneOff,
  UserPlus, Timer, AlertCircle, Info,
} from "lucide-react";
import type { WorkflowRun, WorkflowRunStep } from "@/lib/workflow-executor";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms?: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  success:  { icon: CheckCircle, color: "text-green-500",  bg: "bg-green-500/10 border-green-500/20",  label: "Success"  },
  partial:  { icon: AlertCircle, color: "text-amber-500",  bg: "bg-amber-500/10 border-amber-500/20",  label: "Partial"  },
  error:    { icon: XCircle,     color: "text-red-500",    bg: "bg-red-500/10 border-red-500/20",      label: "Error"    },
  running:  { icon: Loader2,     color: "text-blue-500",   bg: "bg-blue-500/10 border-blue-500/20",    label: "Running"  },
  skipped:  { icon: Info,        color: "text-gray-400",   bg: "bg-gray-500/10 border-gray-500/20",    label: "Skipped"  },
};

const EVENT_ICON_MAP: Record<string, React.ElementType> = {
  call_completed: PhoneOff,
  new_lead: UserPlus,
  scheduled: Timer,
  cron: Timer,
  manual: Play,
  lead_status_changed: RefreshCw,
};

// ── Step Detail ───────────────────────────────────────────────────────────────

function StepRow({ step, idx }: { step: WorkflowRunStep; idx: number }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[step.status] || STATUS_CONFIG.skipped;
  const Icon = cfg.icon;
  const hasOutput = step.output && Object.keys(step.output).length > 0;

  return (
    <div className="border border-gray-100 dark:border-[#21262d] rounded-lg overflow-hidden">
      <button
        onClick={() => hasOutput && setExpanded(!expanded)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
          hasOutput ? "hover:bg-gray-50 dark:hover:bg-[#21262d]" : ""
        } ${expanded ? "bg-gray-50 dark:bg-[#21262d]" : ""}`}
      >
        {/* Step number */}
        <div className="w-5 h-5 rounded-full bg-gray-100 dark:bg-[#30363d] flex items-center justify-center flex-shrink-0">
          <span className="text-[9px] font-bold text-gray-500 dark:text-[#6e7681]">{idx + 1}</span>
        </div>

        {/* Status icon */}
        <Icon
          className={`w-3.5 h-3.5 flex-shrink-0 ${cfg.color}`}
        />

        {/* Label */}
        <span className="text-xs font-medium text-gray-800 dark:text-[#e6edf3] flex-1 truncate">
          {step.label}
        </span>

        {/* Type badge */}
        <span className="text-[10px] text-gray-400 dark:text-[#6e7681] font-mono flex-shrink-0 hidden sm:block">
          {step.type}
        </span>

        {/* Duration */}
        <span className="text-[10px] text-gray-400 dark:text-[#6e7681] flex-shrink-0 w-10 text-right">
          {formatDuration(step.durationMs)}
        </span>

        {/* Expand chevron */}
        {hasOutput && (
          <span className="flex-shrink-0">
            {expanded ? (
              <ChevronDown className="w-3 h-3 text-gray-400" />
            ) : (
              <ChevronRight className="w-3 h-3 text-gray-400" />
            )}
          </span>
        )}
      </button>

      {/* Expanded output */}
      {expanded && hasOutput && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-100 dark:border-[#21262d]">
          {step.error && (
            <p className="text-xs text-red-500 dark:text-red-400 font-medium mb-2">
              Error: {step.error}
            </p>
          )}
          <pre className="text-[10px] font-mono text-gray-600 dark:text-[#8b949e] bg-gray-50 dark:bg-[#0d1117] rounded-md p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all">
            {JSON.stringify(step.output, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Run Card ──────────────────────────────────────────────────────────────────

function RunCard({ run, onSelect, isSelected }: { run: WorkflowRun; onSelect: () => void; isSelected: boolean }) {
  const cfg = STATUS_CONFIG[run.status] || STATUS_CONFIG.error;
  const Icon = cfg.icon;
  const EventIcon = EVENT_ICON_MAP[run.trigger.eventType] || Zap;

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-lg border transition-all ${
        isSelected
          ? "border-[#2f81f7]/50 bg-[#2f81f7]/5"
          : "border-gray-100 dark:border-[#21262d] hover:border-gray-200 dark:hover:border-[#30363d] hover:bg-gray-50 dark:hover:bg-[#161b22]"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
          <Icon className={`w-3.5 h-3.5 ${cfg.color} ${run.status === "running" ? "animate-spin" : ""}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-900 dark:text-[#e6edf3] truncate">
            {run.workflowName}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <EventIcon className="w-2.5 h-2.5 text-gray-400 dark:text-[#6e7681]" />
            <span className="text-[10px] text-gray-500 dark:text-[#8b949e]">
              {run.trigger.eventType}
            </span>
            <span className="text-[10px] text-gray-300 dark:text-[#30363d]">·</span>
            <span className="text-[10px] text-gray-400 dark:text-[#6e7681]">
              {relativeTime(run.startedAt)}
            </span>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${cfg.bg} ${cfg.color}`}>
            {cfg.label}
          </span>
          <p className="text-[10px] text-gray-400 dark:text-[#6e7681] mt-1">
            {formatDuration(run.durationMs)}
          </p>
        </div>
      </div>
    </button>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface WorkflowRunLogProps {
  workflowId?: string;   // filter to one workflow if set
  onClose?: () => void;
  onManualRun?: (workflowId: string) => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function WorkflowRunLog({ workflowId, onClose, onManualRun }: WorkflowRunLogProps) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRuns = useCallback(async () => {
    setRefreshing(true);
    try {
      const url = workflowId
        ? `/api/workflow/runs?workflowId=${workflowId}&limit=50`
        : `/api/workflow/runs?limit=50`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
        // Keep selected run in sync
        if (selectedRun) {
          const updated = (data.runs || []).find((r: WorkflowRun) => r.id === selectedRun.id);
          if (updated) setSelectedRun(updated);
        }
      }
    } catch (err) {
      console.error("Failed to fetch runs", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [workflowId, selectedRun?.id]);

  useEffect(() => {
    fetchRuns();
    const interval = setInterval(fetchRuns, 5000); // poll every 5s
    return () => clearInterval(interval);
  }, [fetchRuns]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#0d1117]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-[#21262d] flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-[#2f81f7]/10 flex items-center justify-center">
            <Clock className="w-3.5 h-3.5 text-[#2f81f7]" />
          </div>
          <span className="text-sm font-semibold text-gray-900 dark:text-[#e6edf3]">
            Run History
          </span>
          {runs.length > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-[#21262d] text-gray-500 dark:text-[#6e7681]">
              {runs.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchRuns}
            disabled={refreshing}
            className="p-1.5 rounded-md text-gray-400 dark:text-[#6e7681] hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-gray-400 dark:text-[#6e7681] hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Run List */}
        <div className={`flex flex-col border-r border-gray-100 dark:border-[#21262d] overflow-y-auto ${selectedRun ? "w-2/5" : "w-full"}`}>
          {loading ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 p-8">
              <Loader2 className="w-5 h-5 text-[#2f81f7] animate-spin" />
              <p className="text-xs text-gray-500 dark:text-[#8b949e]">Loading runs...</p>
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 p-8">
              <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-[#21262d] flex items-center justify-center">
                <Clock className="w-6 h-6 text-gray-400 dark:text-[#6e7681]" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700 dark:text-[#c9d1d9]">No runs yet</p>
                <p className="text-xs text-gray-400 dark:text-[#6e7681] mt-1">
                  Activate a workflow and trigger an event to see runs here.
                </p>
              </div>
              {onManualRun && workflowId && (
                <button
                  onClick={() => onManualRun(workflowId)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white bg-[#2f81f7] hover:bg-[#2672d9] transition-all"
                >
                  <Play className="w-3.5 h-3.5" />
                  Run Now (Test)
                </button>
              )}
            </div>
          ) : (
            <div className="p-3 space-y-1.5">
              {runs.map((run) => (
                <RunCard
                  key={run.id}
                  run={run}
                  isSelected={selectedRun?.id === run.id}
                  onSelect={() => setSelectedRun(selectedRun?.id === run.id ? null : run)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Run Detail Panel */}
        {selectedRun && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Detail Header */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-[#21262d] flex items-center justify-between flex-shrink-0">
              <div>
                <p className="text-xs font-semibold text-gray-900 dark:text-[#e6edf3]">
                  {selectedRun.workflowName}
                </p>
                <p className="text-[10px] text-gray-400 dark:text-[#6e7681] font-mono mt-0.5">
                  {selectedRun.id}
                </p>
              </div>
              <button onClick={() => setSelectedRun(null)} className="p-1 rounded text-gray-400 dark:text-[#6e7681] hover:text-gray-600 dark:hover:text-[#8b949e]">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Summary Stats */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-[#21262d] grid grid-cols-3 gap-3 flex-shrink-0">
              {[
                { label: "Status", value: STATUS_CONFIG[selectedRun.status]?.label || selectedRun.status },
                { label: "Duration", value: formatDuration(selectedRun.durationMs) },
                { label: "Steps", value: String(selectedRun.steps.length) },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <p className="text-[10px] text-gray-400 dark:text-[#6e7681]">{label}</p>
                  <p className="text-xs font-semibold text-gray-900 dark:text-[#e6edf3] mt-0.5">{value}</p>
                </div>
              ))}
            </div>

            {/* Step List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {/* Connector lines */}
              <div className="relative">
                {selectedRun.steps.map((step, idx) => (
                  <div key={step.nodeId} className="relative">
                    {idx < selectedRun.steps.length - 1 && (
                      <div className="absolute left-[13px] top-[28px] w-px h-2 bg-gray-200 dark:bg-[#21262d] z-0" />
                    )}
                    <StepRow step={step} idx={idx} />
                    {idx < selectedRun.steps.length - 1 && <div className="h-1.5" />}
                  </div>
                ))}
              </div>

              {/* Trigger payload */}
              <div className="mt-4 pt-3 border-t border-gray-100 dark:border-[#21262d]">
                <p className="text-[10px] font-semibold text-gray-500 dark:text-[#6e7681] uppercase tracking-wider mb-2">
                  Trigger Payload
                </p>
                <pre className="text-[10px] font-mono text-gray-600 dark:text-[#8b949e] bg-gray-50 dark:bg-[#0d1117] rounded-md p-2 overflow-auto max-h-32 whitespace-pre-wrap break-all">
                  {JSON.stringify(selectedRun.trigger.payload, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
