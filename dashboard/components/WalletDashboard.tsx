"use client";

import React, { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { motion } from "framer-motion";
import { Wallet, TrendingDown, Clock, CheckCircle2, Phone, FileText, Mic, Radio, Zap, ChevronRight } from "lucide-react";
import type { WalletData, TransactionType } from "@/lib/actions";
import { useTheme } from "next-themes";
import { useAppContext, INR_TO_CURRENCY, currencySymbols } from "./app-provider";

const TYPE_COLORS: Record<TransactionType, string> = {
  CDR:          "#f97316",  // orange  — matches VoBiz
  "DID Purchase": "#3b82f6",// blue
  NCC:          "#10b981",  // green
  Recording:    "#a855f7",  // purple
  Transcription:"#06b6d4",  // cyan
  Other:        "#6b7280",  // gray
};

const TYPE_ICONS: Record<TransactionType, React.ElementType> = {
  CDR:           Phone,
  "DID Purchase": Radio,
  NCC:           Zap,
  Recording:     Mic,
  Transcription: FileText,
  Other:         ChevronRight,
};

const ALL_TYPES: TransactionType[] = ["CDR", "DID Purchase", "Recording", "Transcription", "NCC"];

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  return `${mins} min${mins !== 1 ? "s" : ""} ago`;
}

function fmt(amount: number, currency: string) {
  const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "₹";
  return `${sym}${Math.abs(amount).toFixed(2)}`;
}

// ── Custom Tooltip for Bar Chart ──────────────────────────────────────────
function CustomBarTooltip({ active, payload, label, currency }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white/90 dark:bg-[#1c2128]/90 backdrop-blur-md border border-gray-200/50 dark:border-white/8 rounded-xl shadow-xl p-3 text-sm">
      <p className="font-semibold text-gray-700 dark:text-[#e6edf3] mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-0.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: p.fill }} />
          <span className="text-gray-500 dark:text-[#8b949e]">{p.dataKey}:</span>
          <span className="font-medium text-gray-900 dark:text-[#e6edf3]">{fmt(p.value, currency)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Custom Pie Tooltip ────────────────────────────────────────────────────
function CustomPieTooltip({ active, payload, currency }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="bg-white/90 dark:bg-[#1c2128]/90 backdrop-blur-md border border-gray-200/50 dark:border-white/8 rounded-xl shadow-xl p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: p.payload.fill }} />
        <span className="font-semibold text-gray-700 dark:text-[#e6edf3]">{p.name}</span>
      </div>
      <p className="text-gray-500 dark:text-[#8b949e] mt-1">{fmt(p.value, currency)}</p>
    </div>
  );
}

export default function WalletDashboard({ data }: { data: WalletData }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [activeFilter, setActiveFilter] = useState<TransactionType | "All">("All");

  const { currency } = useAppContext();
  const rate = INR_TO_CURRENCY[currency];
  const sym = currencySymbols[currency];

  const balance = data.balance * rate;
  const rawTotalSpent = Object.values(data.categoryTotals).reduce((a, b) => a + b, 0);
  const totalSpent = rawTotalSpent * rate;

  const convertedTransactions = useMemo(() => {
    return data.transactions.map(tx => ({
      ...tx,
      amount: tx.amount * rate
    }));
  }, [data.transactions, rate]);

  const filteredTx = useMemo(
    () => activeFilter === "All" ? convertedTransactions : convertedTransactions.filter(t => t.type === activeFilter),
    [convertedTransactions, activeFilter]
  );

  const convertedCategoryTotals = useMemo(() => {
    const res: Record<string, number> = {};
    for (const key in data.categoryTotals) {
      res[key] = data.categoryTotals[key as TransactionType] * rate;
    }
    return res;
  }, [data.categoryTotals, rate]);

  const convertedDailySpending = useMemo(() => {
    return data.dailySpending.map(ds => {
      const convertedDs = { ...ds };
      ALL_TYPES.forEach(type => {
        if (typeof (ds as any)[type] === 'number') {
          (convertedDs as any)[type] = ((ds as any)[type] as number) * rate;
        }
      });
      return convertedDs;
    });
  }, [data.dailySpending, rate]);

  const usageSummary = data.usageSummary;

  // Donut chart data — only non-zero categories
  const pieData = useMemo(() =>
    ALL_TYPES.filter(t => convertedCategoryTotals[t] > 0).map(t => ({
      name: t,
      value: convertedCategoryTotals[t],
      fill: TYPE_COLORS[t],
    })),
    [convertedCategoryTotals]
  );

  const gridColor  = isDark ? "#30363d" : "#e5e7eb";
  const tickColor  = isDark ? "#8b949e" : "#9ca3af";

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-[#e6edf3]">Wallet</h2>
          <p className="text-gray-500 dark:text-[#8b949e]">Balance, usage and billing history.</p>
        </div>
        <div className="px-4 py-2 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 text-orange-600 dark:text-orange-400 font-semibold text-lg flex items-center gap-2">
          <Wallet className="w-5 h-5" />
          {sym}{balance.toFixed(2)}
        </div>
      </div>

      {/* ── Top Summary Cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Current Balance",    value: `${sym}${balance.toFixed(2)}`,           icon: Wallet,       color: "orange", sub: "Available credits"            },
          { label: "Total Spent (All)",   value: `${sym}${totalSpent.toFixed(2)}`,         icon: TrendingDown, color: "red",    sub: "CDR + DID + NCC + extras"   },
          { label: "Avg Call Duration",   value: `${usageSummary.avgDuration}s`,           icon: Clock,        color: "blue",   sub: "Answered calls only"        },
          { label: "Success Rate",        value: `${usageSummary.successRate}%`,           icon: CheckCircle2, color: "green",  sub: `${usageSummary.callMinutes} call minutes`  },
        ].map(card => {
          const Icon = card.icon;
          const clr = card.color;
          const palettes: Record<string, { bg: string; text: string; iconBg: string }> = {
            orange: { bg: "bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20", text: "text-orange-600 dark:text-orange-400", iconBg: "bg-orange-100 dark:bg-orange-500/20" },
            red:    { bg: "bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20", text: "text-red-600 dark:text-red-400", iconBg: "bg-red-100 dark:bg-red-500/20" },
            blue:   { bg: "bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20", text: "text-blue-600 dark:text-blue-400", iconBg: "bg-blue-100 dark:bg-blue-500/20" },
            green:  { bg: "bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20", text: "text-green-600 dark:text-green-400", iconBg: "bg-green-100 dark:bg-green-500/20" },
          };
          const p = palettes[clr];
          return (
            <div 
              key={card.label} 
              className={`relative h-[140px] rounded-2xl border p-5 shadow-sm backdrop-blur-md ${p.bg} flex flex-col justify-center transition-all hover:-translate-y-1 hover:shadow-md cursor-default`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2 rounded-lg ${p.iconBg}`}>
                  <Icon className={`w-4 h-4 ${p.text}`} />
                </div>
                <p className="text-sm font-medium text-gray-500 dark:text-[#8b949e]">{card.label}</p>
              </div>
              <p className={`text-2xl font-bold ${p.text}`}>{card.value}</p>
            </div>
          );
        })}
      </div>

      {/* ── Charts Row ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Daily Spending Bar Chart */}
        <div className="lg:col-span-2 bg-white/80 dark:bg-[#161b22]/60 backdrop-blur-md border border-gray-200/50 dark:border-white/8 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 dark:text-[#e6edf3]">Daily Spending Breakdown</h3>
            {convertedDailySpending.length > 0 && (
              <span className="text-xs text-gray-400 dark:text-[#8b949e]">
                {convertedDailySpending[0]?.date} – {convertedDailySpending[convertedDailySpending.length - 1]?.date}
              </span>
            )}
          </div>
          {convertedDailySpending.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={convertedDailySpending} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={gridColor} strokeDasharray="4 4" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: tickColor }} dy={6} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: tickColor }} tickFormatter={v => `${sym}${v}`} />
                <Tooltip content={<CustomBarTooltip currency={currency} />} cursor={{ fill: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }} />
                {ALL_TYPES.map(type => (
                  <Bar key={type} dataKey={type} stackId="a" fill={TYPE_COLORS[type]} radius={type === "Transcription" ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[240px] flex items-center justify-center text-gray-400 dark:text-[#8b949e] text-sm">
              No spending data available yet.
            </div>
          )}
          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
            {ALL_TYPES.map(type => (
              <div key={type} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-[#8b949e]">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: TYPE_COLORS[type] }} />
                {type}
              </div>
            ))}
          </div>
        </div>

        {/* Spending Categories Donut */}
        <div className="bg-white/80 dark:bg-[#161b22]/60 backdrop-blur-md border border-gray-200/50 dark:border-white/8 rounded-2xl p-5 shadow-sm flex flex-col">
          <h3 className="font-semibold text-gray-900 dark:text-[#e6edf3] mb-4">Spending Categories</h3>
          {pieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomPieTooltip currency={currency} />} />
                </PieChart>
              </ResponsiveContainer>
              {/* Category list */}
              <div className="flex-1 space-y-1.5 mt-2">
                {pieData.map(entry => (
                  <div key={entry.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: entry.fill }} />
                      <span className="text-gray-600 dark:text-[#8b949e]">{entry.name}</span>
                    </div>
                    <span className="font-semibold text-gray-800 dark:text-[#e6edf3]">{fmt(entry.value, currency)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-[#8b949e] text-sm">
              No data yet.
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom Row: Transactions + Usage Summary ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Recent Transactions */}
        <div className="lg:col-span-2 bg-white/80 dark:bg-[#161b22]/60 backdrop-blur-md border border-gray-200/50 dark:border-white/8 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-5 pb-1">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-[#e6edf3]">Recent Transactions</h3>
              <p className="text-xs text-gray-400 dark:text-[#8b949e] mt-0.5">All charges from VoBiz billing ledger · {data.transactions.length} records</p>
            </div>
            <span className="text-xs text-orange-500 font-medium cursor-pointer hover:underline">View all →</span>
          </div>

          {/* Filter chips */}
          <div className="flex items-center gap-2 px-5 pb-3 flex-wrap">
            {(["All", ...ALL_TYPES] as const).map(f => (
              <button
                key={f}
                onClick={() => setActiveFilter(f as any)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                  activeFilter === f
                    ? "bg-orange-500 text-white border-orange-500 shadow-sm"
                    : "bg-gray-50 dark:bg-[#21262d] text-gray-500 dark:text-[#8b949e] border-gray-200 dark:border-[#30363d] hover:border-gray-300 dark:hover:border-[#8b949e]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Transaction list */}
          <div className="overflow-y-auto max-h-[340px] divide-y divide-gray-100 dark:divide-[#21262d]">
            {filteredTx.length > 0 ? filteredTx.map(tx => {
              const Icon = TYPE_ICONS[tx.type];
              return (
                <div key={tx.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-[#21262d] transition-colors">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="mt-0.5 p-1.5 rounded-lg flex-shrink-0" style={{ background: TYPE_COLORS[tx.type] + "20" }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: TYPE_COLORS[tx.type] }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-700 dark:text-[#c9d1d9] truncate max-w-xs" title={tx.description}>
                        {tx.description}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-[#8b949e] mt-0.5">{timeAgo(tx.timestamp)}</p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-red-500 dark:text-red-400 flex-shrink-0 ml-4">
                    -{fmt(tx.amount, currency)}
                  </span>
                </div>
              );
            }) : (
              <div className="py-16 text-center text-gray-400 dark:text-[#8b949e] text-sm">
                No transactions for this filter.
              </div>
            )}
          </div>
        </div>

        {/* Usage Summary */}
        <div className="bg-white/80 dark:bg-[#161b22]/60 backdrop-blur-md border border-gray-200/50 dark:border-white/8 rounded-2xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-900 dark:text-[#e6edf3] mb-5">Usage Summary</h3>
          <div className="space-y-5">
            {[
              { label: "ACTIVE DIDS",    value: `${usageSummary.activeDids} / 1`,  sub: null },
              { label: "CALL MINUTES",   value: String(usageSummary.callMinutes),  sub: null },
              { label: "AVG DURATION",   value: `${usageSummary.avgDuration}s`,    sub: null },
              { label: "SUCCESS RATE",   value: `${usageSummary.successRate}%`,    isSuccess: true },
            ].map(row => (
              <div key={row.label}>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-400 dark:text-[#8b949e] mb-1">{row.label}</p>
                {row.isSuccess ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="text-xl font-bold text-green-500">{row.value}</span>
                  </div>
                ) : (
                  <p className="text-xl font-bold text-gray-900 dark:text-[#e6edf3]">{row.value}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
