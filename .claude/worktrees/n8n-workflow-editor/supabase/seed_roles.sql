-- ═══════════════════════════════════════════════════════════════════════════
--  SEED DATA + SCHEMA EXTENSION  —  Role Testing Scenario
--  Run this in Supabase SQL Editor → Editor tab  (one shot)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── STEP 1: Extend the leads table with enriched CRM columns ────────────────
--  The base schema only had: id, business_id, first_name, last_name, phone,
--  status, custom_fields, created_at, updated_at.
--  We add all the columns our front-end expects.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS name          text,
  ADD COLUMN IF NOT EXISTS email         text,
  ADD COLUMN IF NOT EXISTS city          text,
  ADD COLUMN IF NOT EXISTS company       text,
  ADD COLUMN IF NOT EXISTS priority      text DEFAULT 'Medium'
                             CHECK (priority IN ('Low','Medium','High','Urgent')),
  ADD COLUMN IF NOT EXISTS source        text DEFAULT 'Manual'
                             CHECK (source IN (
                               'AI Agent (Inbound)', 'AI Agent (Outbound)',
                               'Website', 'Referral', 'Google Ads',
                               'Social Media', 'Walk-in', 'Manual', 'Other')),
  ADD COLUMN IF NOT EXISTS tags          text[]   DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notes         jsonb    DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS assigned_to   uuid     REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS sentiment     text,
  ADD COLUMN IF NOT EXISTS caller_intent text,
  ADD COLUMN IF NOT EXISTS call_count    integer  DEFAULT 0;

-- Also widen the status column to match our expected values
-- (base schema had text 'new'; we use 'New', 'Contacted', etc.)
ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_status_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_status_check
  CHECK (status IN ('New','Contacted','Qualified','Proposal','Negotiation','Won','Lost'));

-- Update any existing 'new' values to 'New' (case fix)
UPDATE public.leads SET status = 'New' WHERE status = 'new';
ALTER TABLE public.leads ALTER COLUMN status SET DEFAULT 'New';


-- ── STEP 2: Businesses ───────────────────────────────────────────────────────

INSERT INTO public.businesses (id, name, owner_id, created_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Acme Sales Corp', null, now()),
  ('22222222-2222-2222-2222-222222222222', 'Beta Tech Ltd',   null, now())
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;


-- ── STEP 3: Profiles ─────────────────────────────────────────────────────────
--  auth_user_id stays NULL until the user logs in for the first time.

ALTER TABLE public.profiles DISABLE TRIGGER check_profile_update_trigger;

INSERT INTO public.profiles (email, full_name, role, business_id, created_at)
VALUES
  ('apoorvchandhok11@gmail.com',   'Apoorv (Super Admin)',  'super_admin', NULL,                                   now()),
  ('kaush5230@gmail.com',           'Kaushal (Admin)',        'admin',       '11111111-1111-1111-1111-111111111111', now()),
  ('apoorvchandhok01@gmail.com',    'Apoorv (Manager)',       'manager',     '11111111-1111-1111-1111-111111111111', now()),
  ('apoorv.chandhok1999@gmail.com', 'Apoorv (Viewer)',        'readonly_user', '11111111-1111-1111-1111-111111111111', now()),
  ('extrasndpart@gmail.com',        'Beta Admin',             'admin',       '22222222-2222-2222-2222-222222222222', now())
ON CONFLICT (email) DO UPDATE SET
  full_name   = EXCLUDED.full_name,
  role        = EXCLUDED.role,
  business_id = EXCLUDED.business_id;

ALTER TABLE public.profiles ENABLE TRIGGER check_profile_update_trigger;


-- ── STEP 4: Mock Leads — Acme Sales Corp ─────────────────────────────────────

INSERT INTO public.leads
  (business_id, name, phone, email, city, company,
   status, priority, source, tags, sentiment, caller_intent, call_count, last_activity_at)
VALUES
  ( '11111111-1111-1111-1111-111111111111',
    'Rajesh Kumar', '+91-XXXXX-001', 'rajesh@acme-xxx.com',
    'Mumbai', 'Kumar Enterprises',
    'New', 'High', 'AI Agent (Inbound)',
    ARRAY['hot-lead','b2b'], 'Positive', 'Product inquiry', 2, now() - interval '1 hour' ),

  ( '11111111-1111-1111-1111-111111111111',
    'Priya Sharma', '+91-XXXXX-002', 'priya@demo-xxx.com',
    'Delhi', 'Sharma Co.',
    'Contacted', 'Medium', 'AI Agent (Outbound)',
    ARRAY['follow-up'], 'Neutral', 'Pricing info', 1, now() - interval '3 hours' ),

  ( '11111111-1111-1111-1111-111111111111',
    'Amit Patel', '+91-XXXXX-003', 'amit@patel-xxx.com',
    'Ahmedabad', 'Patel Industries',
    'Qualified', 'Urgent', 'Referral',
    ARRAY['enterprise','qualified'], 'Positive', 'Demo request', 3, now() - interval '30 minutes' ),

  ( '11111111-1111-1111-1111-111111111111',
    'Sunita Reddy', '+91-XXXXX-004', 'sunita@reddy-xxx.com',
    'Hyderabad', 'Reddy Corp',
    'Proposal', 'High', 'Website',
    ARRAY['proposal-sent'], 'Positive', 'Contract discussion', 4, now() - interval '6 hours' ),

  ( '11111111-1111-1111-1111-111111111111',
    'Vikram Singh', '+91-XXXXX-005', 'vikram@singh-xxx.com',
    'Bangalore', 'Singh Tech',
    'Lost', 'Low', 'Google Ads',
    ARRAY['churned'], 'Negative', 'Price too high', 1, now() - interval '2 days' )

ON CONFLICT DO NOTHING;


-- ── STEP 5: Mock Leads — Beta Tech Ltd ───────────────────────────────────────

INSERT INTO public.leads
  (business_id, name, phone, email, city, company,
   status, priority, source, tags, sentiment, caller_intent, call_count, last_activity_at)
VALUES
  ( '22222222-2222-2222-2222-222222222222',
    'John Beta', '+91-XXXXX-101', 'john@beta-xxx.com',
    'Chennai', 'Beta Client A',
    'New', 'Medium', 'AI Agent (Inbound)',
    ARRAY['new-lead'], 'Neutral', 'General inquiry', 1, now() - interval '2 hours' ),

  ( '22222222-2222-2222-2222-222222222222',
    'Sarah Beta', '+91-XXXXX-102', 'sarah@beta-xxx.com',
    'Pune', 'Beta Client B',
    'Contacted', 'High', 'Referral',
    ARRAY['vip','partnership'], 'Positive', 'Partnership discussion', 2, now() - interval '4 hours' ),

  ( '22222222-2222-2222-2222-222222222222',
    'Mike Beta', '+91-XXXXX-103', 'mike@beta-xxx.com',
    'Kolkata', 'Beta Client C',
    'Qualified', 'Medium', 'Website',
    ARRAY['warm-lead'], 'Neutral', 'Product demo request', 1, now() - interval '1 day' )

ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFICATION — uncomment to check after running
-- ═══════════════════════════════════════════════════════════════════════════

-- SELECT id, name FROM public.businesses;

-- SELECT p.email, p.role, b.name as business
-- FROM public.profiles p LEFT JOIN public.businesses b ON b.id = p.business_id
-- ORDER BY p.role;

-- SELECT b.name as business, l.name, l.status, l.priority
-- FROM public.leads l JOIN public.businesses b ON b.id = l.business_id
-- ORDER BY b.name, l.created_at DESC;
