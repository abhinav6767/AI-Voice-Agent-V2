"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Mail, MessageCircle, Instagram, Key, Check, Plus, AlertCircle,
  Eye, EyeOff, Trash2, Save, Settings, Sparkles, X,
  CheckCircle2, ShieldCheck, CalendarDays,
} from "lucide-react";


interface Integration {
  id: string;
  name: string;
  category: string;
  icon: React.ElementType;
  color: string;
  gradient: string;
  description: string;
  status: "connected" | "disconnected";
  configFields: {
    name: string;
    label: string;
    type: "text" | "password";
    placeholder: string;
    helperText?: string;
  }[];
}

function IntegrationsContent() {
  const searchParams = useSearchParams();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [activeIntegration, setActiveIntegration] = useState<Integration | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [savedConfigs, setSavedConfigs] = useState<Record<string, Record<string, string>>>({});
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
  const [gmailSuccess, setGmailSuccess] = useState(false);
  const [gcalSuccess, setGcalSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");


  // Handle Gmail OAuth callback — read token data from URL params
  useEffect(() => {
    const success = searchParams.get("gmail_success");
    const dataParam = searchParams.get("gmail_data");
    const errorParam = searchParams.get("gmail_error");
    const gcalSuccessParam = searchParams.get("gcal_success");
    const gcalDataParam = searchParams.get("gcal_data");
    const gcalErrorParam = searchParams.get("gcal_error");

    if (success === "1" && dataParam) {
      try {
        const gmailData = JSON.parse(decodeURIComponent(dataParam));
        const saved = localStorage.getItem("rapidx_credentials");
        const existing: Record<string, Record<string, string>> = saved ? JSON.parse(saved) : {};
        const updated = { ...existing, gmail: gmailData };
        localStorage.setItem("rapidx_credentials", JSON.stringify(updated));
        setSavedConfigs(updated);
        setSuccessMessage("Gmail connected successfully!");
        setGmailSuccess(true);
        setTimeout(() => setGmailSuccess(false), 4000);
        window.history.replaceState({}, "", "/integrations");
      } catch (e) {
        console.error("Failed to parse Gmail OAuth data", e);
      }
    }

    if (gcalSuccessParam === "1" && gcalDataParam) {
      try {
        const gcalData = JSON.parse(decodeURIComponent(gcalDataParam));
        const saved = localStorage.getItem("rapidx_credentials");
        const existing: Record<string, Record<string, string>> = saved ? JSON.parse(saved) : {};
        // Mark both google_calendar and gmail as connected with the same account
        const updated = {
          ...existing,
          google_calendar: gcalData,
          gmail: gcalData,
        };
        localStorage.setItem("rapidx_credentials", JSON.stringify(updated));
        setSavedConfigs(updated);
        setSuccessMessage("Google Calendar & Gmail connected!");
        setGcalSuccess(true);
        setTimeout(() => setGcalSuccess(false), 5000);
        window.history.replaceState({}, "", "/integrations");
      } catch (e) {
        console.error("Failed to parse Google Calendar OAuth data", e);
      }
    }

    if (errorParam || gcalErrorParam) {
      console.error("Google OAuth error:", errorParam || gcalErrorParam);
      window.history.replaceState({}, "", "/integrations");
    }
  }, [searchParams]);


  // Initialize integrations list and load saved credentials from localStorage
  useEffect(() => {
    // Read from localStorage if present
    const saved = localStorage.getItem("rapidx_credentials");
    let configs: Record<string, Record<string, string>> = {};
    if (saved) {
      try {
        configs = JSON.parse(saved);
        setSavedConfigs(configs);
      } catch (e) {
        console.error("Failed to parse saved credentials:", e);
      }
    }

    const list: Integration[] = [
      {
        id: "google_calendar",
        name: "Google Calendar + Gmail",
        category: "Appointments & Email",
        icon: CalendarDays,
        color: "#1a73e8",
        gradient: "from-[#1a73e8]/10 to-[#34a853]/5",
        description: "Connect your Google account to let Aayushi book, confirm, and reschedule patient appointments directly into Google Calendar during live calls — with automatic reminders.",
        status: configs["google_calendar"] ? "connected" : "disconnected",
        configFields: [],
      },
      {
        id: "gmail",
        name: "Gmail (OAuth)",
        category: "Email Outreach",
        icon: Mail,
        color: "#ea4335",
        gradient: "from-[#ea4335]/10 to-[#ea4335]/5",
        description: "Authenticate using your Google Workspace account to send automated thank-you emails and follow-ups to leads.",
        status: configs["gmail"] ? "connected" : "disconnected",
        configFields: []
      },

      {
        id: "whatsapp",
        name: "WhatsApp Business API",
        category: "Instant Messaging",
        icon: MessageCircle,
        color: "#25d366",
        gradient: "from-[#25d366]/10 to-[#25d366]/5",
        description: "Connect Meta Cloud API to trigger automated WhatsApp customer greetings, interactive chat menus, and pdf attachments.",
        status: configs["whatsapp"] ? "connected" : "disconnected",
        configFields: [
          { name: "phoneNumberId", label: "Phone Number ID", type: "text", placeholder: "e.g. 109827364512", helperText: "Found in your Meta Developer App dashboard." },
          { name: "accessToken", label: "System User Access Token", type: "password", placeholder: "EAAbw2sd1...", helperText: "Meta Permanent Access Token with whatsapp_business_messaging permissions." }
        ]
      },
      {
        id: "instagram",
        name: "Instagram Direct API",
        category: "Social Engagement",
        icon: Instagram,
        color: "#e1306c",
        gradient: "from-[#e1306c]/10 to-[#e1306c]/5",
        description: "Auto-reply to Instagram DMs, mention alerts, and trigger custom workflows when new leads interact with your profile.",
        status: configs["instagram"] ? "connected" : "disconnected",
        configFields: [
          { name: "pageId", label: "Facebook Page ID", type: "text", placeholder: "e.g. 88273649102", helperText: "The Facebook page linked to your Instagram Professional Account." },
          { name: "pageAccessToken", label: "Page Access Token", type: "password", placeholder: "EAAHz2sd1...", helperText: "Generated in Meta Developer Settings for messaging." }
        ]
      },
      {
        id: "openai",
        name: "OpenAI / LLM API",
        category: "AI Agent Intelligence",
        icon: Sparkles,
        color: "#10a37f",
        gradient: "from-[#10a37f]/10 to-[#10a37f]/5",
        description: "Configure key for OpenAI GPT-4o, Groq LLaMA, or custom inference models used to drive AI voice conversation reasoning.",
        status: configs["openai"] ? "connected" : "disconnected",
        configFields: [
          { name: "apiKey", label: "OpenAI API Key", type: "password", placeholder: "sk-proj-...", helperText: "Secure key to run high-intelligence routing calls." },
          { name: "groqKey", label: "Groq API Key (Optional)", type: "password", placeholder: "gsk_...", helperText: "Used for ultra-low latency response times." }
        ]
      }
    ];

    setIntegrations(list);
  }, [savedConfigs["google_calendar"] === undefined, savedConfigs["gmail"] === undefined, savedConfigs["whatsapp"] === undefined, savedConfigs["instagram"] === undefined, savedConfigs["openai"] === undefined]);


  const handleOpenConfig = (integration: Integration) => {
    setActiveIntegration(integration);
    // Populate form data if already saved
    setFormData(savedConfigs[integration.id] || {});
    setShowConfigModal(true);
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeIntegration) return;

    const newConfigs = {
      ...savedConfigs,
      [activeIntegration.id]: formData
    };

    setSavedConfigs(newConfigs);
    localStorage.setItem("rapidx_credentials", JSON.stringify(newConfigs));
    setShowConfigModal(false);
  };

  const handleDisconnect = (id: string) => {
    const newConfigs = { ...savedConfigs };
    delete newConfigs[id];
    setSavedConfigs(newConfigs);
    localStorage.setItem("rapidx_credentials", JSON.stringify(newConfigs));
  };

  const handleGmailOAuth = () => {
    // Redirect to unified OAuth start (now requests Gmail + Calendar scopes)
    window.location.href = "/api/auth/gmail/start";
  };

  const handleGoogleCalendarOAuth = () => {
    // Same OAuth flow — unified start route handles both Calendar + Gmail
    window.location.href = "/api/auth/gmail/start";
  };


  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Success toasts */}
      {(gmailSuccess || gcalSuccess) && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-green-50 dark:bg-green-500/15 border border-green-200 dark:border-green-500/30 shadow-xl text-green-700 dark:text-green-400 text-sm font-medium animate-in slide-in-from-right">
          <CheckCircle2 className="w-4 h-4" />
          {successMessage || "Connected successfully!"}
        </div>
      )}

      {/* Title */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-[#e6edf3]">
          Integrations & Credentials
        </h2>
        <p className="text-gray-500 dark:text-[#8b949e] mt-1">
          Securely manage your APIs, credentials, and OAuth accounts for automated workflows.
        </p>
      </div>

      {/* Grid of integrations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {integrations.map((item) => {
          const Icon = item.icon;
          const isConnected = savedConfigs[item.id] !== undefined;

          return (
            <div
              key={item.id}
              className={`group flex flex-col justify-between p-5 rounded-2xl border bg-white/80 dark:bg-[#161b22]/60 backdrop-blur-md hover:shadow-xl dark:hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-all duration-300 ${
                isConnected
                  ? "border-green-500/20 dark:border-green-400/15 shadow-[0_4px_20px_rgba(34,197,94,0.04)]"
                  : "border-gray-200/50 dark:border-white/8 hover:border-gray-300/60 dark:hover:border-white/12"
              }`}
            >
              <div>
                {/* Header row */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${item.gradient} flex items-center justify-center flex-shrink-0`}
                      style={{ border: `1px solid ${item.color}20` }}
                    >
                      <Icon className="w-6 h-6" style={{ color: item.color }} />
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold tracking-wider text-gray-400 dark:text-[#6e7681]">
                        {item.category}
                      </span>
                      <h4 className="text-sm font-bold text-gray-900 dark:text-[#e6edf3]">
                        {item.name}
                      </h4>
                    </div>
                  </div>

                  {/* Status badge */}
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                      isConnected
                        ? "bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-500/20"
                        : "bg-gray-100 dark:bg-[#21262d] text-gray-500 dark:text-[#6e7681] border-gray-200 dark:border-[#30363d]"
                    }`}
                  >
                    {isConnected ? (
                      <>
                        <Check className="w-3 h-3 text-green-500 font-bold" />
                        Connected
                      </>
                    ) : (
                      "Not Connected"
                    )}
                  </span>
                </div>

                {/* Description */}
                <p className="text-xs text-gray-500 dark:text-[#8b949e] mt-4 leading-relaxed min-h-[48px]">
                  {item.description}
                </p>

                {/* Saved configs detail (if connected) */}
                {isConnected && (
                  <div className="mt-4 p-3 rounded-lg bg-gray-50 dark:bg-[#0d1117] border border-gray-150 dark:border-[#21262d]">
                    {(item.id === "gmail" || item.id === "google_calendar") ? (
                      <div className="flex items-center gap-3">
                        {(savedConfigs[item.id]?.picture) ? (
                          <img
                            src={savedConfigs[item.id].picture}
                            alt="Google account"
                            className="w-9 h-9 rounded-full border-2 border-green-500/30 flex-shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-[#1a73e8]/10 border border-[#1a73e8]/20 flex items-center justify-center flex-shrink-0">
                            {item.id === "google_calendar"
                              ? <CalendarDays className="w-4 h-4 text-[#1a73e8]" />
                              : <Mail className="w-4 h-4 text-[#ea4335]" />}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-900 dark:text-[#e6edf3] truncate">
                            {savedConfigs[item.id]?.name || "Google Account"}
                          </p>
                          <p className="text-[11px] text-[#2f81f7] truncate font-mono">
                            {savedConfigs[item.id]?.email}
                          </p>
                        </div>
                        <ShieldCheck className="w-4 h-4 text-green-500 flex-shrink-0 ml-auto" />
                      </div>
                    ) : (
                      <div className="space-y-1 text-[11px] font-mono text-gray-500 dark:text-[#8b949e]">
                        {Object.keys(savedConfigs[item.id]).map((key) => {
                          const val = savedConfigs[item.id][key];
                          const isSecret = key.toLowerCase().includes("token") || key.toLowerCase().includes("key");
                          return (
                            <div key={key} className="flex items-center justify-between">
                              <span>{key}:</span>
                              <span className="text-gray-900 dark:text-[#e6edf3] font-medium">
                                {isSecret ? "••••••••••••" : val}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

              </div>

              {/* Action row */}
              <div className="mt-5 pt-4 border-t border-gray-100 dark:border-[#21262d] flex items-center justify-end gap-2.5">
                {isConnected ? (
                  <>
                    <button
                      onClick={() => handleDisconnect(item.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Disconnect
                    </button>
                    {item.id !== "gmail" && (
                      <button
                        onClick={() => handleOpenConfig(item)}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-[#30363d] text-gray-700 dark:text-[#c9d1d9] bg-white dark:bg-[#21262d] hover:bg-gray-50 dark:hover:bg-[#30363d] transition-colors"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        Edit Settings
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {item.id === "gmail" || item.id === "google_calendar" ? (
                      <button
                        onClick={item.id === "google_calendar" ? handleGoogleCalendarOAuth : handleGmailOAuth}
                        className="flex items-center gap-2.5 px-4 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 shadow-sm transition-all"
                      >
                        {/* Google G logo */}
                        <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                          <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                          <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                          <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
                          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                        </svg>
                        {item.id === "google_calendar" ? "Connect Google Calendar" : "Sign in with Google"}
                      </button>

                    ) : (
                      <button
                        onClick={() => handleOpenConfig(item)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#2f81f7] hover:bg-[#2672d9] shadow-sm shadow-[#2f81f7]/25 transition-all"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Configure API
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Info card */}
      <div className="p-4 rounded-xl border border-indigo-200/50 dark:border-indigo-500/10 bg-indigo-50/30 dark:bg-indigo-500/5 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-0.5" />
        <div>
          <h5 className="text-xs font-bold text-blue-700 dark:text-blue-400">
            How credentials are secured
          </h5>
          <p className="text-[11px] text-gray-500 dark:text-[#8b949e] mt-1 leading-relaxed">
            All workspace credentials and API tokens are encrypted and saved locally in your developer environment's localStorage cache. They never pass through our telemetry or external trackers, guaranteeing total client data sovereignty.
          </p>
        </div>
      </div>

      {/* Configuration dialog modal */}
      {showConfigModal && activeIntegration && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all">
           <div className="w-full max-w-md bg-white/95 dark:bg-[#161b22]/95 backdrop-blur-2xl border border-gray-200/50 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-[#30363d] bg-gray-50/50 dark:bg-[#0d1117]/50">
              <div className="flex items-center gap-2">
                <Key className="w-4.5 h-4.5 text-[#2f81f7]" />
                <h3 className="text-sm font-bold text-gray-900 dark:text-[#e6edf3]">
                  Configure {activeIntegration.name}
                </h3>
              </div>
              <button
                onClick={() => setShowConfigModal(false)}
                className="p-1 rounded-lg text-gray-400 dark:text-[#6e7681] hover:text-gray-600 dark:hover:text-[#e6edf3] hover:bg-gray-100 dark:hover:bg-[#21262d] transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal body form */}
            <form onSubmit={handleSaveConfig} className="p-6 space-y-4">
              {activeIntegration.configFields.map((field) => {
                const isPassword = field.type === "password";
                const isVisible = showPassword[field.name];

                return (
                  <div key={field.name} className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-700 dark:text-[#c9d1d9]">
                      {field.label}
                    </label>
                    <div className="relative">
                      <input
                        type={isPassword && !isVisible ? "password" : "text"}
                        value={formData[field.name] || ""}
                        onChange={(e) =>
                          setFormData({ ...formData, [field.name]: e.target.value })
                        }
                        placeholder={field.placeholder}
                        required
                        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-250 dark:border-[#30363d] bg-gray-50 dark:bg-[#0d1117] text-gray-900 dark:text-[#e6edf3] placeholder-gray-400 dark:placeholder-[#484f58] focus:outline-none focus:ring-2 focus:ring-[#2f81f7]/30 focus:border-[#2f81f7] transition-all pr-10"
                      />
                      {isPassword && (
                        <button
                          type="button"
                          onClick={() =>
                            setShowPassword({ ...showPassword, [field.name]: !isVisible })
                          }
                          className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 dark:text-[#6e7681] hover:text-gray-600 dark:hover:text-[#e6edf3]"
                        >
                          {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                    {field.helperText && (
                      <p className="text-[10px] text-gray-400 dark:text-[#6e7681] leading-relaxed">
                        {field.helperText}
                      </p>
                    )}
                  </div>
                );
              })}

              {/* Action buttons */}
              <div className="pt-4 border-t border-gray-100 dark:border-[#21262d] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold border border-gray-200 dark:border-[#30363d] text-gray-700 dark:text-[#c9d1d9] bg-white dark:bg-[#21262d] hover:bg-gray-50 dark:hover:bg-[#30363d] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#2f81f7] hover:bg-[#2672d9] shadow-sm shadow-[#2f81f7]/20 transition-all"
                >
                  <Save className="w-4 h-4" />
                  Save Credentials
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#2f81f7]"></div>
      </div>
    }>
      <IntegrationsContent />
    </Suspense>
  );
}
