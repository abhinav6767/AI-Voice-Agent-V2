-- ═══════════════════════════════════════════════════════════════════════════
--  ARCHIVE PAST DATA SCRIPT
--  Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Create a special hidden "Archive" workspace just for the Super Admin
INSERT INTO public.businesses (id, name, created_at)
VALUES ('00000000-0000-0000-0000-000000000000', 'Super Admin Archive', now())
ON CONFLICT (id) DO NOTHING;

-- 2. Move any old Leads to the Archive workspace
-- (We use created_at to only move things created BEFORE today, 
-- so it doesn't hide the new mock data we just created)
UPDATE public.leads 
SET business_id = '00000000-0000-0000-0000-000000000000'
WHERE created_at < CURRENT_DATE;

-- 3. Move any old Call Logs to the Archive workspace
UPDATE public.call_logs 
SET business_id = '00000000-0000-0000-0000-000000000000'
WHERE created_at < CURRENT_DATE;

-- 4. (Optional) Move any old Agent Configs to the Archive workspace
UPDATE public.agent_configs 
SET business_id = '00000000-0000-0000-0000-000000000000'
WHERE created_at < CURRENT_DATE;
