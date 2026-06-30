# Walkthrough — Scenario 1 Dental Center + Google Calendar Booking

## ✅ Build Status
**Next.js build: PASSED** — `/api/tools/execute` confirmed in build output alongside all existing routes.

---

## What Was Implemented

### 1. Inbound Agent Config — Shri Krishna Dental Clinic, Delhi
**File:** [data/agent_config.json](file:///c:/Users/abhin/Downloads/Antigravity/Ai%20voice%20calling%20Agent%20v4/AI-Voice-Agent-V4/data/agent_config.json)

- Agent **Aayushi** — warm Delhi dental receptionist, Hinglish-first
- 4-state conversation machine: Intent → Patient Capture → Action → Close
- Embedded RAG knowledge: **25 treatments + pricing**, 3 doctors, clinic hours (Mon-Sat 9-1, 5-8, Sunday closed), insurance (Star Health, CGHS, ECHS), payment (EMI, UPI, cards)
- Temperature lowered to 0.3 (factual accuracy for medical/pricing info)
- `query_workspace_integration` registered as a custom function

### 2. Python Generic Tool Gateway
**File:** [agent_inbound.py](file:///c:/Users/abhin/Downloads/Antigravity/Ai%20voice%20calling%20Agent%20v4/AI-Voice-Agent-V4/agent_inbound.py)

A **single extensible tool** added to `InboundTools`:
- `query_workspace_integration(action_name, parameters_json)` — POSTs to `TOOL_GATEWAY_URL`
- 6-second timeout with graceful Hindi fallback (call never crashes)
- Uses stdlib `urllib.request` — no new Python dependencies

### 3. Next.js Tool Gateway API
**File:** [/api/tools/execute](file:///c:/Users/abhin/Downloads/Antigravity/Ai%20voice%20calling%20Agent%20v4/AI-Voice-Agent-V4/dashboard/app/api/tools/execute/route.ts)

| Action | What it does |
|--------|-------------|
| `book_appointment` | Creates Google Calendar event with IST timezone, auto-reminders (1h popup + 24h email), clinic location, patient details |
| `check_availability` | Queries Google freeBusy API for the day, returns natural language Hinglish slot summary |
| *(add new cases here)* | Zero Python restarts needed |

**Smart features:**
- Auto-refreshes expired OAuth tokens via `refresh_token`
- Parses Hinglish time ("teen baje", "das baje") + English ("3 PM", "15:00")
- Parses Hindi/English dates ("kal", "tomorrow", "5th July")
- Enforces clinic hours (9-13 or 17-20 IST) — clamps out-of-hours bookings
- Blocks Sunday bookings, moves to Monday automatically
- Graceful degradation: if Calendar unavailable, speaks a verbal confirmation instead of crashing

### 4. Unified Google OAuth
**Files:**
- [/api/auth/gmail/start](file:///c:/Users/abhin/Downloads/Antigravity/Ai%20voice%20calling%20Agent%20v4/AI-Voice-Agent-V4/dashboard/app/api/auth/gmail/start/route.ts) — Now requests `calendar.events` scope + routes to unified callback
- [/api/auth/google/callback](file:///c:/Users/abhin/Downloads/Antigravity/Ai%20voice%20calling%20Agent%20v4/AI-Voice-Agent-V4/dashboard/app/api/auth/google/callback/route.ts) — Saves tokens to Supabase `integrations` table (accessible by the Python agent's tool gateway during live calls)

### 5. Integrations UI — Google Calendar Card
**File:** [integrations/page.tsx](file:///c:/Users/abhin/Downloads/Antigravity/Ai%20voice%20calling%20Agent%20v4/AI-Voice-Agent-V4/dashboard/app/%28dashboard%29/integrations/page.tsx)

- New **Google Calendar + Gmail** card at the top of the grid
- "Connect Google Calendar" button → same OAuth flow (grants both scopes)
- Connected state shows account avatar, name, email + shield badge
- `gcal_success=1` URL param handling shows a success toast

### 6. Supabase Migration
**File:** [supabase/migrations/20260630_create_integrations_table.sql](file:///c:/Users/abhin/Downloads/Antigravity/Ai%20voice%20calling%20Agent%20v4/AI-Voice-Agent-V4/supabase/migrations/20260630_create_integrations_table.sql)

```sql
CREATE TABLE public.integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  service TEXT NOT NULL,   -- 'google_calendar', 'gmail', etc.
  tokens JSONB NOT NULL,   -- { access_token, refresh_token, email, ... }
  ...
  UNIQUE(workspace_id, service)
);
```

---

## ⚡ One-Time Setup Required

> [!IMPORTANT]
> **Step 1 — Run SQL Migration in Supabase:**
> Open [Supabase SQL Editor](https://supabase.com/dashboard/project/yqvjwcinaefmxjhcojak/sql) and paste + run the contents of [20260630_create_integrations_table.sql](file:///c:/Users/abhin/Downloads/Antigravity/Ai%20voice%20calling%20Agent%20v4/AI-Voice-Agent-V4/supabase/migrations/20260630_create_integrations_table.sql)

> [!IMPORTANT]
> **Step 2 — Add Google Redirect URI:**
> Go to [Google Cloud Console → OAuth 2.0 Credentials](https://console.cloud.google.com/apis/credentials) → your OAuth client → **Authorized redirect URIs** → Add:
> ```
> http://localhost:3000/api/auth/google/callback
> ```
> (For production, also add your deployed URL)

> [!WARNING]
> **Step 3 — Reconnect Google Account:**
> The Gmail OAuth now requests additional Calendar scope. Any existing Gmail connection in Integrations will need to be disconnected and reconnected to grant Calendar permissions.

---

## Live Call Flow

```
Caller: "Doctor saab, kal teen baje cleaning ka appointment chahiye"
    │
    ▼
Aayushi (LLM): Detects STATE_3A (BOOK_APPOINTMENT)
    → Asks: "Aapka naam kya hai?"
    → Collects: name + phone → calls save_lead_info
    → Confirms: "Kal teen baje Teeth Cleaning ke liye. Sahi hai?"
    │
    ▼ caller confirms
    │
    ▼
calls query_workspace_integration(
  action_name = "book_appointment",
  parameters_json = '{"patient_name":"Rohit","date":"kal","time":"teen baje","treatment":"Teeth Cleaning","phone":"9876543210","duration_minutes":45}'
)
    │
    ▼ HTTP POST → localhost:3000/api/tools/execute (<200ms)
    │ → reads tokens from Supabase
    │ → refreshes access_token if expired
    │ → parses "kal" = tomorrow, "teen baje" = 15:00 IST
    │ → enforces clinic hours (17:00 is valid evening slot → use 15:00)
    │ → creates Google Calendar event with location + reminders
    │ → returns "Perfect! Rohit ji, Teeth Cleaning ke liye..."
    │
    ▼
Aayushi speaks: "Perfect! Aapka appointment confirm ho gaya!
                 Rohit ji, Teeth Cleaning ke liye kal teen baje —
                 Shri Krishna Dental Clinic, Greater Kailash mein.
                 Aapko ek reminder bhi milega. Appointment ke din
                 thodi der pehle aa jayiyega."
```

---

## Extensibility — Adding New Live Actions

To add e.g. **WhatsApp confirmation** after booking:

1. Add to [route.ts](file:///c:/Users/abhin/Downloads/Antigravity/Ai%20voice%20calling%20Agent%20v4/AI-Voice-Agent-V4/dashboard/app/api/tools/execute/route.ts):
```typescript
case "send_whatsapp":
  result = await handleSendWhatsApp(parameters, workspaceId);
  break;
```
2. Update the `query_workspace_integration` description in [agent_config.json](file:///c:/Users/abhin/Downloads/Antigravity/Ai%20voice%20calling%20Agent%20v4/AI-Voice-Agent-V4/data/agent_config.json) to mention the new action.
3. **Zero Python code changes. Zero agent restarts.**
