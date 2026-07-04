# Call Campaign SaaS Platform

Multi-tenant SaaS product for running inbound and outbound voice call campaigns. Each business owner gets their own isolated account — dialer, leads, workflows, integrations, billing — with role-based access for their team.

*This README documents the planned roles, permissions, and multi-tenancy design based on the current wireframe and permission sheet. Items flagged as open questions still need a decision before implementation.*

## Tech Stack

- **Auth & Database:** Supabase (Postgres + Auth + Row Level Security)
- **OAuth Provider:** Google (only sign-in method)
- **Frontend / Hosting:** TBD

## Core Features

- **Outbound Dialer** — place outbound calls
- **Call Logs & Transcripts** — history and transcripts of past calls
- **Leads CRM** — manage leads feeding into campaigns
- **Workflows** — visual builder for call routing and automation
- **Integrations** — connect external tools/CRMs
- **Wallet / Billing** — usage and payment
- **Agent Configuration** — inbound and outbound voice agent setup

## Authentication & Onboarding

Every user signs in through a single Google OAuth flow via Supabase Auth — there's no separate sign-up page, since this is invite-only B2B software, not a self-serve consumer product.

- Super Admin creates the first Admin when onboarding a new business.
- Admin invites Managers and Read-Only Users by email. That email gets a `profiles` row with the right role and `business_id`, but no linked auth user yet.
- When that person signs in with Google for the first time, their email is matched to the pending profile and linked up.
- A Google sign-in with no matching profile should be rejected with a clear message, not silently granted access — otherwise anyone with a Google account could self-register.

What a user sees after login is determined entirely by their stored `role` and `business_id`, not by which URL or portal they used to sign in.

## User Roles

**Super Admin** — You, the platform operator. Not tied to any one business. Can view and act inside any business account, for support, onboarding, and troubleshooting.

**Admin** — The business owner who subscribed to the platform. Full control over their own business only; cannot see or touch other businesses. Functionally, "Super Admin permissions, scoped to one tenant."

**Manager** — Staff who run day-to-day calling operations: dialing, leads, workflows. Locked out of billing and inbound/outbound agent configuration — those stay owner-controlled.

**Read-Only User** — Same visibility as Manager, but can't create or edit anything anywhere. Good for trainees, QA reviewers, or stakeholders who only need to observe.

```
Super Admin
 ├─ Business A → Admin → Manager(s) → Read-Only User(s)
 ├─ Business B → Admin → Manager(s) → Read-Only User(s)
 └─ Business C → Admin → Manager(s) → Read-Only User(s)
```

## Permissions Matrix

R/W = read & write · R = read-only

| Page | Feature | Super Admin | Admin (Owner) | Manager | Read-Only User |
|---|---|:---:|:---:|:---:|:---:|
| `/dialer` | Outbound Dialer | R/W | R/W | R/W | R |
| `/logs` | Call Logs | R/W | R/W | R/W | R |
| `/logs/[id]` | Call Transcript Viewer | R/W | R/W | R/W | R |
| `/leads` | Leads CRM | R/W | R/W | R/W | R |
| `/workflows` | Workflows | R/W | R/W | R/W | R |
| `/workflows/builder` | Workflow Builder Canvas | R/W | R/W | R/W | R |
| `/integrations` | Integrations | R/W | R/W | R/W | R |
| `/wallet` | Wallet / Billing | R/W | R/W | R | R |
| `/config/inbound` | Inbound Agent Config | R/W | R/W | R | R |
| `/config/outbound` | Outbound Agent Config | R/W | R/W | R | R |

Manager and Read-Only User see the exact same pages. The only difference is edit rights on the operational pages (dialer, logs, leads, workflows, integrations) — and both are locked out of billing and agent config regardless, since those are business-level decisions, not day-to-day operating ones.

## Super Admin "Login As" — Needs a Decision

Supabase doesn't give you cross-account impersonation for free, so this needs to be built deliberately. Two common patterns:

**Context switch (simpler, recommended to start):** Super Admin keeps their own session. They pick a business in the UI, which sets a `viewing_business_id`. Every query/RPC checks "is this caller super_admin, OR does their business_id match the row" — so one RLS policy shape covers both cases, and it's always genuinely the Super Admin's own JWT making the call.

**Real session swap:** A server-side function (service-role key, never exposed to the client) mints a session for the target Admin, and the Super Admin's browser effectively becomes that user. Cleaner RLS (no special-casing needed), but you lose the built-in separation between "Super Admin acting" and "owner acting" unless the swap itself is explicitly logged.

Whichever you pick, log every Super Admin access into a business account — who, which business, when, what they touched. This kind of access turns into a support and trust question fast if it's silent.

## Suggested Data Model (starting point)

```sql
create table businesses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid references auth.users(id),
  created_at  timestamptz default now()
);

create table profiles (
  id           uuid primary key references auth.users(id),
  email        text not null,
  full_name    text,
  role         text check (role in ('super_admin','admin','manager','readonly_user')),
  business_id  uuid references businesses(id), -- null for super_admin
  created_at   timestamptz default now()
);
```

Every tenant-scoped table (calls, leads, workflows, wallet_transactions, etc.) carries its own `business_id`. RLS policies check `profiles.business_id = row.business_id`, with an `OR is_super_admin()` clause wherever Super Admin needs cross-tenant access.

## Open Questions

- **Naming cleanup** — the original sheet had a line reading "Superadmin (business owner) can login into his own account," which looks like a typo for "Admin." This README assumes **Admin = business owner** (own account only) and **Super Admin = platform operator** (every account). Flag it if that's backwards.
- **Invite flow** — confirm the email-invite-then-link approach above is what you had in mind, versus something simpler for v1.
- **Edit on Call Logs** — Manager has edit rights on `/logs` and `/logs/[id]`. Worth confirming this means adding notes/dispositions/tags, not rewriting the transcript itself.
- **Audit logging** — given Super Admin can see into any business's calls, leads, and billing, an audit trail is worth treating as a real requirement, not a nice-to-have.