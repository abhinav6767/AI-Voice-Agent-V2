"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Play, Pause, Copy, Trash2, Edit3, GitBranch,
  UserPlus, PhoneOff, Clock, Webhook, RefreshCw, FileText, Tag, Heart,
  Mail, MessageCircle, Calendar, Globe, Zap, ChevronRight, Sparkles,
} from "lucide-react";
import type { Workflow } from "@/lib/workflow-types";
import { toggleWorkflow, deleteWorkflow, duplicateWorkflow } from "@/lib/workflow-actions";
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from "@/lib/workflow-templates";
import { createWorkflow } from "@/lib/workflow-actions";
import AiGenerateModal from "./AiGenerateModal";

const TRIGGER_ICON_MAP: Record<string, React.ElementType> = {
  new_lead: UserPlus,
  call_completed: PhoneOff,
  scheduled: Clock,
  webhook_received: Webhook,
  lead_status_changed: RefreshCw,
  form_submitted: FileText,
  lead_tag_added: Tag,
  sentiment_detected: Heart,
};

const TEMPLATE_ICON_MAP: Record<string, React.ElementType> = {
  Mail, GitBranch, PhoneOff, Calendar, Globe, RefreshCw,
};

interface Props {
  workflows: Workflow[];
  onRefresh: () => void;
  onViewRuns?: (workflowId: string) => void;
  onManualRun?: (workflowId: string) => void;
  manualRunning?: string | null;
}

export default function WorkflowList({ workflows, onRefresh, onViewRuns, onManualRun, manualRunning }: Props) {
  const router = useRouter();
  const [showTemplates, setShowTemplates] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAiModal, setShowAiModal] = useState(false);

  const handleToggle = async (id: string) => {
    await toggleWorkflow(id);
    onRefresh();
  };

  const handleDuplicate = async (id: string) => {
    await duplicateWorkflow(id);
    onRefresh();
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setTimeout(async () => {
      await deleteWorkflow(id);
      setDeletingId(null);
      onRefresh();
    }, 300);
  };

  const handleUseTemplate = async (template: WorkflowTemplate) => {
    const wf = await createWorkflow(template.workflow);
    router.push(`/workflows/builder?id=${wf.id}`);
  };

  const getTriggerNode = (workflow: Workflow) => {
    return workflow.nodes.find((n) => n.category === "trigger");
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-[#e6edf3]">
            Workflow Automations
          </h2>
          <p className="text-gray-500 dark:text-[#8b949e] mt-1">
            Create automated workflows triggered by calls, leads, and events.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-gray-200 dark:border-[#30363d] text-gray-700 dark:text-[#c9d1d9] bg-white dark:bg-[#21262d] hover:bg-gray-50 dark:hover:bg-[#30363d] transition-all shadow-sm"
          >
            <Zap className="w-4 h-4" />
            Templates
          </button>
          <button
            onClick={() => setShowAiModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-purple-200 dark:border-purple-900/50 text-purple-600 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-950/20 hover:bg-purple-100/50 dark:hover:bg-purple-950/40 transition-all shadow-sm"
          >
            <Sparkles className="w-4 h-4 text-purple-500" />
            AI Generate
          </button>
          <button
            onClick={() => router.push("/workflows/builder")}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-[#2f81f7] hover:bg-[#2672d9] transition-all shadow-sm shadow-[#2f81f7]/25"
          >
            <Plus className="w-4 h-4" />
            New Workflow
          </button>
        </div>
      </div>

      {/* Templates Section */}
      {showTemplates && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-[#c9d1d9]">
              Start from a Template
            </h3>
            <button
              onClick={() => setShowTemplates(false)}
              className="text-xs text-gray-400 dark:text-[#6e7681] hover:text-gray-600 dark:hover:text-[#8b949e]"
            >
              Hide
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {WORKFLOW_TEMPLATES.map((template, idx) => {
              const TemplateIcon = TEMPLATE_ICON_MAP[template.icon] || GitBranch;
              return (
                <button
                  key={idx}
                  onClick={() => handleUseTemplate(template)}
                  className="group p-4 rounded-xl border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] hover:border-[#2f81f7]/40 dark:hover:border-[#2f81f7]/40 hover:shadow-lg dark:hover:shadow-[0_4px_20px_rgba(47,129,247,0.1)] transition-all duration-200 text-left"
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${template.gradient} flex items-center justify-center flex-shrink-0 shadow-sm`}>
                      <TemplateIcon className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-900 dark:text-[#e6edf3] group-hover:text-[#2f81f7] transition-colors">
                        {template.name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-[#8b949e] mt-1 line-clamp-2">
                        {template.description}
                      </div>
                      <div className="mt-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-gray-100 dark:bg-[#21262d] text-gray-500 dark:text-[#8b949e] border border-gray-200 dark:border-[#30363d]">
                          {template.industry}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 dark:text-[#30363d] group-hover:text-[#2f81f7] transition-colors flex-shrink-0 mt-1" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Workflows Grid */}
      {workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-8">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#2f81f7]/10 to-[#8b5cf6]/10 border border-[#2f81f7]/20 flex items-center justify-center mb-6">
            <GitBranch className="w-10 h-10 text-[#2f81f7]" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-[#e6edf3] mb-2">
            No workflows yet
          </h3>
          <p className="text-sm text-gray-500 dark:text-[#8b949e] text-center max-w-md mb-6">
            Create your first workflow to automate tasks like sending emails, WhatsApp messages, or updating your CRM when new leads come in.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowTemplates(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-gray-200 dark:border-[#30363d] text-gray-700 dark:text-[#c9d1d9] bg-white dark:bg-[#21262d] hover:bg-gray-50 dark:hover:bg-[#30363d] transition-all"
            >
              <Zap className="w-4 h-4" />
              Browse Templates
            </button>
            <button
              onClick={() => router.push("/workflows/builder")}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-[#2f81f7] hover:bg-[#2672d9] transition-all shadow-sm shadow-[#2f81f7]/25"
            >
              <Plus className="w-4 h-4" />
              Create from Scratch
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workflows.map((workflow) => {
            const triggerNode = getTriggerNode(workflow);
            const TriggerIcon = triggerNode
              ? TRIGGER_ICON_MAP[triggerNode.type] || GitBranch
              : GitBranch;
            const isDeleting = deletingId === workflow.id;

            return (
              <div
                key={workflow.id}
                className={`group rounded-xl border bg-white dark:bg-[#161b22] overflow-hidden transition-all duration-300 ${
                  isDeleting
                    ? "opacity-0 scale-95 border-red-300 dark:border-red-500/30"
                    : "border-gray-200 dark:border-[#30363d] hover:border-gray-300 dark:hover:border-[#484f58] hover:shadow-lg dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.3)]"
                }`}
              >
                {/* Status bar */}
                <div
                  className="h-1 transition-colors"
                  style={{
                    backgroundColor: workflow.isActive ? "#3fb950" : "#30363d",
                  }}
                />

                <div className="p-4">
                  {/* Header row */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-[#21262d] border border-gray-200 dark:border-[#30363d] flex items-center justify-center">
                        <TriggerIcon className="w-5 h-5 text-gray-600 dark:text-[#8b949e]" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-[#e6edf3] line-clamp-1">
                          {workflow.name}
                        </h4>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md ${
                              workflow.isActive
                                ? "bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-500/20"
                                : "bg-gray-100 dark:bg-[#21262d] text-gray-500 dark:text-[#6e7681] border border-gray-200 dark:border-[#30363d]"
                            }`}
                          >
                            {workflow.isActive ? (
                              <><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Active</>
                            ) : (
                              "Inactive"
                            )}
                          </span>
                          <span className="text-[10px] text-gray-400 dark:text-[#6e7681]">
                            {workflow.nodes.length} nodes
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-gray-500 dark:text-[#8b949e] line-clamp-2 mb-4 min-h-[32px]">
                    {workflow.description || "No description"}
                  </p>

                  {/* Node preview chips */}
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {workflow.nodes.slice(0, 4).map((node) => {
                      const colors: Record<string, string> = {
                        trigger: "bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-500/20",
                        condition: "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20",
                        action: "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20",
                      };
                      return (
                        <span
                          key={node.id}
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${colors[node.category] || colors.action}`}
                        >
                          {node.label}
                        </span>
                      );
                    })}
                    {workflow.nodes.length > 4 && (
                      <span className="text-[10px] text-gray-400 dark:text-[#6e7681] px-1 py-0.5">
                        +{workflow.nodes.length - 4} more
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-[#21262d]">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleToggle(workflow.id)}
                        className={`p-1.5 rounded-md transition-colors ${
                          workflow.isActive
                            ? "text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10"
                            : "text-gray-400 dark:text-[#6e7681] hover:bg-gray-100 dark:hover:bg-[#21262d]"
                        }`}
                        title={workflow.isActive ? "Deactivate" : "Activate"}
                      >
                        {workflow.isActive ? (
                          <Pause className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDuplicate(workflow.id)}
                        className="p-1.5 rounded-md text-gray-400 dark:text-[#6e7681] hover:text-gray-600 dark:hover:text-[#8b949e] hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
                        title="Duplicate"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(workflow.id)}
                        className="p-1.5 rounded-md text-gray-400 dark:text-[#6e7681] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {onViewRuns && (
                        <button
                          onClick={() => onViewRuns(workflow.id)}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-gray-500 dark:text-[#6e7681] border border-gray-200 dark:border-[#30363d] hover:bg-gray-50 dark:hover:bg-[#21262d] transition-colors"
                        >
                          <Clock className="w-3 h-3" />
                          History
                        </button>
                      )}
                      {onManualRun && (
                        <button
                          onClick={() => onManualRun(workflow.id)}
                          disabled={manualRunning === workflow.id}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-[#3fb950] border border-[#3fb950]/30 hover:bg-green-50 dark:hover:bg-green-500/10 transition-colors disabled:opacity-50"
                          title="Run this workflow now (requires Manual Trigger node)"
                        >
                          {manualRunning === workflow.id ? (
                            <><RefreshCw className="w-3 h-3 animate-spin" />Running...</>
                          ) : (
                            <><Play className="w-3 h-3" />Run Now</>
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => router.push(`/workflows/builder?id=${workflow.id}`)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#2f81f7] hover:bg-[#2f81f7]/10 transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Edit
                      </button>
                    </div>
                  </div>
                </div>

                {/* Updated timestamp */}
                <div className="px-4 py-2 bg-gray-50 dark:bg-[#0d1117] border-t border-gray-100 dark:border-[#21262d]">
                  <p className="text-[10px] text-gray-400 dark:text-[#6e7681]">
                    Updated {new Date(workflow.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <AiGenerateModal
        isOpen={showAiModal}
        onClose={() => setShowAiModal(false)}
        onSuccess={onRefresh}
      />
    </div>
  );
}
