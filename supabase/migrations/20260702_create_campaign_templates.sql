-- Campaign Templates table
-- Stores reusable campaign configurations so users can load them in Bulk Dialer

CREATE TABLE IF NOT EXISTS campaign_templates (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    name         TEXT NOT NULL,
    config       JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Row-level security: each workspace only sees its own templates
ALTER TABLE campaign_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_isolation" ON campaign_templates
    USING (workspace_id::text = current_setting('request.jwt.claims', true)::json->>'workspace_id');

-- Allow service role full access (used by the API routes via service key)
CREATE POLICY "service_role_all" ON campaign_templates
    TO service_role USING (true) WITH CHECK (true);

-- Index for fast lookup by workspace
CREATE INDEX IF NOT EXISTS idx_campaign_templates_workspace ON campaign_templates(workspace_id);
