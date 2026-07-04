-- Migration to add client-specific Vobiz credentials to workspace_config for multi-tenant isolation.
-- We are adding vobiz_username and vobiz_password to support dynamic SIP trunk provisioning.

ALTER TABLE public.workspace_config
  ADD COLUMN IF NOT EXISTS sip_domain text,
  ADD COLUMN IF NOT EXISTS vobiz_username text,
  ADD COLUMN IF NOT EXISTS vobiz_password text;
