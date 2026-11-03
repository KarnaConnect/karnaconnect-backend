-- Mash sales outreach agent (2026-11-03). Additive only: new nullable/defaulted columns and one new table.
alter table outbound_agents add column if not exists purpose text not null default 'general';

alter table campaigns
  add column if not exists timezone text,
  add column if not exists window_start text,
  add column if not exists window_end text,
  add column if not exists weekdays_only boolean not null default false,
  add column if not exists max_concurrent integer not null default 3,
  add column if not exists dnc_checked_at date,
  add column if not exists completed_at timestamptz;

alter table campaign_contacts
  add column if not exists business_name text,
  add column if not exists industry text,
  add column if not exists suburb text,
  add column if not exists outcome text,
  add column if not exists summary text,
  add column if not exists duration_seconds numeric,
  add column if not exists ended_reason text,
  add column if not exists called_at timestamptz;

create index if not exists campaign_contacts_call_id_idx on campaign_contacts (call_id);

-- Mash's own do-not-call / suppression list. Backend (service role) only.
create table if not exists do_not_call (
  phone_number text primary key,
  reason text,
  source text,
  business_name text,
  created_at timestamptz not null default now()
);
alter table do_not_call enable row level security;
