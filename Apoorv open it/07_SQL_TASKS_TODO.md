# ⚠️ SQL & Setup Tasks — MUST DO Before Testing

These are the one-time setup steps required to activate Google Calendar booking and token persistence. The code is already written and deployed — these are just cloud configuration steps.

---

## STEP 1 — Run Supabase SQL Migration

### Where to run it:
Open: https://supabase.com/dashboard/project/yqvjwcinaefmxjhcojak/sql

### What SQL to run:
Paste and execute the file at:
`supabase/migrations/20260630_create_integrations_table.sql`

Or copy-paste this SQL directly:

```sql
CREATE TABLE IF NOT EXISTS public.integrations (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT         NOT NULL,
  service       TEXT         NOT NULL,
  tokens        JSONB        NOT NULL,
  created_at    TIMESTAMPTZ  DEFAULT now(),
  updated_at    TIMESTAMPTZ  DEFAULT now(),
  CONSTRAINT integrations_workspace_service_unique UNIQUE (workspace_id, service)
);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_integrations_updated_at ON public.integrations;
CREATE TRIGGER set_integrations_updated_at
  BEFORE UPDATE ON public.integrations
  FOR EACH ROW
  EXECUTE PROCEDURE public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS integrations_workspace_id_idx ON public.integrations (workspace_id);
CREATE INDEX IF NOT EXISTS integrations_workspace_service_idx ON public.integrations (workspace_id, service);
```

### What it creates:
- A table called `integrations` that stores Google OAuth tokens per workspace
- When the user clicks "Connect Google Calendar" in the dashboard, tokens get saved here
- The Python voice agent reads tokens from here during live calls to create calendar events

---

## STEP 2 — Add Google Redirect URI in Google Cloud Console

### Where to go:
https://console.cloud.google.com/apis/credentials

### What to do:
1. Click on your OAuth 2.0 Client ID (same one used for Gmail — Client ID: `135543909647-...`)
2. Under **Authorized redirect URIs**, click **Add URI**
3. Add: `http://localhost:3000/api/auth/google/callback`
4. For production, also add your deployed URL e.g. `https://yourdomain.com/api/auth/google/callback`
5. Click **Save**

### Why:
The Gmail OAuth flow now redirects to `/api/auth/google/callback` (the new unified route) instead of `/api/auth/gmail/callback`. Without this change, Google will show a "redirect_uri_mismatch" error.

---

## STEP 3 — Reconnect Google Account in Integrations Page

After steps 1 and 2:
1. Open dashboard → Integrations page
2. If Gmail is currently showing as "Connected", click Disconnect
3. Click "Connect Google Calendar" button
4. Sign in with Google — this time it will ask for both Gmail AND Calendar permissions
5. After connecting, the "Google Calendar + Gmail" card will show your connected account

---

## STEP 4 — Test the Live Booking

Call your inbound number and say:
> "Doctor saab, kal teen baje cleaning ka appointment chahiye"

Aayushi will:
1. Ask for your name
2. Confirm the slot ("Kal teen baje, Teeth Cleaning. Sahi hai?")
3. On your confirmation — call `query_workspace_integration` → POST to `/api/tools/execute` → create a Google Calendar event
4. Speak back: "Perfect! Aapka appointment confirm ho gaya! ..."

Check your Google Calendar — the event should appear within 2-3 seconds of the call.

---

## Summary Checklist

- [ ] Run SQL migration in Supabase
- [ ] Add `http://localhost:3000/api/auth/google/callback` to Google Cloud Console redirect URIs
- [ ] Reconnect Google account in Integrations page (to grant Calendar scope)
- [ ] Test live call with booking request
- [ ] Verify Google Calendar event is created
