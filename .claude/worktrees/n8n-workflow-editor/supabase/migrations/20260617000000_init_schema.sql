-- Migration: 20260617000000_init_schema.sql
-- Description: Initialize Calling Campaign SaaS Multi-tenant Database Schema with RLS and Auth triggers

-- ─── 1. CORE MULTI-TENANCY TABLES ──────────────────────────────────────────────

-- Businesses (Tenants)
create table public.businesses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid, -- Will be set once the admin profile is linked to auth.users
  created_at  timestamptz default now()
);

-- Profiles (Users mapped to roles and businesses)
-- Note: auth_user_id is NULL for pending invites. It maps to auth.users(id) on first Google OAuth login.
create table public.profiles (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email        text not null unique,
  full_name    text,
  role         text not null check (role in ('super_admin', 'admin', 'manager', 'readonly_user')),
  business_id  uuid references public.businesses(id) on delete cascade, -- Null for super_admin
  created_at   timestamptz default now()
);

-- Link owner_id in businesses back to profiles for integrity
alter table public.businesses 
  add constraint fk_businesses_owner foreign key (owner_id) references public.profiles(id) on delete set null;

-- ─── 2. HELPER FUNCTIONS FOR RLS & POLICIES ────────────────────────────────────

-- Check if current user is a Super Admin
create or replace function public.is_super_admin()
returns boolean security definer as $$
begin
  return exists (
    select 1 from public.profiles
    where auth_user_id = auth.uid() and role = 'super_admin'
  );
end;
$$ language plpgsql;

-- Get the business_id of the current user
create or replace function public.get_user_business_id()
returns uuid security definer as $$
declare
  bid uuid;
begin
  select business_id into bid from public.profiles where auth_user_id = auth.uid();
  return bid;
end;
$$ language plpgsql;

-- Get the role of the current user
create or replace function public.get_user_role()
returns text security definer as $$
declare
  r text;
begin
  select role into r from public.profiles where auth_user_id = auth.uid();
  return r;
end;
$$ language plpgsql;

-- ─── 3. AUTH & PROFILE MANAGEMENT TRIGGERS ─────────────────────────────────────

-- Handle new user registration via Google OAuth
-- If email exists in public.profiles (pending invite), link it and allow registration.
-- Otherwise, reject signup to enforce invite-only behavior.
create or replace function public.handle_new_user_signup()
returns trigger security definer as $$
declare
  profile_record record;
begin
  -- Search for email case-insensitively
  select * into profile_record from public.profiles where lower(email) = lower(new.email);
  
  if profile_record.id is not null then
    -- Pre-authorized profile exists, link the auth.users.id
    update public.profiles
    set auth_user_id = new.id
    where lower(email) = lower(new.email);
    
    -- Set owner_id on business if this profile is an admin and the business has no owner yet
    if profile_record.role = 'admin' then
      update public.businesses
      set owner_id = profile_record.id
      where id = profile_record.business_id and owner_id is null;
    end if;
    
    return new;
  else
    -- Reject registration
    raise exception 'Email % is not authorized. Registration is invite-only.', new.email;
  end if;
end;
$$ language plpgsql;

create trigger on_auth_user_created
  before insert on auth.users
  for each row execute procedure public.handle_new_user_signup();

-- Trigger to prevent users from escalating privileges or changing businesses
create or replace function public.check_profile_update()
returns trigger security definer as $$
begin
  -- Allow system-level linking: a pending invite (auth_user_id IS NULL) being
  -- linked to a new auth user by handle_new_user_signup. auth.uid() is NULL
  -- at this point because the auth.users row doesn't exist yet.
  if old.auth_user_id is null and new.auth_user_id is not null then
    -- Only allow: linking auth_user_id. Block any other field changes in same operation.
    if new.role <> old.role or new.business_id is distinct from old.business_id or new.email <> old.email then
      raise exception 'Cannot change role/business while linking auth user.';
    end if;
    return new;
  end if;

  -- Bypass validation if Super Admin
  if public.is_super_admin() then
    return new;
  end if;

  -- Admin of the business updating managers/readonly users
  if public.get_user_business_id() = old.business_id and public.get_user_role() = 'admin' then
    if new.business_id <> old.business_id then
      raise exception 'Admins cannot change business association.';
    end if;
    if new.role = 'super_admin' then
      raise exception 'Admins cannot assign super_admin role.';
    end if;
    return new;
  
  -- Regular user updating their own details
  elsif auth.uid() = old.auth_user_id then
    if new.role <> old.role or new.business_id <> old.business_id or new.email <> old.email or new.auth_user_id <> old.auth_user_id then
      raise exception 'Unauthorized modification of role, business, email, or auth mapping.';
    end if;
    return new;
  else
    raise exception 'Unauthorized profile modification.';
  end if;
end;
$$ language plpgsql;

create trigger check_profile_update_trigger
  before update on public.profiles
  for each row execute procedure public.check_profile_update();

-- ─── 4. OPERATIONAL TABLES ─────────────────────────────────────────────────────

-- Leads CRM
create table public.leads (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  first_name    text,
  last_name     text,
  phone         text not null,
  status        text default 'new',
  custom_fields jsonb default '{}'::jsonb,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Call Logs & Transcripts (Notes editable, core call data immutable)
create table public.call_logs (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  lead_id       uuid references public.leads(id) on delete set null,
  direction     text not null check (direction in ('inbound', 'outbound')),
  from_number   text,
  to_number     text,
  status        text,
  duration      integer default 0,
  transcript    jsonb default '[]'::jsonb,
  audio_url     text,
  notes         text,
  created_at    timestamptz default now()
);

-- Trigger to make call log details immutable for non-superadmins (only notes editable)
create or replace function public.check_call_log_update()
returns trigger security definer as $$
begin
  if not public.is_super_admin() then
    if new.id <> old.id or new.business_id <> old.business_id or new.lead_id <> old.lead_id or
       new.direction <> old.direction or new.from_number <> old.from_number or new.to_number <> old.to_number or
       new.status <> old.status or new.duration <> old.duration or new.transcript <> old.transcript or
       new.audio_url <> old.audio_url or new.created_at <> old.created_at then
      raise exception 'Only the notes field can be modified in call logs.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger check_call_log_update_trigger
  before update on public.call_logs
  for each row execute procedure public.check_call_log_update();

-- Agent Configuration (Inbound & Outbound Settings)
create table public.agent_configs (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  mode               text not null check (mode in ('inbound', 'outbound')),
  agent_name         text not null,
  call_description   text,
  system_prompt      text not null,
  initial_greeting   text,
  fallback_greeting  text,
  stt_provider       text,
  stt_model          text,
  stt_language       text,
  tts_provider       text,
  tts_voice          text,
  tts_language       text,
  llm_provider       text,
  llm_model          text,
  llm_temperature    numeric(3,2) default 0.70,
  transfer_number    text,
  resources          jsonb default '[]'::jsonb,
  custom_functions   jsonb default '[]'::jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  constraint unique_business_mode unique (business_id, mode)
);

-- Workflows (Visual Builder State)
create table public.workflows (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  name          text not null,
  description   text,
  status        text default 'draft',
  nodes         jsonb default '[]'::jsonb,
  edges         jsonb default '[]'::jsonb,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Integrations
create table public.integrations (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  type          text not null, -- 'hubspot', 'salesforce', 'gmail', etc.
  credentials   jsonb default '{}'::jsonb,
  status        text default 'inactive',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  constraint unique_business_integration unique (business_id, type)
);

-- Wallet & Billing
create table public.wallet (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null unique references public.businesses(id) on delete cascade,
  balance       numeric(12,4) default 0.0000,
  currency      text default 'USD',
  updated_at    timestamptz default now()
);

-- Wallet Transactions
create table public.wallet_transactions (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  amount        numeric(12,4) not null,
  type          text not null check (type in ('credit', 'debit')),
  description   text,
  created_at    timestamptz default now()
);

-- Audit Logs for Tracking Access & Impersonations
create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  actor_id        uuid references auth.users(id) on delete set null,
  business_id     uuid references public.businesses(id) on delete cascade,
  action          text not null,
  target_resource text not null,
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz default now()
);

-- ─── 5. UPDATED_AT COLUMN TRIGGER ──────────────────────────────────────────────

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_leads_updated_at before update on public.leads for each row execute procedure public.update_updated_at_column();
create trigger update_agent_configs_updated_at before update on public.agent_configs for each row execute procedure public.update_updated_at_column();
create trigger update_workflows_updated_at before update on public.workflows for each row execute procedure public.update_updated_at_column();
create trigger update_integrations_updated_at before update on public.integrations for each row execute procedure public.update_updated_at_column();

-- ─── 6. ROW LEVEL SECURITY (RLS) POLICIES ──────────────────────────────────────

-- Enable RLS on all tables
alter table public.businesses enable row level security;
alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.call_logs enable row level security;
alter table public.agent_configs enable row level security;
alter table public.workflows enable row level security;
alter table public.integrations enable row level security;
alter table public.wallet enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.audit_logs enable row level security;

-- ─── BUSINESSES POLICIES ───
create policy "Super admin has full access to businesses"
  on public.businesses for all using (public.is_super_admin()) with check (public.is_super_admin());

create policy "Users can view their own business"
  on public.businesses for select using (id = public.get_user_business_id());

create policy "Admins can update their own business"
  on public.businesses for update using (id = public.get_user_business_id() and public.get_user_role() = 'admin')
  with check (id = public.get_user_business_id() and public.get_user_role() = 'admin');

-- ─── PROFILES POLICIES ───
create policy "Super admin has full access to profiles"
  on public.profiles for all using (public.is_super_admin()) with check (public.is_super_admin());

create policy "Users can view profiles in the same business"
  on public.profiles for select using (business_id = public.get_user_business_id());

create policy "Admins can invite and manage profiles in their business"
  on public.profiles for insert 
  with check (business_id = public.get_user_business_id() and public.get_user_role() = 'admin' and role in ('manager', 'readonly_user') and auth_user_id is null);

create policy "Admins can update profiles in their business"
  on public.profiles for update 
  using (business_id = public.get_user_business_id() and public.get_user_role() = 'admin')
  with check (business_id = public.get_user_business_id() and public.get_user_role() = 'admin');

create policy "Admins can delete profiles in their business"
  on public.profiles for delete
  using (business_id = public.get_user_business_id() and public.get_user_role() = 'admin' and role in ('manager', 'readonly_user'));

create policy "Users can update their own profile fields"
  on public.profiles for update
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- ─── LEADS POLICIES ───
create policy "Super admin has full access to leads"
  on public.leads for all using (public.is_super_admin()) with check (public.is_super_admin());

create policy "Users can view leads of their business"
  on public.leads for select using (business_id = public.get_user_business_id());

create policy "Admins and Managers can manage leads"
  on public.leads for all using (business_id = public.get_user_business_id() and public.get_user_role() in ('admin', 'manager'))
  with check (business_id = public.get_user_business_id() and public.get_user_role() in ('admin', 'manager'));

-- ─── CALL LOGS POLICIES ───
create policy "Super admin has full access to call logs"
  on public.call_logs for all using (public.is_super_admin()) with check (public.is_super_admin());

create policy "Users can view call logs of their business"
  on public.call_logs for select using (business_id = public.get_user_business_id());

create policy "Admins and Managers can create or update call logs"
  on public.call_logs for all using (business_id = public.get_user_business_id() and public.get_user_role() in ('admin', 'manager'))
  with check (business_id = public.get_user_business_id() and public.get_user_role() in ('admin', 'manager'));

-- ─── AGENT CONFIGS POLICIES ───
create policy "Super admin has full access to agent configs"
  on public.agent_configs for all using (public.is_super_admin()) with check (public.is_super_admin());

create policy "Users can view agent configs of their business"
  on public.agent_configs for select using (business_id = public.get_user_business_id());

create policy "Admins can configure agents"
  on public.agent_configs for all using (business_id = public.get_user_business_id() and public.get_user_role() = 'admin')
  with check (business_id = public.get_user_business_id() and public.get_user_role() = 'admin');

-- ─── WORKFLOWS POLICIES ───
create policy "Super admin has full access to workflows"
  on public.workflows for all using (public.is_super_admin()) with check (public.is_super_admin());

create policy "Users can view workflows of their business"
  on public.workflows for select using (business_id = public.get_user_business_id());

create policy "Admins and Managers can manage workflows"
  on public.workflows for all using (business_id = public.get_user_business_id() and public.get_user_role() in ('admin', 'manager'))
  with check (business_id = public.get_user_business_id() and public.get_user_role() in ('admin', 'manager'));

-- ─── INTEGRATIONS POLICIES ───
create policy "Super admin has full access to integrations"
  on public.integrations for all using (public.is_super_admin()) with check (public.is_super_admin());

create policy "Users can view integrations of their business"
  on public.integrations for select using (business_id = public.get_user_business_id());

create policy "Admins and Managers can manage integrations"
  on public.integrations for all using (business_id = public.get_user_business_id() and public.get_user_role() in ('admin', 'manager'))
  with check (business_id = public.get_user_business_id() and public.get_user_role() in ('admin', 'manager'));

-- ─── WALLET POLICIES ───
create policy "Super admin has full access to wallet"
  on public.wallet for all using (public.is_super_admin()) with check (public.is_super_admin());

create policy "Users can view wallet of their business"
  on public.wallet for select using (business_id = public.get_user_business_id());

-- ─── WALLET TRANSACTIONS POLICIES ───
create policy "Super admin has full access to transactions"
  on public.wallet_transactions for all using (public.is_super_admin()) with check (public.is_super_admin());

create policy "Users can view transactions of their business"
  on public.wallet_transactions for select using (business_id = public.get_user_business_id());

-- ─── AUDIT LOGS POLICIES ───
create policy "Super admin has full access to audit logs"
  on public.audit_logs for all using (public.is_super_admin()) with check (public.is_super_admin());

create policy "Admins can view audit logs of their business"
  on public.audit_logs for select using (business_id = public.get_user_business_id() and public.get_user_role() = 'admin');

create policy "Authenticated users can write audit logs"
  on public.audit_logs for insert with check (auth.role() = 'authenticated');
