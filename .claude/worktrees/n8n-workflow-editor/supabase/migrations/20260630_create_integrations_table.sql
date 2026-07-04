-- =============================================================================
-- Migration: Create `integrations` table
-- =============================================================================
-- This table stores OAuth tokens and API credentials for each workspace's
-- third-party integrations (Google Calendar, Gmail, WhatsApp, etc.).
-- The Python voice agent reads from this table at runtime via the Next.js
-- tool gateway (/api/tools/execute) to perform live actions during calls.
--
-- Run this in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/yqvjwcinaefmxjhcojak/sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.integrations (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT         NOT NULL,
  service       TEXT         NOT NULL,      -- 'google_calendar', 'gmail', 'whatsapp', etc.
  tokens        JSONB        NOT NULL,       -- { access_token, refresh_token, email, name, picture, connected_at, ... }
  created_at    TIMESTAMPTZ  DEFAULT now(),
  updated_at    TIMESTAMPTZ  DEFAULT now(),

  -- One row per workspace per service
  CONSTRAINT integrations_workspace_service_unique UNIQUE (workspace_id, service)
);

-- Enable Row Level Security
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used by the tool gateway via SUPABASE_SERVICE_ROLE_KEY)
-- No additional policy needed for service role access.

-- (Optional) Allow authenticated users to read/write their own workspace integrations
-- Uncomment and adapt if you add user auth to the integrations page:
--
-- CREATE POLICY "Workspace members can manage integrations"
--   ON public.integrations
--   FOR ALL
--   USING (workspace_id = current_user_workspace())
--   WITH CHECK (workspace_id = current_user_workspace());

-- Trigger to auto-update `updated_at` on every UPDATE
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

-- Index for fast lookup by workspace_id (used by tool gateway on every call)
CREATE INDEX IF NOT EXISTS integrations_workspace_id_idx
  ON public.integrations (workspace_id);

CREATE INDEX IF NOT EXISTS integrations_workspace_service_idx
  ON public.integrations (workspace_id, service);
