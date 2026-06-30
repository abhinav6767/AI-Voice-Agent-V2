# 📂 Apoorv Open It — Session Handoff Package
> **Date:** 30 June 2026 | **Repo:** ApoorvChandhok/AI-Voice-Agent-V2

This folder contains a complete snapshot of everything created and discussed in today's session. Open the files in this order for the full picture.

---

## 📋 Files in This Folder

| File | What it is |
|------|------------|
| `README.md` | This file — index and overview |
| `01_demo_scenarios.md` | All 3 demo scenarios with system prompts and RAG |
| `02_scenario1_dental_PROMPT.md` | Deep Delhi dental clinic system prompt (Aayushi agent) |
| `03_scenario1_dental_RAG.md` | Full RAG knowledge base for the dental clinic |
| `04_scenario2_usedcar_PROMPT.md` | Deep outbound used car sales system prompt (Priya agent) |
| `05_scenario2_usedcar_RAG.md` | Full RAG knowledge base for Spinny Delhi car hub |
| `06_CHANGES_WALKTHROUGH.md` | Complete walkthrough of ALL code changes made today |
| `07_SQL_TASKS_TODO.md` | ⚠️ IMPORTANT — Setup steps you MUST do before testing |
| `08_CONVERSATION_CONTEXT.md` | Full context of everything discussed — architectural decisions |
| `09_ARCHITECTURE_TOOL_GATEWAY.md` | How the 100% extensible real-time tool gateway works |

---

## 🚀 Quick Start

1. **Read `07_SQL_TASKS_TODO.md` FIRST** — 2 one-time setup steps needed before calendar booking works
2. **Read `06_CHANGES_WALKTHROUGH.md`** — understand all code changes
3. **Test the dental agent** — call the inbound number and say "Doctor saab, kal teen baje cleaning ka appointment chahiye"
4. **See calendar event appear** in your connected Google Calendar in real-time during the call

---

## 📁 Code Changes Summary

```
agent_inbound.py                                        Modified - Added query_workspace_integration tool
data/agent_config.json                                  Modified - Replaced inbound with dental center (Aayushi)
dashboard/app/api/tools/execute/route.ts                NEW - Extensible tool gateway
dashboard/app/api/auth/google/callback/route.ts         NEW - Unified OAuth callback (saves to Supabase)
dashboard/app/api/auth/gmail/start/route.ts             Modified - Added Calendar scope
dashboard/app/(dashboard)/integrations/page.tsx         Modified - Google Calendar card added
supabase/migrations/20260630_create_integrations_table.sql  NEW - Database migration
.env                                                    Modified - Added TOOL_GATEWAY_URL
```
