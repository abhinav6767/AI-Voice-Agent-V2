/**
 * One-time migration runner: creates the campaign_templates table in Supabase.
 * Run with: node run_migration.mjs
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load credentials from environment variables (never hardcode secrets in source)
// Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file before running.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('❌ Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const sql = `
CREATE TABLE IF NOT EXISTS campaign_templates (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    name         TEXT NOT NULL,
    config       JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_templates_workspace ON campaign_templates(workspace_id);
`;

try {
    const { error } = await supabase.rpc('exec_sql', { query: sql });
    if (error) {
        // Try direct query approach
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
                'apikey': SERVICE_ROLE_KEY,
            },
            body: JSON.stringify({ query: sql }),
        });
        if (!res.ok) {
            console.error('Migration via RPC failed. Please run the SQL manually in Supabase SQL editor.');
            console.log('\nSQL to run:\n', sql);
        } else {
            console.log('✅ Migration applied via RPC');
        }
    } else {
        console.log('✅ Migration applied successfully');
    }
} catch (e) {
    console.log('\n⚠ Could not auto-apply migration. Please run this SQL in your Supabase SQL Editor:\n');
    console.log(sql);
}
