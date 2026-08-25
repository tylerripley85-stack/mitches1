-- Local-only stub so the Supabase SQL can be run against plain Postgres.
-- NOT part of the deployment.
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists net;

do $$ begin create role anon nologin;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin;  exception when duplicate_object then null; end $$;

create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);

create table if not exists auth.jwt_ctx (uid uuid);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

-- pg_net stand-in: record the call instead of making it
create table if not exists net._http_response (
  id bigint primary key, status_code int, content text, error_msg text);
create sequence if not exists net.req_seq;
create table if not exists net.sent (
  id bigint, url text, headers jsonb, body jsonb, at timestamptz default now());
create or replace function net.http_post(
  url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language plpgsql as $$
declare rid bigint;
begin
  rid := nextval('net.req_seq');
  insert into net.sent (id, url, headers, body) values (rid, url, headers, body);
  insert into net._http_response (id, status_code, content) values (rid, 200, '{"id":"stub"}');
  return rid;
end $$;
