-- Mash sells itself: lead pipeline, industry calling windows, follow-ups (2026-11-18).
-- Additive only: one new table for leads, one for settings, new nullable columns.
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  phone_number text not null unique,
  industry text not null,
  suburb text,
  address text,
  website text,
  email text,
  email_consent boolean not null default false,
  email_sent_at timestamptz,
  email_opt_out boolean not null default false,
  source text,
  source_ref text,
  -- new | queued | no_answer | hot | wants_info | on_the_fence | not_interested | customer | do_not_call | unreachable
  status text not null default 'new',
  last_outcome text,
  last_summary text,
  last_call_id text,
  last_called_at timestamptz,
  in_flight_call_id text,
  call_attempts integer not null default 0,
  follow_up_by text,          -- 'mash' | 'adil' | null
  follow_up_at timestamptz,
  follow_up_note text,
  follow_up_count integer not null default 0,
  dncr_checked_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leads_status_idx on leads (status);
create index if not exists leads_industry_idx on leads (industry);
create index if not exists leads_follow_up_idx on leads (follow_up_by, follow_up_at);
alter table leads enable row level security;

alter table campaigns
  add column if not exists industry text,
  add column if not exists call_windows jsonb;

alter table campaign_contacts
  add column if not exists lead_id uuid references leads(id) on delete set null,
  add column if not exists interest text;

create table if not exists outreach_settings (
  id integer primary key default 1 check (id = 1),
  paused boolean not null default false,
  auto_followups boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into outreach_settings (id) values (1) on conflict do nothing;
alter table outreach_settings enable row level security;
