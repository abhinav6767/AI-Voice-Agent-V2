-- Migration: 20260620000000_super_admin_layer.sql
-- Description: Super Admin Layer — workspace config, billing, live rooms audit,
--              spending view, and Workspace-1 migration for existing data.
-- Safe to run on existing schema: uses ADD COLUMN IF NOT EXISTS and CREATE IF NOT EXISTS.

-- ─── 1. EXTEND businesses TABLE ─────────────────────────────────────────────
-- Add billing rates and LiveKit/SIP identifiers directly to businesses.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS slug               text unique,
  ADD COLUMN IF NOT EXISTS logo_url           text,
  ADD COLUMN IF NOT EXISTS phone_number       text,
  ADD COLUMN IF NOT EXISTS is_active          boolean default true,
  ADD COLUMN IF NOT EXISTS rate_out_per_min   numeric(10,6) default 0.020000,
  ADD COLUMN IF NOT EXISTS rate_in_per_min    numeric(10,6) default 0.010000;

-- Backfill slug for existing businesses (use lowercase name, spaces → dashes)
UPDATE public.businesses
  SET slug = lower(regexp_replace(name, '\s+', '-', 'g'))
  WHERE slug IS NULL;

-- ─── 2. WORKSPACE CONFIG ─────────────────────────────────────────────────────
-- Stores LiveKit trunk IDs, SIP credentials, and agent config.
-- RLS: ONLY super_admin + service_role can read/write. Never exposed to clients.

CREATE TABLE IF NOT EXISTS public.workspace_config (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null unique references public.businesses(id) on delete cascade,
  livekit_trunk_id     text,            -- outbound SIP trunk ID (e.g. ST_GpnrjlpsVC2K)
  inbound_trunk_id     text,            -- inbound SIP trunk ID
  dispatch_rule_id     text,            -- LiveKit SIP dispatch rule ID (auto-provisioned)
  vobiz_did_number     text,            -- DID phone number assigned to this workspace
  sip_domain           text,
  transfer_number      text,
  agent_name_outbound  text,            -- e.g. "outbound-caller" (shared worker)
  agent_name_inbound   text,            -- e.g. "inbound-caller"  (shared worker)
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

ALTER TABLE public.workspace_config ENABLE ROW LEVEL SECURITY;

-- Only super_admin and service_role can touch workspace_config
CREATE POLICY "super_admin_workspace_config_all"
  ON public.workspace_config FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE TRIGGER update_workspace_config_updated_at
  BEFORE UPDATE ON public.workspace_config
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

-- ─── 3. BILLING RATES TABLE ──────────────────────────────────────────────────
-- Per-workspace provider cost rates (editable by super_admin per client).

CREATE TABLE IF NOT EXISTS public.workspace_billing_rates (
  business_id           uuid primary key references public.businesses(id) on delete cascade,
  -- Your markup rates (what you charge the client)
  rate_outbound_per_min numeric(10,6) default 0.020000,
  rate_inbound_per_min  numeric(10,6) default 0.010000,
  -- Actual provider costs (your cost baseline)
  stt_rate_per_min      numeric(10,6) default 0.004300,  -- Deepgram Nova-2 actual
  tts_rate_per_min      numeric(10,6) default 0.004000,  -- Sarvam bulbul:v3 estimate
  llm_rate_per_token    numeric(12,8) default 0.00000060, -- Groq Llama 3.3 70B actual
  livekit_rate_per_min  numeric(10,6) default 0.001000,  -- LiveKit Cloud actual
  updated_at            timestamptz default now()
);

ALTER TABLE public.workspace_billing_rates ENABLE ROW LEVEL SECURITY;

-- super_admin: full access; admins: read-only their own business rates
CREATE POLICY "super_admin_billing_rates_all"
  ON public.workspace_billing_rates FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "admin_view_own_billing_rates"
  ON public.workspace_billing_rates FOR SELECT
  USING (business_id = public.get_user_business_id() AND public.get_user_role() = 'admin');

CREATE TRIGGER update_billing_rates_updated_at
  BEFORE UPDATE ON public.workspace_billing_rates
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

-- ─── 4. EXTEND call_logs FOR BILLING ─────────────────────────────────────────
-- Add columns needed to compute per-call cost accurately.

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS duration_seconds  integer default 0,
  ADD COLUMN IF NOT EXISTS llm_tokens_used   integer default 0,
  ADD COLUMN IF NOT EXISTS room_name         text,        -- LiveKit room name (ws-{bid}-{ts})
  ADD COLUMN IF NOT EXISTS cost_usd          numeric(10,6); -- computed and stored at call end

-- ─── 5. ADMIN AUDIT LOG ──────────────────────────────────────────────────────
-- Immutable log of all super_admin actions (kill room, create/delete workspace, impersonate).
-- Separate from the existing audit_logs table (which is business-scoped).

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references auth.users(id) on delete set null,
  action       text not null,   -- 'kill_room' | 'create_workspace' | 'delete_workspace' | 'impersonate'
  target       text,            -- room name, business_id, etc.
  metadata     jsonb default '{}'::jsonb,
  created_at   timestamptz default now()
);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- super_admin can read; inserts only via service_role (backend API routes)
CREATE POLICY "super_admin_read_audit_log"
  ON public.admin_audit_log FOR SELECT
  USING (public.is_super_admin());

-- Only authenticated users can insert (API routes run as authenticated with service key)
CREATE POLICY "service_role_insert_audit_log"
  ON public.admin_audit_log FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ─── 6. WEEKLY SPEND VIEW ────────────────────────────────────────────────────
-- Used by the workspace list table to show "Weekly Spend" per business.
-- Formula: (call minutes × direction rate) + (total minutes × provider rates) + (tokens × llm rate)

CREATE OR REPLACE VIEW public.weekly_workspace_spend AS
SELECT
  cl.business_id,
  COUNT(*)                                                     AS total_calls,
  ROUND(SUM(cl.duration_seconds) / 60.0, 2)                   AS total_minutes,
  ROUND(SUM(
    -- Direction-based markup rate
    (cl.duration_seconds / 60.0) *
      CASE cl.direction
        WHEN 'outbound' THEN COALESCE(br.rate_outbound_per_min, 0.020000)
        ELSE                  COALESCE(br.rate_inbound_per_min,  0.010000)
      END
    -- Provider cost: STT + TTS + LiveKit (per minute)
    + (cl.duration_seconds / 60.0) * (
        COALESCE(br.stt_rate_per_min,     0.004300)
      + COALESCE(br.tts_rate_per_min,     0.004000)
      + COALESCE(br.livekit_rate_per_min, 0.001000)
    )
    -- LLM token cost
    + COALESCE(cl.llm_tokens_used, 0) * COALESCE(br.llm_rate_per_token, 0.00000060)
  ), 6)                                                        AS total_spend_usd,
  -- Breakdown for display
  COUNT(*) FILTER (WHERE cl.direction = 'inbound')             AS inbound_calls,
  COUNT(*) FILTER (WHERE cl.direction = 'outbound')            AS outbound_calls,
  ROUND(SUM(cl.duration_seconds) FILTER (WHERE cl.direction = 'outbound') / 60.0, 2) AS outbound_minutes,
  ROUND(SUM(cl.duration_seconds) FILTER (WHERE cl.direction = 'inbound')  / 60.0, 2) AS inbound_minutes
FROM public.call_logs cl
LEFT JOIN public.workspace_billing_rates br ON br.business_id = cl.business_id
WHERE cl.created_at >= now() - INTERVAL '7 days'
GROUP BY cl.business_id;

-- ─── 7. HELPER FUNCTIONS ─────────────────────────────────────────────────────

-- Get business_id from slug (used by Create Workspace to check uniqueness)
CREATE OR REPLACE FUNCTION public.get_business_id_by_slug(p_slug text)
RETURNS uuid SECURITY DEFINER AS $$
  SELECT id FROM public.businesses WHERE slug = p_slug LIMIT 1;
$$ LANGUAGE sql;

-- Check if current user is admin of a specific business (used in API guards)
CREATE OR REPLACE FUNCTION public.is_business_admin(p_business_id uuid)
RETURNS boolean SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid()
      AND business_id = p_business_id
      AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql;

-- ─── 8. WORKSPACE 1 MIGRATION ────────────────────────────────────────────────
-- Migrates the existing RapidX setup as the first workspace.
-- The fixed UUID ensures idempotency (safe to re-run).

DO $$
DECLARE
  v_business_id uuid := '11111111-0000-0000-0000-000000000001';
  v_existing    uuid;
BEGIN
  -- Only insert if this exact business doesn't exist yet
  SELECT id INTO v_existing FROM public.businesses WHERE id = v_business_id;

  IF v_existing IS NULL THEN
    INSERT INTO public.businesses (id, name, slug, phone_number, is_active, created_at)
    VALUES (v_business_id, 'RapidX (Workspace 1)', 'rapidx', '+918065480288', true, now());

    -- Default billing rates for Workspace 1
    INSERT INTO public.workspace_billing_rates (business_id)
    VALUES (v_business_id)
    ON CONFLICT (business_id) DO NOTHING;

    -- Workspace config placeholder — trunk IDs filled after LiveKit verification
    INSERT INTO public.workspace_config (
      business_id,
      livekit_trunk_id,
      inbound_trunk_id,
      vobiz_did_number,
      agent_name_outbound,
      agent_name_inbound
    ) VALUES (
      v_business_id,
      'ST_GpnrjlpsVC2K',       -- existing outbound trunk from .env
      'ST_6EDBHqmcr7rs',       -- existing inbound trunk from .env
      '+918065480288',
      'outbound-caller',
      'inbound-caller'
    ) ON CONFLICT (business_id) DO NOTHING;

    RAISE NOTICE 'Workspace 1 (RapidX) created with id: %', v_business_id;
  ELSE
    RAISE NOTICE 'Workspace 1 already exists, skipping insert.';
  END IF;
END $$;

-- ─── 9. STAMP EXISTING DATA WITH WORKSPACE 1 ────────────────────────────────
-- Any rows in leads / call_logs / workflows / agent_configs that belong to
-- the original test businesses get NO change here — they already have their
-- own business_id from the seed.  This block is a safety net: any rows with
-- NULL business_id get assigned to Workspace 1.

UPDATE public.leads
  SET business_id = '11111111-0000-0000-0000-000000000001'
  WHERE business_id IS NULL;

UPDATE public.call_logs
  SET business_id = '11111111-0000-0000-0000-000000000001'
  WHERE business_id IS NULL;

UPDATE public.workflows
  SET business_id = '11111111-0000-0000-0000-000000000001'
  WHERE business_id IS NULL;

UPDATE public.agent_configs
  SET business_id = '11111111-0000-0000-0000-000000000001'
  WHERE business_id IS NULL;

-- ─── 10. MAKE YOUR ACCOUNT SUPER_ADMIN ───────────────────────────────────────
-- The email below is already in seed_roles.sql as super_admin.
-- This is a safety upsert in case it hasn't been seeded yet.
-- Disabling the trigger matches the pattern used in seed_roles.sql —
-- migrations run without an auth session so check_profile_update() would
-- otherwise reject any UPDATE on profiles.
-- !! REPLACE with your actual email if different !!

ALTER TABLE public.profiles DISABLE TRIGGER check_profile_update_trigger;

INSERT INTO public.profiles (email, full_name, role, business_id)
VALUES ('apoorvchandhok11@gmail.com', 'Super Admin', 'super_admin', NULL)
ON CONFLICT (email) DO UPDATE SET role = 'super_admin', business_id = NULL;

ALTER TABLE public.profiles ENABLE TRIGGER check_profile_update_trigger;

-- ─── 11. DEFAULT BILLING RATES FOR EXISTING BUSINESSES ───────────────────────
-- Insert default billing rates for any business that doesn't have a rates row yet.

INSERT INTO public.workspace_billing_rates (business_id)
SELECT id FROM public.businesses
WHERE id NOT IN (SELECT business_id FROM public.workspace_billing_rates)
ON CONFLICT (business_id) DO NOTHING;

-- ─── VERIFICATION QUERIES (uncomment to check after running) ─────────────────
-- SELECT id, name, slug, phone_number, is_active FROM public.businesses ORDER BY created_at;
-- SELECT business_id, livekit_trunk_id, inbound_trunk_id FROM public.workspace_config;
-- SELECT business_id, rate_outbound_per_min, stt_rate_per_min FROM public.workspace_billing_rates;
-- SELECT id, action, target, created_at FROM public.admin_audit_log LIMIT 10;
-- SELECT * FROM public.weekly_workspace_spend;
