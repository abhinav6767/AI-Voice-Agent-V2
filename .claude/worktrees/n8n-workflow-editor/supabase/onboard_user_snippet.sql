-- ═══════════════════════════════════════════════════════════════════════════
-- USER ONBOARDING & VERIFICATION SNIPPET
-- Save this script in your Supabase SQL Editor as a "Snippet".
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- 👇 EDIT THESE VARIABLES BEFORE RUNNING 👇
  v_email text       := 'newuser@example.com';
  v_full_name text   := 'New User';
  
  -- role can be: 'super_admin', 'admin', 'manager', 'readonly_user'
  v_role text        := 'super_admin'; 
  
  -- Set to a specific business UUID if not a super_admin, e.g., '11111111-1111-1111-1111-111111111111'
  v_business_id uuid := NULL; 
  -- 👆 ──────────────────────────────────── 👆
  
  v_auth_id uuid;
  v_profile_id uuid;
BEGIN
  -- 1. Check if user already exists in the system auth.users table
  SELECT id INTO v_auth_id FROM auth.users WHERE email = v_email LIMIT 1;

  -- 2. Disable the Row Level Security update trigger temporarily
  ALTER TABLE public.profiles DISABLE TRIGGER check_profile_update_trigger;

  -- 3. Upsert the profile (Insert if new, Update if exists)
  INSERT INTO public.profiles (email, full_name, role, business_id, auth_user_id, created_at)
  VALUES (v_email, v_full_name, v_role, v_business_id, v_auth_id, now())
  ON CONFLICT (email) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    business_id = EXCLUDED.business_id,
    auth_user_id = v_auth_id
  RETURNING id INTO v_profile_id;

  -- 4. Re-enable the security trigger
  ALTER TABLE public.profiles ENABLE TRIGGER check_profile_update_trigger;

  -- 5. Verify and Print Status (Check the "Messages" tab in Supabase after running)
  IF v_auth_id IS NOT NULL THEN
    RAISE NOTICE '✅ SUCCESS: Profile % linked to Auth ID %. User is fully onboarded and CAN login immediately.', v_profile_id, v_auth_id;
  ELSE
    RAISE NOTICE '⏳ PENDING: Profile % created, but user is NOT in auth.users yet. They CAN login now, and the system will link them automatically upon their first Google Sign-In.', v_profile_id;
  END IF;

END;
$$ LANGUAGE plpgsql;
