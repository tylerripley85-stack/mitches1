-- =====================================================================
--  MITCH'S BARBERSHOP — database schema
--  Paste this whole file into the Supabase SQL Editor and press Run.
--  Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto      with schema extensions;
create extension if not exists btree_gist    with schema extensions;
create extension if not exists pg_net        with schema extensions;

-- ---------------------------------------------------------------------
-- Private schema: nothing in here is ever reachable from the browser
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from anon, authenticated, public;

create table if not exists private.secrets (
  key   text primary key,
  value text not null
);
revoke all on private.secrets from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- Settings (one row, id = 1)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                smallint primary key default 1 check (id = 1),
  shop_name         text not null default 'Mitch''s',
  strapline         text not null default 'Barbershop',
  address_1         text not null default '18 Grange Road',
  address_2         text not null default 'Ramsgate, Thanet',
  postcode          text not null default 'CT11 9LR',
  phone             text default '',
  email             text default '',
  instagram         text default '',
  blurb             text default 'A young shop on Grange Road doing sharp, modern work — fades, scissor cuts and beards — without the wait or the fuss.',
  getting_here      text default '',
  tz                text not null default 'Europe/London',
  currency          text not null default '£',
  stamps_required   int  not null default 8  check (stamps_required between 2 and 30),
  slot_mins         int  not null default 15 check (slot_mins between 5 and 60),
  lead_mins         int  not null default 60 check (lead_mins between 0 and 10080),
  horizon_days      int  not null default 21 check (horizon_days between 1 and 180),
  cancel_hours      int  not null default 2  check (cancel_hours between 0 and 168),
  max_open_per_email int not null default 3,
  max_daily_per_email int not null default 5,
  site_url          text not null default 'http://localhost:3000',
  from_email        text not null default 'onboarding@resend.dev',
  from_name         text not null default 'Mitch''s Barbershop',
  reminders_enabled boolean not null default true,
  updated_at        timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------
create table if not exists public.services (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text default '',
  price_pence int  not null default 0 check (price_pence >= 0),
  mins        int  not null default 30 check (mins between 5 and 480),
  sort        int  not null default 0,
  active      boolean not null default true,
  earns_stamp boolean not null default true,   -- a free cut should not stamp the card
  badge       text default '',                 -- e.g. FREE, POPULAR
  created_at  timestamptz not null default now()
);

create unique index if not exists services_name_key on public.services (lower(name));

-- ---------------------------------------------------------------------
-- Barbers
-- ---------------------------------------------------------------------
create table if not exists public.barbers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  role       text default 'Barber',
  bio        text default '',
  sort       int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists barbers_name_key on public.barbers (lower(name));

-- Restrict a service to certain barbers. No rows for a service = anyone can do it.
-- This is how "free cuts with the apprentices" stays off Mitch's own chair.
create table if not exists public.service_barbers (
  service_id uuid not null references public.services(id) on delete cascade,
  barber_id  uuid not null references public.barbers(id)  on delete cascade,
  primary key (service_id, barber_id)
);

-- Shop opening hours, one row per weekday (0 = Sunday)
create table if not exists public.opening_hours (
  dow    smallint primary key check (dow between 0 and 6),
  label  text not null,
  closed boolean not null default false,
  opens  time not null default '09:00',
  closes time not null default '18:00'
);

-- Optional per-barber override. No row = follows shop hours.
create table if not exists public.barber_hours (
  barber_id uuid not null references public.barbers(id) on delete cascade,
  dow       smallint not null check (dow between 0 and 6),
  works     boolean not null default true,
  opens     time,
  closes    time,
  primary key (barber_id, dow)
);

-- Holidays, training days, lunch, anything that blocks the chair
create table if not exists public.time_off (
  id        uuid primary key default gen_random_uuid(),
  barber_id uuid references public.barbers(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  note      text default '',
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists time_off_barber_idx on public.time_off (barber_id, starts_at);

-- ---------------------------------------------------------------------
-- Customers  (the cut card lives here)
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id                uuid primary key default gen_random_uuid(),
  name              text not null default '',
  email             text not null,
  phone             text default '',
  token             uuid not null default gen_random_uuid(),
  stamps            int  not null default 0 check (stamps >= 0),
  free_cuts         int  not null default 0 check (free_cuts >= 0),
  redeemed          int  not null default 0 check (redeemed >= 0),
  marketing_opt_in  boolean not null default false,
  opted_in_at       timestamptz,
  card_number       text not null default '',
  created_at        timestamptz not null default now()
);
create unique index if not exists customers_email_key on public.customers (lower(email));
create unique index if not exists customers_token_key on public.customers (token);

-- ---------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------
do $$ begin
  create type public.booking_status as enum ('booked','done','cancelled','noshow');
exception when duplicate_object then null; end $$;

create table if not exists public.bookings (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,
  customer_id  uuid not null references public.customers(id) on delete cascade,
  barber_id    uuid not null references public.barbers(id)   on delete restrict,
  service_id   uuid not null references public.services(id)  on delete restrict,
  booking_date date not null,
  start_time   time not null,
  mins         int  not null check (mins between 5 and 480),
  price_pence  int  not null default 0,
  starts_at    timestamptz not null,
  slot         tstzrange   not null,
  status       public.booking_status not null default 'booked',
  notes        text default '',
  free_cut     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists bookings_date_idx     on public.bookings (booking_date, start_time);
create index if not exists bookings_customer_idx on public.bookings (customer_id);
create index if not exists bookings_starts_idx   on public.bookings (starts_at);

-- The hard guarantee: the database itself refuses to double-book a chair.
do $$ begin
  alter table public.bookings
    add constraint bookings_no_overlap
    exclude using gist (barber_id with =, slot with &&) where (status = 'booked');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Outgoing email queue
-- ---------------------------------------------------------------------
create table if not exists public.mail_outbox (
  id         bigserial primary key,
  to_email   text not null,
  subject    text not null,
  html       text not null,
  kind       text not null default 'general',
  booking_id uuid references public.bookings(id) on delete set null,
  status     text not null default 'pending',   -- pending | sent | failed
  attempts   int  not null default 0,
  error      text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists mail_outbox_pending_idx on public.mail_outbox (status, id);
create unique index if not exists mail_outbox_once_idx
  on public.mail_outbox (booking_id, kind) where booking_id is not null;

-- ---------------------------------------------------------------------
-- Who is allowed in the back office
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text default '',
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.shop_tz()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select tz from public.settings where id = 1), 'Europe/London');
$$;

-- Turn a shop-local date + minutes-past-midnight into a real instant
create or replace function public.slot_ts(d date, m int)
returns timestamptz language sql stable security definer set search_path = public as $$
  select (d + make_interval(mins => m)) at time zone public.shop_tz();
$$;

create or replace function public.today_local()
returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone public.shop_tz())::date;
$$;

create or replace function private.new_ref()
returns text language plpgsql as $$
declare
  letters text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  r text;
begin
  loop
    r := 'MB-'
      || substr(letters, 1 + floor(random()*24)::int, 1)
      || substr(letters, 1 + floor(random()*24)::int, 1)
      || lpad(floor(random()*10000)::int::text, 4, '0');
    exit when not exists (select 1 from public.bookings b where b.ref = r);
  end loop;
  return r;
end $$;

create or replace function private.new_card_number()
returns text language sql as $$
  select '6' || lpad(floor(random()*1000)::int::text, 3, '0') || ' '
      || lpad(floor(random()*10000)::int::text, 4, '0') || ' '
      || lpad(floor(random()*10000)::int::text, 4, '0');
$$;

-- Keep starts_at / slot in step with the date, time and length
create or replace function private.sync_booking_slot()
returns trigger language plpgsql security definer set search_path = public as $$
declare m int;
begin
  m := (extract(epoch from new.start_time) / 60)::int;
  new.starts_at := public.slot_ts(new.booking_date, m);
  new.slot := tstzrange(new.starts_at, new.starts_at + make_interval(mins => new.mins), '[)');
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists bookings_sync_slot on public.bookings;
create trigger bookings_sync_slot
  before insert or update of booking_date, start_time, mins on public.bookings
  for each row execute function private.sync_booking_slot();

-- ---------------------------------------------------------------------
-- Row Level Security — deny by default, open only what is needed
-- ---------------------------------------------------------------------
alter table public.settings        enable row level security;
alter table public.services        enable row level security;
alter table public.service_barbers enable row level security;
alter table public.barbers       enable row level security;
alter table public.opening_hours enable row level security;
alter table public.barber_hours  enable row level security;
alter table public.time_off      enable row level security;
alter table public.customers     enable row level security;
alter table public.bookings      enable row level security;
alter table public.mail_outbox   enable row level security;
alter table public.admins        enable row level security;

-- Staff (signed in AND listed in admins) get full control.
do $$
declare t text;
begin
  foreach t in array array['settings','services','service_barbers','barbers','opening_hours','barber_hours','time_off','customers','bookings','mail_outbox','admins']
  loop
    execute format('drop policy if exists staff_all on public.%I', t);
    execute format(
      'create policy staff_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- The public website reads the menu, the team and the hours. Nothing else.
drop policy if exists public_read on public.services;
create policy public_read on public.services      for select to anon, authenticated using (active);
drop policy if exists public_read on public.barbers;
create policy public_read on public.barbers       for select to anon, authenticated using (active);
drop policy if exists public_read on public.opening_hours;
create policy public_read on public.opening_hours for select to anon, authenticated using (true);
drop policy if exists public_read on public.service_barbers;
create policy public_read on public.service_barbers for select to anon, authenticated using (true);

-- Customers and bookings are NOT readable from the browser at all.
-- Everything the public site needs goes through the functions below.

grant usage on schema public to anon, authenticated;
grant select on public.services, public.barbers, public.opening_hours, public.service_barbers to anon, authenticated;
grant all on public.settings, public.services, public.service_barbers, public.barbers,
             public.opening_hours, public.barber_hours, public.time_off, public.customers,
             public.bookings, public.mail_outbox, public.admins to authenticated;
grant usage, select on all sequences in schema public to authenticated;
