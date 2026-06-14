"use client";

import { useState, useEffect, useRef } from 'react';
import { Users, Upload, Play, Loader2, RefreshCw, ChevronDown, StopCircle, Globe } from 'lucide-react';
import type { ProviderCatalog, VoiceOption, ModelOption } from '@/lib/providers';
import { FALLBACK_CATALOG, STT_LANGUAGES } from '@/lib/providers';

export default function BulkDialer() {
    const [file, setFile] = useState<File | null>(null);
    const [prompt, setPrompt] = useState('');
    const [status, setStatus] = useState<'idle' | 'processing' | 'dialing' | 'completed' | 'error'>('idle');
    const [progress, setProgress] = useState({ total: 0, current: 0 });
    const [message, setMessage] = useState('');
    
    // Dynamic catalog & state
    const [catalog, setCatalog] = useState<ProviderCatalog>(FALLBACK_CATALOG);
    const [catalogLoading, setCatalogLoading] = useState(true);
    const [liveStatus, setLiveStatus] = useState<Record<string, boolean>>({});

    const [selectedProvider, setSelectedProvider] = useState('groq');
    const [selectedVoice, setSelectedVoice] = useState('aravind');
    const [selectedTtsProvider, setSelectedTtsProvider] = useState('sarvam');
    const [selectedLanguage, setSelectedLanguage] = useState('en-IN');

    // Voice preview state
    const [previewState, setPreviewState] = useState<"idle" | "loading" | "playing">("idle");
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const loadCatalog = async () => {
        setCatalogLoading(true);
        try {
            const res = await fetch('/api/providers');
            if (!res.ok) throw new Error('Failed');
            const data = await res.json();
            setCatalog(data.catalog);
            setLiveStatus(data.live_fetched ?? {});
        } catch {
            // Keep fallback
        } finally {
            setCatalogLoading(false);
        }
    };
    
    useEffect(() => {
        Promise.all([
            fetch('/api/agent-config?mode=outbound').then(r => r.json()).catch(() => null),
            loadCatalog(),
        ]).then(([configData]) => {
            if (configData?.config) {
                if (configData.config.llm_provider) setSelectedProvider(configData.config.llm_provider);
                if (configData.config.tts_provider) setSelectedTtsProvider(configData.config.tts_provider);
                if (configData.config.tts_voice) setSelectedVoice(configData.config.tts_voice);
                if (configData.config.tts_language) setSelectedLanguage(configData.config.tts_language);
            }
        });
    }, []);

    const handleTtsProviderChange = (provider: string) => {
        setSelectedTtsProvider(provider);
        stopPreview();
        const voices = catalog.tts[provider]?.voices ?? [];
        if (voices.length > 0) setSelectedVoice(voices[0].value);
    };

    const stopPreview = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }
        setPreviewState("idle");
    };

    const playPreview = async () => {
        stopPreview();
        setPreviewState("loading");
        try {
            const params = new URLSearchParams({
                provider: selectedTtsProvider,
                voice: selectedVoice,
                model: "", 
                language: selectedLanguage,
            });
            const res = await fetch(`/api/voice-preview?${params}`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audioRef.current = audio;
            audio.onended = () => { setPreviewState("idle"); URL.revokeObjectURL(url); };
            audio.onerror = () => { setPreviewState("idle"); URL.revokeObjectURL(url); };
            await audio.play();
            setPreviewState("playing");
        } catch (e: any) {
            console.error("[VoicePreview]", e);
            setPreviewState("idle");
            setMessage(`Preview failed: ${e.message}`);
            setStatus('error');
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    const handleBulkDispatch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file) {
            setStatus('error');
            setMessage('Please upload a CSV file with a "phone" column.');
            return;
        }

        setStatus('processing');
        setMessage('Processing CSV file...');

        const text = await file.text();
        const lines = text.split('\n');
        
        let headerLine = lines[0].toLowerCase();
        let phoneIndex = headerLine.split(',').findIndex(col => col.trim().includes('phone'));

        if (phoneIndex === -1) {
            setStatus('error');
            setMessage('CSV must contain a column named "phone".');
            return;
        }

        const numbers = lines.slice(1)
            .map(line => line.split(',')[phoneIndex]?.trim())
            .filter(num => num && num.length >= 10);

        if (numbers.length === 0) {
            setStatus('error');
            setMessage('No valid phone numbers found in CSV.');
            return;
        }

        setStatus('dialing');
        setProgress({ total: numbers.length, current: 0 });

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < numbers.length; i++) {
            const num = numbers[i];
            try {
                const res = await fetch('/api/dispatch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phoneNumber: num,
                        prompt,
                        modelProvider: selectedProvider,
                        voice: selectedVoice,
                        ttsProvider: selectedTtsProvider,
                        ttsLanguage: selectedLanguage,
                    }),
                });

                if (res.ok) successCount++;
                else failCount++;
            } catch (err) {
                failCount++;
            }

            setProgress(prev => ({ ...prev, current: i + 1 }));
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        setStatus('completed');
        setMessage(`Campaign finished. Success: ${successCount}, Failed: ${failCount}`);
    };

    return (
        <div className="w-full">
            <div className="p-8">
                <div className="flex items-center justify-between mb-8 pb-4 border-b border-[#30363d]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-[#a371f7]/10 text-[#a371f7] rounded-lg">
                            <Users className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-[#e6edf3]">Bulk Campaign</h2>
                            <p className="text-sm text-[#8b949e]">Upload CSV to dial multiple users</p>
                        </div>
                    </div>
                    <button
                        onClick={loadCatalog}
                        disabled={catalogLoading}
                        title="Refresh voices & models from provider APIs"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-[#8b949e] border border-gray-200 dark:border-[#30363d] hover:bg-gray-50 dark:hover:bg-[#21262d] transition-colors"
                        type="button"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${catalogLoading ? 'animate-spin' : ''}`} />
                        {catalogLoading ? 'Loading...' : 'Refresh'}
                    </button>
                </div>

                {/* Live indicator */}
                {!catalogLoading && (
                    <div className="mb-5 flex items-center gap-2 text-xs text-gray-500 dark:text-[#8b949e]">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                        Voices & models fetched live from provider APIs
                        {liveStatus.sarvam_voices && <span className="px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 font-medium">Sarvam ✓</span>}
                        {liveStatus.groq_models && <span className="px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 font-medium">Groq ✓</span>}
                    </div>
                )}

                <form onSubmit={handleBulkDispatch} className="space-y-5">
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-[#e6edf3]">Upload CSV Leads</label>
                        <div className="flex items-center justify-center w-full">
                            <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-[#30363d] rounded-lg cursor-pointer bg-[#0d1117] hover:bg-[#21262d] hover:border-[#8b949e] transition-all">
                                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                    <Upload className="w-6 h-6 mb-2 text-[#8b949e]" />
                                    <p className="text-xs text-[#8b949e]">
                                        <span className="font-semibold">Click to upload</span> or drag and drop
                                    </p>
                                    <p className="text-[10px] text-[#8b949e] mt-1">Must contain 'phone' column</p>
                                </div>
                                <input type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
                            </label>
                        </div>
                        {file && <p className="text-xs text-[#2ea043] mt-2">Selected: {file.name}</p>}
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-[#e6edf3]">Campaign Prompt / Context</label>
                        <textarea
                            placeholder="Provide universal instructions for the agent..."
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            className="w-full px-3 py-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg focus:ring-1 focus:ring-[#2f81f7] focus:border-[#2f81f7] text-[#e6edf3] placeholder-[#8b949e] outline-none transition-all h-20 resize-none text-sm"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-[#e6edf3] flex items-center gap-1.5">
                                LLM Provider
                                {liveStatus.groq_models && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" title="Live data" />}
                            </label>
                            <div className="relative">
                                <select
                                    className="w-full px-3 py-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-[#e6edf3] outline-none focus:ring-1 focus:ring-[#2f81f7] focus:border-[#2f81f7] text-sm appearance-none pr-8"
                                    value={selectedProvider}
                                    onChange={(e) => setSelectedProvider(e.target.value)}
                                    disabled={catalogLoading}
                                >
                                    {catalogLoading
                                        ? <option>Loading...</option>
                                        : Object.entries(catalog.llm).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)
                                    }
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-[#e6edf3]">TTS Provider</label>
                            <div className="relative">
                                <select
                                    className="w-full px-3 py-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-[#e6edf3] outline-none focus:ring-1 focus:ring-[#2f81f7] focus:border-[#2f81f7] text-sm appearance-none pr-8"
                                    value={selectedTtsProvider}
                                    onChange={(e) => handleTtsProviderChange(e.target.value)}
                                    disabled={catalogLoading}
                                >
                                    {catalogLoading
                                        ? <option>Loading...</option>
                                        : Object.entries(catalog.tts).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)
                                    }
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-[#e6edf3] flex items-center gap-1.5">
                                Voice
                                {(liveStatus.sarvam_voices && selectedTtsProvider === 'sarvam') && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block animate-pulse" title="Live from Sarvam API" />
                                )}
                                {catalogLoading && <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />}
                            </label>
                            <div className="flex gap-2 items-center">
                                <div className="relative flex-1 min-w-0">
                                    <select
                                        className="w-full px-3 py-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-[#e6edf3] outline-none focus:ring-1 focus:ring-[#2f81f7] focus:border-[#2f81f7] text-sm appearance-none pr-8"
                                        value={selectedVoice}
                                        onChange={(e) => { setSelectedVoice(e.target.value); stopPreview(); }}
                                        disabled={catalogLoading}
                                    >
                                        {catalogLoading
                                            ? <option>Loading voices...</option>
                                            : (catalog.tts[selectedTtsProvider]?.voices ?? []).map(v => (
                                                <option key={v.value} value={v.value}>
                                                    {v.gender ? `${v.label} (${v.gender === 'female' ? '♀' : v.gender === 'male' ? '♂' : '◈'})` : v.label}
                                                </option>
                                            ))
                                        }
                                    </select>
                                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                </div>
                                <button
                                    type="button"
                                    onClick={previewState === "playing" ? stopPreview : playPreview}
                                    disabled={previewState === "loading" || !selectedVoice || catalogLoading}
                                    title={previewState === "playing" ? "Stop preview" : "Preview this voice"}
                                    className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all whitespace-nowrap ${
                                        previewState === "playing"
                                            ? "bg-[#a371f7] text-white border-[#a371f7]"
                                            : previewState === "loading"
                                                ? "bg-[#21262d] text-[#484f58] border-[#30363d] cursor-wait"
                                                : "bg-[#0d1117] text-[#8b949e] border-[#30363d] hover:bg-[#21262d] disabled:opacity-40"
                                    }`}
                                >
                                    {previewState === "loading" ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : previewState === "playing" ? (
                                        <StopCircle className="w-3.5 h-3.5" />
                                    ) : (
                                        <Play className="w-3.5 h-3.5" />
                                    )}
                                    <span>{previewState === "playing" ? "Stop" : "Preview"}</span>
                                </button>
                            </div>
                            {(() => {
                                const _ttsLangCatalog = catalog.tts[selectedTtsProvider]?.languages;
                                const voiceLangTags: ModelOption[] = _ttsLangCatalog
                                    ? _ttsLangCatalog
                                    : selectedTtsProvider === "openai"
                                        ? [{ value: "multi", label: "57 languages" }]
                                        : selectedTtsProvider === "cartesia"
                                            ? [{ value: "en", label: "Multilingual (60+)" }]
                                            : selectedTtsProvider === "deepgram"
                                                ? [{ value: "en-US", label: "English (US)" }]
                                                : [];
                                const voiceLangChips = voiceLangTags.slice(0, 9);
                                const voiceLangExtra = voiceLangTags.length > 9 ? voiceLangTags.length - 9 : 0;
                                
                                return voiceLangChips.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                        <Globe className="w-3 h-3 text-gray-400 dark:text-[#484f58] flex-shrink-0" />
                                        {[...voiceLangChips]
                                            .sort((a, b) => {
                                                if (a.value === selectedLanguage) return -1;
                                                if (b.value === selectedLanguage) return 1;
                                                return 0;
                                            })
                                            .map((lang) => {
                                                const isActive = lang.value === selectedLanguage;
                                                return (
                                                    <button
                                                        key={lang.value}
                                                        type="button"
                                                        title={`Switch to ${lang.label}`}
                                                        onClick={() => { setSelectedLanguage(lang.value); stopPreview(); }}
                                                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap transition-all ${
                                                            isActive
                                                                ? "bg-[#2f81f7] text-white border-[#2f81f7] shadow-sm"
                                                                : "bg-[#2f81f7]/10 text-[#2f81f7] border-[#2f81f7]/20 hover:bg-[#2f81f7]/20"
                                                        }`}
                                                    >
                                                        {isActive && <span className="mr-0.5">✓</span>}
                                                        {lang.label.replace(" (India)", "").replace(" (US)", "")}
                                                    </button>
                                                );
                                            })}
                                        {voiceLangExtra > 0 && (
                                            <span className="text-[10px] text-gray-400 dark:text-[#484f58]">+{voiceLangExtra} more</span>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>

                        {catalog.tts[selectedTtsProvider]?.languages && (
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-[#e6edf3]">Language</label>
                                <div className="relative">
                                    <select
                                        className="w-full px-3 py-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-[#e6edf3] outline-none focus:ring-1 focus:ring-[#2f81f7] focus:border-[#2f81f7] text-sm appearance-none pr-8"
                                        value={selectedLanguage}
                                        onChange={(e) => { setSelectedLanguage(e.target.value); stopPreview(); }}
                                        disabled={catalogLoading}
                                    >
                                        {(catalog.tts[selectedTtsProvider]?.languages ?? STT_LANGUAGES).map(l => (
                                            <option key={l.value} value={l.value}>{l.label}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                </div>
                            </div>
                        )}
                    </div>

                    <button
                        type="submit"
                        disabled={['processing', 'dialing'].includes(status) || !file}
                        className="w-full py-2.5 px-4 bg-[#a371f7] hover:bg-[#8957e5] text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                        {['processing', 'dialing'].includes(status) ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" /> Dialing {progress.current} / {progress.total}
                            </>
                        ) : (
                            <>
                                <Play className="w-4 h-4" /> Start Campaign
                            </>
                        )}
                    </button>

                    {status === 'dialing' && (
                        <div className="w-full bg-[#0d1117] rounded-full h-1.5 border border-[#30363d]">
                            <div className="bg-[#a371f7] h-1.5 rounded-full transition-all duration-300" style={{ width: `${(progress.current / progress.total) * 100}%` }}></div>
                        </div>
                    )}

                    {message && (
                        <div className={`p-3 rounded-lg text-sm flex items-center gap-2 border ${status === 'completed' ? 'bg-[#2ea043]/10 text-[#2ea043] border-[#2ea043]/20' : status === 'error' ? 'bg-[#da3633]/10 text-[#da3633] border-[#da3633]/20' : 'bg-[#2f81f7]/10 text-[#2f81f7] border-[#2f81f7]/20'}`}>
                            {message}
                        </div>
                    )}
                </form>
            </div>
        </div>
    );
}
