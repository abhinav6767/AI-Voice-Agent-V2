"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    Users, Upload, Play, Loader2, RefreshCw, ChevronDown, StopCircle,
    Globe, FileText, Download, CheckCircle2, XCircle, PhoneMissed,
    Phone, Brain, Table2, AlertCircle, Clock, BookMarked, Save, Trash2, Plus, X, Bot
} from 'lucide-react';
import type { ProviderCatalog, VoiceOption, ModelOption } from '@/lib/providers';
import { FALLBACK_CATALOG, STT_LANGUAGES } from '@/lib/providers';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeadRow {
    [key: string]: string;
}

interface CampaignResult {
    row_index: number;
    phone_number: string;
    lead_email: string;
    status: "Called" | "No Answer" | "Failed" | "Pending";
    remarks: string;
    sentiment: "Positive" | "Neutral" | "Negative" | "";
    intent: string;
    timestamp: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateCampaignId(): string {
    return `bulk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

// ── Campaign Template type ────────────────────────────────────────────────────
interface CampaignTemplate {
    id: string;
    name: string;
    config: {
        prompt: string;
        agentName: string;
        greeting: string;
        ttsProvider: string;
        voice: string;
        language: string;
        llmProvider: string;
        ragContent: string;
        ragFileName: string;
    };
    created_at: string;
}

function parseCSV(text: string): { columns: string[]; rows: LeadRow[] } {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length === 0) return { columns: [], rows: [] };
    const columns = lines[0].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map(line => {
        // Handle quoted cells
        const cells: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { inQuotes = !inQuotes; }
            else if (ch === ',' && !inQuotes) { cells.push(current.trim()); current = ''; }
            else { current += ch; }
        }
        cells.push(current.trim());
        const row: LeadRow = {};
        columns.forEach((col, idx) => { row[col] = cells[idx] ?? ''; });
        return row;
    }).filter(row => Object.values(row).some(v => v.trim() !== ''));
    return { columns, rows };
}

async function parseXLSX(file: File): Promise<{ columns: string[]; rows: LeadRow[] }> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = (await import('xlsx')).default;
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const jsonData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (jsonData.length === 0) return { columns: [], rows: [] };
    const columns = (jsonData[0] as string[]).map(c => String(c).trim());
    const rows = jsonData.slice(1).map(r => {
        const row: LeadRow = {};
        columns.forEach((col, idx) => { row[col] = String((r as any[])[idx] ?? '').trim(); });
        return row;
    }).filter(row => Object.values(row).some(v => v.trim() !== ''));
    return { columns, rows };
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
    const map: Record<string, { color: string; label: string }> = {
        Positive: { color: '#3fb950', label: '😊 Positive' },
        Negative: { color: '#f85149', label: '😞 Negative' },
        Neutral:  { color: '#d29922', label: '😐 Neutral'  },
    };
    const s = map[sentiment] || { color: '#8b949e', label: sentiment || '—' };
    return (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: `${s.color}20`, color: s.color, border: `1px solid ${s.color}40` }}>
            {s.label}
        </span>
    );
}

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { icon: any; color: string }> = {
        Called:     { icon: CheckCircle2,  color: '#3fb950' },
        'No Answer':{ icon: PhoneMissed,   color: '#d29922' },
        Failed:     { icon: XCircle,       color: '#f85149' },
        Pending:    { icon: Clock,         color: '#8b949e' },
        Dialing:    { icon: Phone,         color: '#2f81f7' },
    };
    const s = map[status] || { icon: Clock, color: '#8b949e' };
    const Icon = s.icon;
    return (
        <span className="flex items-center gap-1 text-[10px] font-semibold"
            style={{ color: s.color }}>
            <Icon className="w-3 h-3" />
            {status}
        </span>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function BulkDialer() {
    // ── File / leads state
    const [leadsFile, setLeadsFile] = useState<File | null>(null);
    const [columns, setColumns] = useState<string[]>([]);
    const [leads, setLeads] = useState<LeadRow[]>([]);
    const [columnMap, setColumnMap] = useState({ phone: '', name: '', email: '' });
    const [extraColumns, setExtraColumns] = useState<string[]>([]);
    const [parseError, setParseError] = useState('');

    // ── RAG state
    const [ragFile, setRagFile] = useState<File | null>(null);
    const [ragContent, setRagContent] = useState('');
    const [ragLoading, setRagLoading] = useState(false);
    const [ragInfo, setRagInfo] = useState<{ charCount: number; fileName: string; truncated?: boolean } | null>(null);

    // ── Campaign state
    const [prompt, setPrompt] = useState('');
    const [agentName, setAgentName] = useState('');
    const [greeting, setGreeting] = useState('');
    const [campaignId, setCampaignId] = useState('');
    const [status, setStatus] = useState<'idle' | 'processing' | 'dialing' | 'completed' | 'error'>('idle');
    const [progress, setProgress] = useState({ total: 0, current: 0 });
    const [message, setMessage] = useState('');
    const [campaignResults, setCampaignResults] = useState<CampaignResult[]>([]);
    const [isCancelled, setIsCancelled] = useState(false);
    const cancelRef = useRef(false);

    // ── Campaign Template state
    const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
    const [templatesLoading, setTemplatesLoading] = useState(false);
    const [showSaveModal, setShowSaveModal] = useState(false);
    const [newTemplateName, setNewTemplateName] = useState('');
    const [savingTemplate, setSavingTemplate] = useState(false);
    const [templateSaveError, setTemplateSaveError] = useState('');

    // ── Provider state
    const [catalog, setCatalog] = useState<ProviderCatalog>(FALLBACK_CATALOG);
    const [catalogLoading, setCatalogLoading] = useState(true);
    const [liveStatus, setLiveStatus] = useState<Record<string, boolean>>({});
    const [selectedProvider, setSelectedProvider] = useState('groq');
    const [selectedVoice, setSelectedVoice] = useState('aravind');
    const [selectedTtsProvider, setSelectedTtsProvider] = useState('sarvam');
    const [selectedLanguage, setSelectedLanguage] = useState('en-IN');

    // ── Voice preview
    const [previewState, setPreviewState] = useState<"idle" | "loading" | "playing">("idle");
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // ── Prompt editor refs
    const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

    // ── Polling ref
    const pollingRef = useRef<NodeJS.Timeout | null>(null);

    // ── Load catalog & agent config
    const loadCatalog = async () => {
        setCatalogLoading(true);
        try {
            const res = await fetch('/api/providers');
            if (!res.ok) throw new Error('Failed');
            const data = await res.json();
            setCatalog(data.catalog);
            setLiveStatus(data.live_fetched ?? {});
        } catch { /* keep fallback */ } finally { setCatalogLoading(false); }
    };

    useEffect(() => {
        Promise.all([
            fetch('/api/agent-config?mode=outbound').then(r => r.json()).catch(() => null),
            loadCatalog(),
            loadTemplates(),
        ]).then(([configData]) => {
            if (configData?.config) {
                if (configData.config.llm_provider) setSelectedProvider(configData.config.llm_provider);
                if (configData.config.tts_provider) setSelectedTtsProvider(configData.config.tts_provider);
                if (configData.config.tts_voice) setSelectedVoice(configData.config.tts_voice);
                if (configData.config.tts_language) setSelectedLanguage(configData.config.tts_language);
            }
        });
    }, []);

    // ── Load templates from API
    const loadTemplates = async () => {
        setTemplatesLoading(true);
        try {
            const res = await fetch('/api/campaign/templates');
            if (res.ok) {
                const data = await res.json();
                setTemplates(data.templates || []);
            }
        } catch { /* non-fatal */ } finally { setTemplatesLoading(false); }
    };

    // ── Save current state as a new template
    const handleSaveTemplate = async () => {
        if (!newTemplateName.trim()) return;
        setSavingTemplate(true);
        setTemplateSaveError('');
        try {
            const res = await fetch('/api/campaign/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newTemplateName.trim(),
                    config: {
                        prompt, agentName, greeting,
                        ttsProvider: selectedTtsProvider, voice: selectedVoice,
                        language: selectedLanguage, llmProvider: selectedProvider,
                        ragContent, ragFileName: ragInfo?.fileName || '',
                    },
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                await loadTemplates();
                setShowSaveModal(false);
                setNewTemplateName('');
                setTemplateSaveError('');
            } else {
                setTemplateSaveError(data.error || `Save failed (HTTP ${res.status})`);
            }
        } catch (e: any) {
            setTemplateSaveError(e.message || 'Network error saving template');
        } finally {
            setSavingTemplate(false);
        }
    };

    // ── Load a template into form fields
    const handleLoadTemplate = (t: CampaignTemplate) => {
        setPrompt(t.config.prompt || '');
        setAgentName(t.config.agentName || '');
        setGreeting(t.config.greeting || '');
        setSelectedTtsProvider(t.config.ttsProvider || selectedTtsProvider);
        setSelectedVoice(t.config.voice || selectedVoice);
        setSelectedLanguage(t.config.language || selectedLanguage);
        setSelectedProvider(t.config.llmProvider || selectedProvider);
        if (t.config.ragContent) {
            setRagContent(t.config.ragContent);
            setRagInfo({ charCount: t.config.ragContent.length, fileName: t.config.ragFileName || 'Loaded from template' });
        }
    };

    // ── Delete a template
    const handleDeleteTemplate = async (id: string) => {
        try {
            await fetch(`/api/campaign/templates?id=${id}`, { method: 'DELETE' });
            setTemplates(prev => prev.filter(t => t.id !== id));
        } catch { /* non-fatal */ }
    };

    // ── Poll campaign results while dialing
    useEffect(() => {
        if (status === 'dialing' && campaignId) {
            pollingRef.current = setInterval(async () => {
                try {
                    const res = await fetch(`/api/campaign/results?campaignId=${campaignId}`);
                    if (res.ok) {
                        const data = await res.json();
                        setCampaignResults(data.results || []);
                    }
                } catch { /* non-fatal */ }
            }, 4000);
        } else {
            if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
        }
        return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
    }, [status, campaignId]);

    // ── Parse leads file
    const handleLeadsFile = async (file: File) => {
        setLeadsFile(file);
        setParseError('');
        setColumns([]);
        setLeads([]);
        setColumnMap({ phone: '', name: '', email: '' });
        try {
            let parsed: { columns: string[]; rows: LeadRow[] };
            const ext = file.name.split('.').pop()?.toLowerCase() || '';
            if (ext === 'csv' || ext === 'txt') {
                const text = await file.text();
                parsed = parseCSV(text);
            } else if (ext === 'xlsx' || ext === 'xls') {
                parsed = await parseXLSX(file);
            } else {
                setParseError('Unsupported file type. Please upload CSV or Excel (.xlsx).');
                return;
            }
            if (parsed.columns.length === 0) { setParseError('Could not detect columns. Is the file empty?'); return; }
            setColumns(parsed.columns);
            setLeads(parsed.rows);
            // Auto-detect common column names
            const colsLower = parsed.columns.map(c => c.toLowerCase());
            const phoneCol  = parsed.columns[colsLower.findIndex(c => c.includes('phone') || c.includes('mobile') || c.includes('number'))] || '';
            const nameCol   = parsed.columns[colsLower.findIndex(c => c.includes('name'))] || '';
            const emailCol  = parsed.columns[colsLower.findIndex(c => c.includes('email') || c.includes('mail'))] || '';
            setColumnMap({ phone: phoneCol, name: nameCol, email: emailCol });
        } catch (err: any) {
            setParseError(`Failed to parse file: ${err.message}`);
        }
    };

    // ── Upload RAG file
    const handleRagFile = async (file: File) => {
        setRagFile(file);
        setRagContent('');
        setRagInfo(null);
        setRagLoading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch('/api/campaign/upload-rag', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');
            setRagContent(data.content);
            setRagInfo({ charCount: data.charCount, fileName: data.fileName, truncated: data.truncated });
        } catch (err: any) {
            setMessage(`RAG upload failed: ${err.message}`);
            setStatus('error');
        } finally {
            setRagLoading(false);
        }
    };

    const handleTtsProviderChange = (provider: string) => {
        setSelectedTtsProvider(provider);
        stopPreview();
        const voices = catalog.tts[provider]?.voices ?? [];
        if (voices.length > 0) setSelectedVoice(voices[0].value);
    };

    const stopPreview = () => {
        if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
        setPreviewState("idle");
    };

    const playPreview = async () => {
        stopPreview();
        setPreviewState("loading");
        try {
            const params = new URLSearchParams({ provider: selectedTtsProvider, voice: selectedVoice, model: "", language: selectedLanguage });
            const res = await fetch(`/api/voice-preview?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audioRef.current = audio;
            audio.onended = () => { setPreviewState("idle"); URL.revokeObjectURL(url); };
            audio.onerror = () => { setPreviewState("idle"); URL.revokeObjectURL(url); };
            await audio.play();
            setPreviewState("playing");
        } catch (e: any) {
            setPreviewState("idle");
            setMessage(`Preview failed: ${e.message}`);
            setStatus('error');
        }
    };

    // ── Start campaign
    const handleStartCampaign = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!columnMap.phone || !columnMap.name || !columnMap.email) {
            setStatus('error');
            setMessage('Please map all required columns: Phone, Name, and Email.');
            return;
        }
        if (leads.length === 0) { setStatus('error'); setMessage('No leads found in the uploaded file.'); return; }

        const validLeads = leads.filter(l => {
            const phone = l[columnMap.phone]?.trim();
            return phone && phone.length >= 10;
        });
        if (validLeads.length === 0) { setStatus('error'); setMessage('No valid phone numbers found in the selected column.'); return; }

        const newCampaignId = generateCampaignId();
        setCampaignId(newCampaignId);
        setCampaignResults([]);
        cancelRef.current = false;
        setIsCancelled(false);
        setStatus('dialing');
        setProgress({ total: validLeads.length, current: 0 });
        setMessage('');

        let successCount = 0, failCount = 0;

        for (let i = 0; i < validLeads.length; i++) {
            if (cancelRef.current) { setMessage(`Campaign cancelled after ${i} calls.`); break; }

            const lead = validLeads[i];
            const phone = lead[columnMap.phone]?.trim();

            // Find original row index in the full leads array
            const originalIndex = leads.findIndex(l => l === lead || (
                columnMap.phone && l[columnMap.phone] === lead[columnMap.phone]
            ));

            // Build leadData with all non-mapped columns
            const leadData: Record<string, string> = {};
            columns.forEach(col => {
                if (col !== columnMap.phone && col !== columnMap.name && col !== columnMap.email) {
                    if (lead[col]) leadData[col] = lead[col];
                }
            });

            // Resolve {{lead.COLUMN}} placeholders in the prompt for this specific lead
            const leadValues: Record<string, string> = {
                name:  columnMap.name  ? (lead[columnMap.name]?.trim()  || '') : '',
                email: columnMap.email ? (lead[columnMap.email]?.trim() || '') : '',
                phone: phone,
                ...Object.fromEntries(Object.entries(leadData).map(([k, v]) => [k.toLowerCase(), v])),
            };
            const resolvedPrompt = prompt.replace(/\{\{lead\.(\w+)\}\}/gi, (_, key) => leadValues[key.toLowerCase()] ?? `{{lead.${key}}}`);

            try {
                const res = await fetch('/api/dispatch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phoneNumber:   phone,
                        prompt:        resolvedPrompt,
                        modelProvider: selectedProvider,
                        voice:         selectedVoice,
                        ttsProvider:   selectedTtsProvider,
                        ttsLanguage:   selectedLanguage,
                        // Campaign enrichment
                        leadName:      leadValues.name,
                        leadEmail:     leadValues.email,
                        leadData,
                        ragContent,
                        campaignId:    newCampaignId,
                        leadRowIndex:  i,
                        overrideSystemPrompt: true, // Bulk Dialer always overrides
                        greeting:      greeting,
                        agentName:     agentName,
                    }),
                });
                if (res.ok) successCount++; else failCount++;
            } catch { failCount++; }

            setProgress(prev => ({ ...prev, current: i + 1 }));
            // Small delay between dispatches to avoid trunk flooding
            await new Promise(r => setTimeout(r, 1200));
        }

        setStatus('completed');
        setMessage(`Campaign finished — Dispatched: ${successCount}, Failed: ${failCount}. Results update live as calls complete.`);

        // Final poll for results
        try {
            const res = await fetch(`/api/campaign/results?campaignId=${newCampaignId}`);
            if (res.ok) { const data = await res.json(); setCampaignResults(data.results || []); }
        } catch { /* non-fatal */ }
    };

    // ── Download report
    const handleDownload = async () => {
        if (!campaignId || leads.length === 0) return;
        try {
            const res = await fetch('/api/campaign/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ campaignId, leads, columns }),
            });
            if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `campaign_${campaignId}_results.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err: any) {
            setMessage(`Download failed: ${err.message}`);
        }
    };

    // ── Reset
    const handleReset = () => {
        cancelRef.current = true;
        setStatus('idle');
        setLeadsFile(null); setColumns([]); setLeads([]); setColumnMap({ phone: '', name: '', email: '' });
        setRagFile(null); setRagContent(''); setRagInfo(null);
        setCampaignId(''); setCampaignResults([]); setProgress({ total: 0, current: 0 }); setMessage('');
        setIsCancelled(false);
    };

    // ── Derived
    const ttsProviders = Object.keys(catalog.tts || {});
    const voices: VoiceOption[] = catalog.tts[selectedTtsProvider]?.voices ?? [];
    const llmProviders = Object.keys(catalog.llm || {});
    const models: ModelOption[] = catalog.llm[selectedProvider]?.models ?? [];
    const isRunning = status === 'dialing';
    const isDone = status === 'completed' || status === 'error';

    const resultMap = new Map<number, CampaignResult>();
    campaignResults.forEach(r => resultMap.set(r.row_index, r));

    // ── Live Prompt Preview
    const promptPreview = useMemo(() => {
        if (!prompt || leads.length === 0) return null;
        let preview = prompt;
        const firstLead = leads[0];
        // Match any {{lead.xxx}} ignoring case, and replace with actual value
        preview = preview.replace(/\{\{lead\.([^}]+)\}\}/gi, (match, colName) => {
            // Find a matching column name in the actual lead object (case insensitive)
            const realKey = Object.keys(firstLead).find(k => k.toLowerCase() === colName.trim().toLowerCase());
            if (realKey && firstLead[realKey]) return firstLead[realKey];
            return match; // Keep unresolved tags as is
        });
        return preview;
    }, [prompt, leads]);

    const handleInsertTag = (column: string) => {
        if (!promptTextareaRef.current) return;
        const el = promptTextareaRef.current;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const tag = `{{lead.${column}}}`;
        const newText = prompt.substring(0, start) + tag + prompt.substring(end);
        setPrompt(newText);
        setTimeout(() => {
            el.focus();
            el.setSelectionRange(start + tag.length, start + tag.length);
        }, 0);
    };

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div className="w-full h-full overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(99,102,241,0.2) transparent' }}>
            <div className="max-w-5xl mx-auto p-6 space-y-6">

                {/* Header */}
                <div className="flex items-center justify-between pb-4 border-b border-[#30363d]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-[#a371f7]/10 text-[#a371f7] rounded-lg"><Users className="w-5 h-5" /></div>
                        <div>
                            <h2 className="text-lg font-semibold text-[#e6edf3]">Bulk Campaign</h2>
                            <p className="text-sm text-[#8b949e]">Upload a leads file, attach a knowledge base, and call everyone automatically</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={loadCatalog} disabled={catalogLoading} type="button"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#8b949e] border border-[#30363d] hover:bg-[#21262d] transition-colors">
                            <RefreshCw className={`w-3.5 h-3.5 ${catalogLoading ? 'animate-spin' : ''}`} />
                            {catalogLoading ? 'Loading...' : 'Refresh'}
                        </button>
                        {(isRunning || isDone) && (
                            <button onClick={handleReset} type="button"
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#f85149] border border-[#f85149]/30 hover:bg-[#f85149]/10 transition-colors">
                                <StopCircle className="w-3.5 h-3.5" />
                                {isRunning ? 'Cancel' : 'New Campaign'}
                            </button>
                        )}
                    </div>
                </div>

                <form onSubmit={handleStartCampaign} className="space-y-5">

                    {/* ── Campaign Templates Panel */}
                    <div className="rounded-xl border border-[#a371f7]/30 bg-[#a371f7]/5 overflow-hidden">
                        <div className="px-4 py-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <BookMarked className="w-4 h-4 text-[#a371f7]" />
                                <span className="text-sm font-semibold text-[#e6edf3]">Campaign Templates</span>
                                <span className="ml-1 text-[10px] text-[#8b949e]">Save & reload campaign configs</span>
                            </div>
                            <button type="button" onClick={() => setShowSaveModal(true)}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-[#a371f7] border border-[#a371f7]/40 hover:bg-[#a371f7]/10 transition-colors">
                                <Save className="w-3 h-3" /> Save Current as Template
                            </button>
                        </div>
                        <div className="px-4 pb-3">
                            {templatesLoading ? (
                                <div className="flex items-center gap-2 text-xs text-[#8b949e]"><Loader2 className="w-3 h-3 animate-spin" /> Loading templates...</div>
                            ) : templates.length === 0 ? (
                                <p className="text-xs text-[#484f58] italic">No saved templates yet. Configure a campaign and click "Save Current as Template".</p>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {templates.map(t => (
                                        <div key={t.id} className="flex items-center gap-1 bg-[#161b22] border border-[#30363d] rounded-lg px-2.5 py-1.5 group">
                                            <button type="button" onClick={() => handleLoadTemplate(t)}
                                                className="text-xs font-medium text-[#c9d1d9] hover:text-[#a371f7] transition-colors">
                                                {t.name}
                                            </button>
                                            <button type="button" onClick={() => handleDeleteTemplate(t.id)}
                                                className="ml-1 opacity-0 group-hover:opacity-100 p-0.5 text-[#484f58] hover:text-[#f85149] transition-all">
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Save Template Modal */}
                    {showSaveModal && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                            <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-6 w-full max-w-sm shadow-2xl">
                                <h3 className="text-sm font-semibold text-[#e6edf3] mb-1">Save as Campaign Template</h3>
                                <p className="text-xs text-[#8b949e] mb-4">Give this template a name so you can reload it later.</p>
                                <input type="text" value={newTemplateName} onChange={e => setNewTemplateName(e.target.value)}
                                    placeholder="e.g. Real Estate - Project Sunset"
                                    className="w-full px-3 py-2 text-sm bg-[#0d1117] border border-[#30363d] rounded-lg text-[#e6edf3] placeholder-[#484f58] outline-none focus:ring-1 focus:ring-[#a371f7]/50 mb-3"
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSaveTemplate(); } }}
                                    autoFocus />
                                {templateSaveError && (
                                    <div className="mb-3 px-3 py-2 rounded-lg bg-[#f85149]/10 border border-[#f85149]/30 text-xs text-[#f85149]">
                                        ✗ {templateSaveError}
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => { setShowSaveModal(false); setNewTemplateName(''); setTemplateSaveError(''); }}
                                        className="flex-1 py-2 text-xs font-semibold text-[#8b949e] border border-[#30363d] rounded-lg hover:bg-[#21262d] transition-colors">
                                        Cancel
                                    </button>
                                    <button type="button" onClick={handleSaveTemplate} disabled={!newTemplateName.trim() || savingTemplate}
                                        className="flex-1 py-2 text-xs font-semibold text-white bg-[#a371f7] hover:bg-[#9152f5] rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                                        {savingTemplate ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                        {savingTemplate ? 'Saving...' : 'Save Template'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── STEP 1: Upload Leads File */}
                    <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
                        <div className="px-4 py-3 border-b border-[#30363d] flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Table2 className="w-4 h-4 text-[#2f81f7]" />
                                <span className="text-sm font-semibold text-[#e6edf3]">Step 1 — Leads File</span>
                                <span className="ml-2 text-[10px] text-[#8b949e]">CSV or Excel (.xlsx)</span>
                            </div>
                            <a href="/sample_leads.csv" download className="text-xs text-[#2f81f7] hover:underline flex items-center gap-1">
                                <Download className="w-3 h-3" /> Download Template
                            </a>
                        </div>
                        <div className="p-4 space-y-4">
                            {/* Required Format Warning */}
                            <div className="bg-[#2f81f7]/10 border border-[#2f81f7]/30 rounded-lg p-3 text-xs text-[#c9d1d9]">
                                <span className="font-semibold text-[#2f81f7]">Strict Format Rule:</span> Your file MUST contain columns for <strong>Phone</strong>, <strong>Name</strong>, and <strong>Email</strong> to ensure the workflow engine and CRM actions function correctly. Extra columns (like City, Budget) are allowed and will be passed as lead context to the AI.
                            </div>

                            {/* Dropzone */}
                            <label className={`flex flex-col items-center justify-center w-full h-28 rounded-lg border-2 border-dashed cursor-pointer transition-colors
                                ${leadsFile ? 'border-[#2f81f7]/50 bg-[#2f81f7]/5' : 'border-[#30363d] hover:border-[#8b949e] hover:bg-[#21262d]'}`}>
                                <input type="file" accept=".csv,.xlsx,.xls,.txt" className="hidden"
                                    onChange={e => { if (e.target.files?.[0]) handleLeadsFile(e.target.files[0]); }} />
                                {leadsFile ? (
                                    <div className="flex flex-col items-center gap-1">
                                        <CheckCircle2 className="w-6 h-6 text-[#2f81f7]" />
                                        <span className="text-sm font-medium text-[#e6edf3]">{leadsFile.name}</span>
                                        <span className="text-xs text-[#8b949e]">{leads.length} leads detected</span>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center gap-1">
                                        <Upload className="w-6 h-6 text-[#8b949e]" />
                                        <span className="text-sm text-[#8b949e]">Click or drag to upload leads file</span>
                                    </div>
                                )}
                            </label>
                            {parseError && <p className="text-xs text-[#f85149] flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{parseError}</p>}

                            {/* Column mapping */}
                            {columns.length > 0 && (
                                <div className="grid grid-cols-3 gap-3">
                                    {(['phone', 'name', 'email'] as const).map(field => (
                                        <div key={field}>
                                            <label className="block text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1">
                                                {field === 'phone' ? '📞 Phone Column *' : field === 'name' ? '👤 Name Column *' : '📧 Email Column *'}
                                            </label>
                                            <select value={columnMap[field]}
                                                onChange={e => setColumnMap(prev => ({ ...prev, [field]: e.target.value }))}
                                                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#30363d] bg-[#0d1117] text-[#e6edf3] focus:outline-none focus:ring-1 focus:ring-[#2f81f7]/50">
                                                <option value="">— not selected —</option>
                                                {columns.map(col => <option key={col} value={col}>{col}</option>)}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Preview table */}
                            {leads.length > 0 && (
                                <div className="rounded-lg border border-[#30363d] overflow-auto max-h-36" style={{ scrollbarWidth: 'thin' }}>
                                    <table className="w-full text-[10px]">
                                        <thead className="bg-[#21262d] sticky top-0">
                                            <tr>{columns.map(col => <th key={col} className="px-3 py-1.5 text-left text-[#8b949e] font-semibold whitespace-nowrap">{col}</th>)}</tr>
                                        </thead>
                                        <tbody>
                                            {leads.slice(0, 5).map((row, i) => (
                                                <tr key={i} className="border-t border-[#21262d] hover:bg-[#21262d]/50">
                                                    {columns.map(col => <td key={col} className="px-3 py-1.5 text-[#c9d1d9] whitespace-nowrap max-w-[150px] truncate">{row[col]}</td>)}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {leads.length > 5 && <p className="text-center text-[10px] text-[#8b949e] py-1 border-t border-[#21262d]">… and {leads.length - 5} more rows</p>}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── STEP 2: RAG Knowledge Base */}
                    <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
                        <div className="px-4 py-3 border-b border-[#30363d] flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Brain className="w-4 h-4 text-[#a371f7]" />
                                <span className="text-sm font-semibold text-[#e6edf3]">Step 2 — Knowledge Base</span>
                                <span className="ml-2 text-[10px] text-[#8b949e]">Optional — PDF, DOCX, TXT</span>
                            </div>
                            <a href="/sample_knowledge_base.txt" download className="text-xs text-[#a371f7] hover:underline flex items-center gap-1">
                                <Download className="w-3 h-3" /> Sample RAG
                            </a>
                        </div>
                        <div className="p-4">
                            <label className={`flex flex-col items-center justify-center w-full h-20 rounded-lg border-2 border-dashed cursor-pointer transition-colors
                                ${ragInfo ? 'border-[#a371f7]/50 bg-[#a371f7]/5' : 'border-[#30363d] hover:border-[#8b949e] hover:bg-[#21262d]'}`}>
                                <input type="file" accept=".pdf,.docx,.doc,.txt,.csv,.md" className="hidden"
                                    onChange={e => { if (e.target.files?.[0]) handleRagFile(e.target.files[0]); }} />
                                {ragLoading ? (
                                    <div className="flex items-center gap-2">
                                        <Loader2 className="w-4 h-4 text-[#a371f7] animate-spin" />
                                        <span className="text-xs text-[#8b949e]">Processing file…</span>
                                    </div>
                                ) : ragInfo ? (
                                    <div className="flex flex-col items-center gap-0.5">
                                        <CheckCircle2 className="w-5 h-5 text-[#a371f7]" />
                                        <span className="text-xs font-medium text-[#e6edf3]">{ragInfo.fileName}</span>
                                        <span className="text-[10px] text-[#8b949e]">
                                            {ragInfo.charCount.toLocaleString()} characters loaded
                                            {ragInfo.truncated && ' (truncated to fit)'}
                                        </span>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center gap-1">
                                        <Brain className="w-5 h-5 text-[#8b949e]" />
                                        <span className="text-xs text-[#8b949e]">Attach company/product knowledge base (PDF, DOCX, TXT)</span>
                                    </div>
                                )}
                            </label>
                        </div>
                    </div>

                    {/* ── STEP 3: Agent Persona & Campaign Prompt */}
                    <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
                        <div className="px-4 py-3 border-b border-[#30363d] flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Bot className="w-4 h-4 text-[#3fb950]" />
                                <span className="text-sm font-semibold text-[#e6edf3]">Step 3 — Agent Persona & Campaign Prompt</span>
                            </div>
                            <button type="button" onClick={() => setPrompt("You are a real estate agent calling {{lead.name}} from {{lead.city}}. Their budget is around {{lead.budget}}. Introduce yourself and ask if they have a minute to discuss our new luxury project 'Project Sunset'. Use your knowledge base to answer questions.")} className="text-xs text-[#3fb950] hover:underline">
                                Insert Sample Prompt
                            </button>
                        </div>
                        <div className="p-4 space-y-3">
                            {/* Agent Name */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1">Agent Name (optional)</label>
                                    <input type="text" value={agentName} onChange={e => setAgentName(e.target.value)}
                                        placeholder="e.g. Priya, Rahul, Alex"
                                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#30363d] bg-[#0d1117] text-[#e6edf3] placeholder-[#484f58] focus:outline-none focus:ring-1 focus:ring-[#3fb950]/50" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1">Initial Greeting (optional)</label>
                                    <input type="text" value={greeting} onChange={e => setGreeting(e.target.value)}
                                        placeholder="Hello, this is Priya from XYZ. Is this a good time?"
                                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#30363d] bg-[#0d1117] text-[#e6edf3] placeholder-[#484f58] focus:outline-none focus:ring-1 focus:ring-[#3fb950]/50" />
                                </div>
                            </div>
                            {/* System Prompt Builder */}
                            <div>
                                <label className="block text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1">System Prompt / Campaign Instructions *</label>
                                <textarea
                                    ref={promptTextareaRef}
                                    value={prompt} onChange={e => setPrompt(e.target.value)} rows={5}
                                    placeholder="Define the agent's full persona and campaign goal. Use {{lead.name}}, {{lead.city}}, {{lead.budget}} etc. to personalise per lead."
                                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#30363d] bg-[#0d1117] text-[#e6edf3] placeholder-[#484f58] focus:outline-none focus:ring-1 focus:ring-[#3fb950]/50 resize-none" />
                                
                                {/* Dynamic Entities Panel */}
                                {columns.length > 0 && (
                                    <div className="mt-3 p-3 rounded-lg bg-[#0d1117] border border-[#30363d]/60">
                                        <p className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                            Dynamic Entities
                                            <span className="normal-case font-normal text-[#484f58]">(Drag or click to insert)</span>
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            {columns.map(col => (
                                                <div key={col}
                                                    draggable
                                                    onDragStart={(e) => {
                                                        e.dataTransfer.setData('text/plain', `{{lead.${col}}}`);
                                                        e.dataTransfer.effectAllowed = 'copy';
                                                    }}
                                                    onClick={() => handleInsertTag(col)}
                                                    className="px-2 py-1 rounded bg-[#161b22] border border-[#30363d] hover:border-[#3fb950]/50 hover:bg-[#3fb950]/10 text-xs text-[#c9d1d9] font-mono cursor-pointer shadow-sm transition-colors flex items-center gap-1.5 group"
                                                >
                                                    <span className="text-[#3fb950] opacity-60 group-hover:opacity-100">{"{{"}</span>
                                                    {col}
                                                    <span className="text-[#3fb950] opacity-60 group-hover:opacity-100">{"}}"}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Live Preview Panel */}
                                {promptPreview && (
                                    <div className="mt-3 rounded-lg border border-[#30363d] overflow-hidden">
                                        <div className="px-3 py-1.5 bg-[#161b22] border-b border-[#30363d] flex justify-between items-center">
                                            <span className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider">Live Preview</span>
                                            <span className="text-[10px] text-[#484f58]">Row 1 of {leads.length}</span>
                                        </div>
                                        <div className="p-3 bg-[#0d1117] text-sm text-[#c9d1d9] whitespace-pre-wrap font-mono leading-relaxed">
                                            {/* Render promptPreview with highlighted replacements */}
                                            {promptPreview.split(/(\{\{lead\.[^}]+\}\})/gi).map((part, i) => {
                                                const isUnresolvedTag = part.startsWith('{{lead.') && part.endsWith('}}');
                                                if (isUnresolvedTag) {
                                                    return <span key={i} className="text-[#f85149] bg-[#f85149]/10 px-1 rounded">{part} (not found)</span>;
                                                }
                                                // We want to highlight the resolved dynamic values. 
                                                // This is tricky without a complex parser, so we'll just show the final text.
                                                // Actually, a simpler way is to just display promptPreview as plain text.
                                                // Let's just output the plain text for now.
                                                return <span key={i}>{part}</span>;
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ── STEP 4: Voice & Model */}
                    <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
                        <div className="px-4 py-3 border-b border-[#30363d] flex items-center gap-2">
                            <Globe className="w-4 h-4 text-[#d29922]" />
                            <span className="text-sm font-semibold text-[#e6edf3]">Step 4 — Voice & Model</span>
                        </div>
                        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                            {/* LLM Provider */}
                            <div>
                                <label className="block text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1">LLM</label>
                                <select value={selectedProvider} onChange={e => setSelectedProvider(e.target.value)}
                                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#30363d] bg-[#0d1117] text-[#e6edf3] focus:outline-none focus:ring-1 focus:ring-[#2f81f7]/50">
                                    {llmProviders.map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                            </div>
                            {/* TTS Provider */}
                            <div>
                                <label className="block text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1">TTS Provider</label>
                                <select value={selectedTtsProvider} onChange={e => handleTtsProviderChange(e.target.value)}
                                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#30363d] bg-[#0d1117] text-[#e6edf3] focus:outline-none focus:ring-1 focus:ring-[#2f81f7]/50">
                                    {ttsProviders.map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                            </div>
                            {/* Voice */}
                            <div>
                                <label className="block text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1">Voice</label>
                                <select value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)}
                                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#30363d] bg-[#0d1117] text-[#e6edf3] focus:outline-none focus:ring-1 focus:ring-[#2f81f7]/50">
                                    {voices.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                                </select>
                            </div>
                            {/* Language */}
                            <div>
                                <label className="block text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1">Language</label>
                                <select value={selectedLanguage} onChange={e => setSelectedLanguage(e.target.value)}
                                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#30363d] bg-[#0d1117] text-[#e6edf3] focus:outline-none focus:ring-1 focus:ring-[#2f81f7]/50">
                                    {STT_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                                </select>
                            </div>
                            {/* Voice preview */}
                            <div className="col-span-2 md:col-span-4">
                                <button type="button" onClick={previewState === 'playing' ? stopPreview : playPreview}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#30363d] text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3] transition-colors">
                                    {previewState === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                                     previewState === 'playing' ? <StopCircle className="w-3.5 h-3.5 text-[#f85149]" /> :
                                     <Play className="w-3.5 h-3.5" />}
                                    {previewState === 'loading' ? 'Loading preview…' : previewState === 'playing' ? 'Stop preview' : 'Preview voice'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* ── Error message */}
                    {status === 'error' && message && (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-[#f85149]/10 border border-[#f85149]/30 text-[#f85149] text-sm">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            {message}
                        </div>
                    )}

                    {/* ── Start button */}
                    {!isRunning && status !== 'completed' && (
                        <button type="submit" disabled={leads.length === 0 || !columnMap.phone || ragLoading}
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white
                                bg-gradient-to-r from-[#a371f7] to-[#2f81f7]
                                hover:from-[#9461e7] hover:to-[#1f71e7]
                                disabled:opacity-40 disabled:cursor-not-allowed
                                shadow-lg shadow-[#a371f7]/20 transition-all active:scale-[0.99]">
                            <Play className="w-4 h-4" />
                            Start Campaign ({leads.filter(l => l[columnMap.phone]?.trim().length >= 10).length} leads)
                        </button>
                    )}
                </form>

                {/* ── Progress bar */}
                {(isRunning || isDone) && (
                    <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-[#e6edf3]">
                                {isRunning ? `Dialing… ${progress.current} of ${progress.total}` : `Completed — ${progress.current} of ${progress.total} dispatched`}
                            </span>
                            {status === 'completed' && (
                                <button onClick={handleDownload}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-[#3fb950] hover:bg-[#3fb950]/90 transition-colors">
                                    <Download className="w-3.5 h-3.5" />
                                    Download Report
                                </button>
                            )}
                        </div>
                        <div className="w-full h-2 bg-[#21262d] rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-[#a371f7] to-[#2f81f7] rounded-full transition-all duration-500"
                                style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }} />
                        </div>
                        {message && <p className="text-xs text-[#8b949e]">{message}</p>}
                    </div>
                )}

                {/* ── Live Results Table */}
                {leads.length > 0 && (isRunning || isDone) && (
                    <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
                        <div className="px-4 py-3 border-b border-[#30363d] flex items-center justify-between">
                            <span className="text-sm font-semibold text-[#e6edf3]">Live Results</span>
                            <span className="text-[10px] text-[#8b949e]">Updates every 4s as calls complete</span>
                        </div>
                        <div className="overflow-auto max-h-80" style={{ scrollbarWidth: 'thin' }}>
                            <table className="w-full text-xs">
                                <thead className="bg-[#21262d] sticky top-0">
                                    <tr>
                                        <th className="px-3 py-2 text-left text-[#8b949e] font-semibold">#</th>
                                        {columnMap.name && <th className="px-3 py-2 text-left text-[#8b949e] font-semibold">Name</th>}
                                        <th className="px-3 py-2 text-left text-[#8b949e] font-semibold">Phone</th>
                                        <th className="px-3 py-2 text-left text-[#8b949e] font-semibold">Status</th>
                                        <th className="px-3 py-2 text-left text-[#8b949e] font-semibold">Sentiment</th>
                                        <th className="px-3 py-2 text-left text-[#8b949e] font-semibold">Remarks</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {leads.filter(l => l[columnMap.phone]?.trim().length >= 10).map((lead, i) => {
                                        const result = resultMap.get(i);
                                        const isCurrentlyDialing = isRunning && i === progress.current - 1 && !result;
                                        return (
                                            <tr key={i} className="border-t border-[#21262d] hover:bg-[#21262d]/40 transition-colors">
                                                <td className="px-3 py-2 text-[#8b949e]">{i + 1}</td>
                                                {columnMap.name && <td className="px-3 py-2 text-[#e6edf3] font-medium">{lead[columnMap.name] || '—'}</td>}
                                                <td className="px-3 py-2 text-[#c9d1d9] font-mono">{lead[columnMap.phone]}</td>
                                                <td className="px-3 py-2">
                                                    {isCurrentlyDialing ? (
                                                        <span className="flex items-center gap-1 text-[#2f81f7] text-[10px] font-semibold">
                                                            <Loader2 className="w-3 h-3 animate-spin" /> Dialing…
                                                        </span>
                                                    ) : result ? (
                                                        <StatusBadge status={result.status} />
                                                    ) : (
                                                        <span className="text-[10px] text-[#484f58]">—</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2">
                                                    {result?.sentiment ? <SentimentBadge sentiment={result.sentiment} /> : <span className="text-[10px] text-[#484f58]">—</span>}
                                                </td>
                                                <td className="px-3 py-2 text-[#8b949e] max-w-xs truncate">{result?.remarks || '—'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
