"use client";

import React, { useState, useEffect, useCallback } from "react";
import { getWorkflows } from "@/lib/workflow-actions";
import WorkflowList from "@/components/workflows/WorkflowList";
import AiGenerateModal from "@/components/workflows/AiGenerateModal";
import WorkflowRunLog from "@/components/workflows/WorkflowRunLog";
import type { Workflow } from "@/lib/workflow-types";
import { Sparkles, ArrowRight, Clock, Play, X } from "lucide-react";

// ── Inline AI Quick-Prompt Banner ─────────────────────────────────────────────

function AiPromptBanner({ onOpen }: { onOpen: (prompt?: string) => void }) {
  const [inputValue, setInputValue] = useState("");

  const PLACEHOLDER_TEXTS = [
    "When a new lead calls, send a welcome email and WhatsApp...",
    "Every morning at 9 AM, follow up with all contacted leads...",
    "After a call, wait 2 hours then trigger another AI call...",
    "Send WhatsApp and update CRM when lead status changes...",
  ];

  const [placeholderIdx, setPlaceholderIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_TEXTS.length);
    }, 3500);
    return () => clearInterval(t);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onOpen(inputValue.trim() || undefined);
    setInputValue("");
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-purple-200/50 dark:border-purple-500/20 bg-gradient-to-br from-purple-50 to-indigo-50/50 dark:from-[#1a0d2e]/50 dark:to-[#0d1117] p-5 mb-6">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-64 h-full opacity-10 pointer-events-none">
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-purple-500 blur-3xl" />
        <div className="absolute bottom-0 right-16 w-24 h-24 rounded-full bg-indigo-500 blur-2xl" />
      </div>

      <div className="relative">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <span className="text-sm font-bold text-gray-900 dark:text-[#e6edf3]">
              Build with AI
            </span>
            <span className="ml-2 text-[10px] font-medium px-1.5 py-px rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30">
              NEW
            </span>
          </div>
        </div>

        <p className="text-xs text-gray-500 dark:text-[#8b949e] mb-3">
          Describe your automation in plain English — AI will build the workflow for you instantly.
        </p>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="flex-1 relative">
            <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-purple-400 pointer-events-none" />
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={PLACEHOLDER_TEXTS[placeholderIdx]}
              className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-purple-200 dark:border-purple-500/30
                bg-white dark:bg-[#0d1117] text-gray-900 dark:text-[#e6edf3]
                placeholder-gray-400 dark:placeholder-[#484f58]
                focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500
                transition-all"
            />
          </div>
          <button
            type="submit"
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-white
              bg-gradient-to-r from-purple-600 to-indigo-600
              hover:from-purple-700 hover:to-indigo-700
              shadow-md shadow-purple-500/20 transition-all active:scale-95 flex-shrink-0"
          >
            Generate
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAiModal, setShowAiModal] = useState(false);
  const [prefilledPrompt, setPrefilledPrompt] = useState("");
  const [showRunLog, setShowRunLog] = useState(false);
  const [runLogWorkflowId, setRunLogWorkflowId] = useState<string | undefined>(undefined);
  const [manualRunning, setManualRunning] = useState<string | null>(null);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getWorkflows();
      setWorkflows(data);
    } catch (err) {
      console.error("Failed to fetch workflows:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  // Poll the cron endpoint once a minute to handle scheduled workflows
  useEffect(() => {
    const fireCron = () => fetch("/api/workflow/cron").catch(() => {});
    fireCron();
    const t = setInterval(fireCron, 60000);
    return () => clearInterval(t);
  }, []);

  const openAiModal = (prompt?: string) => {
    setPrefilledPrompt(prompt || "");
    setShowAiModal(true);
  };

  const openRunLog = (workflowId?: string) => {
    setRunLogWorkflowId(workflowId);
    setShowRunLog(true);
  };

  const handleManualRun = async (workflowId: string) => {
    setManualRunning(workflowId);
    try {
      const res = await fetch("/api/workflow/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "manual",
          payload: { manual: true, triggeredAt: new Date().toISOString() },
        }),
      });
      const data = await res.json();
      if (data.triggered > 0) {
        openRunLog(workflowId);
      } else {
        alert("No active workflow with a 'Manual Trigger' matched. Make sure the workflow is active and uses a Manual Trigger node.");
      }
    } catch {
      alert("Failed to run workflow. Check console for errors.");
    } finally {
      setManualRunning(null);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#2f81f7] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500 dark:text-[#8b949e]">Loading workflows...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col transition-colors duration-200">
      {/* Top bar with Run History button */}
      <div className="flex items-center justify-end mb-4 flex-shrink-0">
        <button
          onClick={() => openRunLog(undefined)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-gray-700 dark:text-[#c9d1d9] border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#21262d] hover:bg-gray-50 dark:hover:bg-[#30363d] transition-all"
        >
          <Clock className="w-3.5 h-3.5" />
          Run History
        </button>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden">
        {/* Main Content */}
        <div className={`flex flex-col flex-1 overflow-y-auto transition-all ${showRunLog ? "pr-2" : ""}`}>
          {/* AI Prompt Banner */}
          <AiPromptBanner onOpen={openAiModal} />

          {/* Workflow list */}
          <WorkflowList
            workflows={workflows}
            onRefresh={fetchWorkflows}
            onViewRuns={openRunLog}
            onManualRun={handleManualRun}
            manualRunning={manualRunning}
          />
        </div>

        {/* Run Log Side Panel */}
        {showRunLog && (
          <div className="w-[480px] flex-shrink-0 rounded-xl border border-gray-200 dark:border-[#30363d] overflow-hidden shadow-xl dark:shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
            <WorkflowRunLog
              workflowId={runLogWorkflowId}
              onClose={() => setShowRunLog(false)}
              onManualRun={handleManualRun}
            />
          </div>
        )}
      </div>

      {/* AI Modal */}
      <AiGenerateModal
        isOpen={showAiModal}
        onClose={() => { setShowAiModal(false); setPrefilledPrompt(""); }}
        onSuccess={fetchWorkflows}
        initialPrompt={prefilledPrompt}
      />
    </div>
  );
}
