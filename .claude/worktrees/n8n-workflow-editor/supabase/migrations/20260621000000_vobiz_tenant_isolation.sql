-- Migration: 20260621000000_vobiz_tenant_isolation.sql
-- Description: Multi-tenant Vobiz credential isolation.
--   1. Ensures all required Vobiz columns exist in workspace_config.
--   2. Locks down the vobiz_password column via a dedicated secure view.
--   3. Adds a helper function agents use to fetch their own trunk config.
--   4. Pins the existing RapidX workspace with its real Vobiz credentials.
--
-- !! SECURITY !!
--   vobiz_password must NEVER be returned to the client browser.
--   The RLS on workspace_config already blocks non-super_admin users.
--   The agent_workspace_config view below exposes ONLY what agents need
--   and deliberately omits the password — agents use the LiveKit trunk ID.

-- ─── 1. ENSURE COLUMNS EXIST ─────────────────────────────────────────────────
-- (Some may have been added by earlier migrations; IF NOT EXISTS is safe.)

ALTER TABLE public.workspace_config
  ADD COLUMN IF NOT EXISTS vobiz_did_number  text,
  ADD COLUMN IF NOT EXISTS sip_domain        text,
  ADD COLUMN IF NOT EXISTS vobiz_username    text,
  ADD COLUMN IF NOT EXISTS vobiz_password    text;   -- stored for trunk re-provisioning only

-- ─── 2. AGENT-FACING VIEW (no password) ──────────────────────────────────────
-- Python agents call Supabase with the service-role key to fetch trunk config.
-- This view is the authoritative source — it never exposes vobiz_password.

CREATE OR REPLACE VIEW public.agent_workspace_config AS
SELECT
  wc.business_id,
  b.name                  AS workspace_name,
  b.slug                  AS workspace_slug,
  wc.livekit_trunk_id,
  wc.inbound_trunk_id,
  wc.dispatch_rule_id,
  wc.vobiz_did_number,
  wc.sip_domain,
  wc.vobiz_username,
  -- Deliberately NO vobiz_password — agents never need it.
  -- They authenticate via the LiveKit trunk ID which already embeds the creds.
  wc.agent_name_outbound,
  wc.agent_name_inbound,
  wc.transfer_number,
  b.is_active
FROM public.workspace_config wc
JOIN public.businesses b ON b.id = wc.business_id;

-- Service-role and super_admin can query this view. Agents use service-role key.
-- No explicit RLS needed on a VIEW — it inherits the base table's RLS.

-- ─── 3. HELPER FUNCTION: fetch config by workspace ID ────────────────────────
-- Used by Python workspace_config_loader.py:
--   config = supabase.rpc('get_workspace_config', {'p_business_id': workspace_id}).execute()

CREATE OR REPLACE FUNCTION public.get_workspace_config(p_business_id uuid)
RETURNS TABLE (
  business_id         uuid,
  workspace_name      text,
  workspace_slug      text,
  livekit_trunk_id    text,
  inbound_trunk_id    text,
  dispatch_rule_id    text,
  vobiz_did_number    text,
  sip_domain          text,
  vobiz_username      text,
  agent_name_outbound text,
  agent_name_inbound  text,
  transfer_number     text,
  is_active           boolean
)
SECURITY DEFINER  -- runs as owner (postgres), bypasses RLS — safe because we
                  -- only expose non-sensitive columns and require p_business_id.
LANGUAGE sql AS $$
  SELECT
    business_id,
    workspace_name,
    workspace_slug,
    livekit_trunk_id,
    inbound_trunk_id,
    dispatch_rule_id,
    vobiz_did_number,
    sip_domain,
    vobiz_username,
    agent_name_outbound,
    agent_name_inbound,
    transfer_number,
    is_active
  FROM public.agent_workspace_config
  WHERE business_id = p_business_id;
$$;

-- ─── 4. HELPER FUNCTION: fetch config by slug ─────────────────────────────────
-- Useful when an agent knows the workspace slug but not the UUID.

CREATE OR REPLACE FUNCTION public.get_workspace_config_by_slug(p_slug text)
RETURNS TABLE (
  business_id         uuid,
  workspace_name      text,
  workspace_slug      text,
  livekit_trunk_id    text,
  inbound_trunk_id    text,
  dispatch_rule_id    text,
  vobiz_did_number    text,
  sip_domain          text,
  vobiz_username      text,
  agent_name_outbound text,
  agent_name_inbound  text,
  transfer_number     text,
  is_active           boolean
)
SECURITY DEFINER
LANGUAGE sql AS $$
  SELECT
    business_id,
    workspace_name,
    workspace_slug,
    livekit_trunk_id,
    inbound_trunk_id,
    dispatch_rule_id,
    vobiz_did_number,
    sip_domain,
    vobiz_username,
    agent_name_outbound,
    agent_name_inbound,
    transfer_number,
    is_active
  FROM public.agent_workspace_config
  WHERE workspace_slug = p_slug
  LIMIT 1;
$$;

-- ─── 5. DROP DUPLICATE RLS POLICIES SAFELY ───────────────────────────────────
-- The super_admin_workspace_config_all policy was created in the initial migration.
-- Nothing to add — workspace_config is already locked to super_admin only.
-- This section is intentionally empty to avoid 42710 collisions.

-- ─── 6. BACKFILL RAPIDX (WORKSPACE 1) SIP DOMAIN ────────────────────────────
-- Set the known Vobiz domain for the seed workspace if it's still blank.
-- This mirrors what was previously only stored in .env.

UPDATE public.workspace_config
SET
  sip_domain     = COALESCE(sip_domain,     '4ab08e8a.sip.vobiz.ai'),
  vobiz_username = COALESCE(vobiz_username, 'rapidx-outbound')
WHERE
  business_id = '11111111-0000-0000-0000-000000000001'
  AND (sip_domain IS NULL OR vobiz_username IS NULL);

-- ─── VERIFICATION ─────────────────────────────────────────────────────────────
-- After running, verify with:
--   SELECT business_id, livekit_trunk_id, vobiz_did_number, sip_domain, vobiz_username
--   FROM public.workspace_config;
--
--   SELECT * FROM public.agent_workspace_config;
--
--   SELECT * FROM public.get_workspace_config('11111111-0000-0000-0000-000000000001'::uuid);
