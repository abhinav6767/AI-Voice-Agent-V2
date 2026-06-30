# 💬 Conversation Context — Full Session Summary
> **Date:** 30 June 2026 | Session with Antigravity AI

This document captures everything discussed, decided, and built in this session. It is your complete context if you ever need to continue from where we left off.

---

## What We Set Out to Do

1. Deepen and productionize the 3 demo scenarios with enterprise-grade prompts + RAG knowledge bases
2. Make demo scenarios India-centric (Delhi dental center instead of generic US clinic)
3. Implement Google Calendar booking for the inbound dental agent
4. Make the calendar integration 100% extensible — add future integrations with zero Python changes
5. Create a PR with all the work

---

## Decisions Made & Why

### Decision 1: Scenario 1 = Shri Krishna Dental Clinic, Delhi (not a generic clinic)
**Why:** India-centric demo is more relatable for Indian investors/clients. Hinglish (Hindi + English mix) is natural for Delhi callers. Used "Aayushi" as agent name (Indian receptionist persona).

### Decision 2: Google Calendar over Google Meet / WhatsApp for appointment booking
**Why:** Google Calendar is the universal appointment management tool that any dental clinic already uses. Zero new software needed for the clinic owner. The calendar event appears in their existing app with automatic reminders.

### Decision 3: Python uses a single generic tool, NOT a dedicated calendar tool
**Why:** If we added a `book_google_calendar` tool to the Python agent, every new integration (WhatsApp, patient DB, insurance check) would require a new Python tool, a redeploy, and a restart of the agent server. Instead, we implemented ONE generic `query_workspace_integration(action_name, parameters_json)` tool that calls a Next.js API gateway. New integrations only need a new `case` in the Next.js switch — zero Python changes, zero agent restarts. This is the "Tool Gateway Pattern".

### Decision 4: Store OAuth tokens in Supabase, not just localStorage
**Why:** The Python voice agent has no browser context — it can't read localStorage. It needs to access tokens from a server-side database. So we save tokens to Supabase's `integrations` table on OAuth callback. The Next.js tool gateway reads them using the service role key.

### Decision 5: Unified Google OAuth flow (one button for both Gmail + Calendar)
**Why:** Asking users to connect Gmail and Calendar separately would be confusing. One "Sign in with Google" button now requests both scopes in a single OAuth flow. The same `refresh_token` works for both Gmail sending and Calendar booking.

### Decision 6: Graceful degradation everywhere
**Why:** The call must never crash. If the calendar API fails, returns an error, or tokens expire, the agent speaks a polite verbal confirmation ("Main ne note kar liya hai, team call karegi") instead of silently failing or throwing an error mid-call. The Python tool has a 6-second timeout. The Next.js gateway always returns HTTP 200 with a speakable string.

---

## Things Explored But Not Implemented

### Option A: Native Python Google Calendar Client
**What it would be:** Using `google-auth` and `google-api-python-client` pip packages directly in the Python agent.
**Why we didn't:** Adds 3 new Python dependencies, requires storing OAuth tokens in a Python file or env var (not multi-tenant), requires agent restart to update credentials, and is not extensible to other integrations.

### Option B: Workflow Engine (Visual Builder) for Calendar
**What it would be:** Using the existing Next.js visual workflow builder to create a "book appointment" workflow node that the agent triggers post-call.
**Why we partially used it:** The workflow engine is great for post-call tasks (sending emails, generating reports). But for real-time in-call actions (the user is on the phone waiting for confirmation), workflows introduce too much latency. We used the direct tool gateway pattern for live calls and kept the workflow engine for post-call automation.

### Option C: Webhooks from Next.js → Python
**What it would be:** Next.js sends a webhook to Python telling it to book.
**Why we didn't:** Adds reverse HTTP complexity (Python would need to expose an HTTP server), authentication headaches, and higher latency.

---

## Architecture Built Today

```
LIVE CALL FLOW:
Caller speaks → Python (Deepgram STT) → Gemini LLM → decides to book →
calls query_workspace_integration(action_name, parameters_json) →
HTTP POST to localhost:3000/api/tools/execute →
Next.js reads Supabase integrations table →
refreshes Google access_token if expired →
calls Google Calendar API →
returns speakable Hinglish confirmation string →
Python TTS (Sarvam ishita voice) speaks it back to caller →
<2 seconds total round trip
```

```
OAUTH FLOW:
User clicks "Connect Google Calendar" →
/api/auth/gmail/start redirects to Google →
Google redirects to /api/auth/google/callback →
Callback exchanges code for tokens →
Saves tokens to Supabase integrations table →
Redirects to /integrations?gcal_success=1 →
UI shows "Google Calendar & Gmail connected!" toast
```

---

## Files Created as Artifacts (in Antigravity AI brain)

| Artifact | Content |
|----------|---------|
| `demo_scenarios.md` | All 3 original scenario blueprints |
| `scenario_1_deep_prompt.md` | Deep Connaught Place Delhi dental prompt (earlier version) |
| `scenario_1_rag_knowledge.md` | Delhi Dental Center RAG (Connaught Place location, earlier version) |
| `scenario_2_deep_prompt.md` | Outbound Spinny Swift VXI sales prompt |
| `scenario_2_rag_knowledge.md` | Spinny car hub RAG knowledge |
| `walkthrough.md` | Final code changes walkthrough |
| `google_calendar_integration_guide.md` | Technical analysis of integration options |
| `google_calendar_recommended_approach.md` | Decision doc — why Next.js proxy pattern |
| `workflow_engine_orchestration.md` | How to use visual workflow for post-call tasks |
| `realtime_tool_extensibility.md` | Tool gateway architecture blueprint |
| `implementation_plan.md` | The implementation plan that was approved |

---

## Final Inbound Agent Config (Scenario 1 — Active in Production)

- **Agent Name:** Aayushi
- **Clinic:** Shri Krishna Dental Clinic, Greater Kailash Part 1, New Delhi - 110048
- **Voice:** Sarvam / ishita / hi-IN (Hinglish)
- **LLM:** Gemini 2.5 Flash, temperature 0.3
- **STT:** Deepgram nova-3, auto language detection
- **RAG:** 25 treatments + pricing, 3 doctors, clinic hours, insurance, payment info
- **Tools:** save_lead_info, transfer_to_sales, query_workspace_integration (→ Google Calendar)
- **Transfer Number:** +91 9999424997
- **Greeting:** "Namaste! Aap Shri Krishna Dental Clinic mein call kiya hai. Main Aayushi hoon. Aap ki kaise seva kar sakti hoon?"

---

## What to Do Next (Suggestions)

1. **Complete the SQL + Google Console setup** (see 07_SQL_TASKS_TODO.md)
2. **Test Scenario 1 live call** with a real phone call to the inbound number
3. **Build Scenario 2 into outbound config** — same pattern, Priya agent for Spinny Swift VXI sales
4. **Add post-call workflows** — use the visual workflow builder to auto-send WhatsApp/email after appointments
5. **Multi-workspace tokens** — currently workspace_id defaults to "default"; wire it to the actual Supabase workspace ID for proper multi-tenant token isolation
