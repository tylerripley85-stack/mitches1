-- =====================================================================
--  MITCH'S BARBERSHOP — sending the emails
--  Run AFTER 02_functions.sql.
--
--  Emails are written into public.mail_outbox by the booking functions.
--  A scheduled job posts them to Resend and records what happened.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Your Resend API key. Replace the value, run this line, and it is
-- stored where the browser can never reach it.
-- ---------------------------------------------------------------------
insert into private.secrets (key, value)
values ('resend_api_key', 're_PASTE_YOUR_KEY_HERE')
on conflict (key) do update set value = excluded.value;

-- ---------------------------------------------------------------------
-- Push pending mail to Resend
-- ---------------------------------------------------------------------
create or replace function private.dispatch_mail(p_limit int default 20)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  s public.settings%rowtype;
  api_key text;
  m public.mail_outbox%rowtype;
  req_id bigint;
  n int := 0;
begin
  select * into s from public.settings where id = 1;
  select value into api_key from private.secrets where key = 'resend_api_key';
  if api_key is null or api_key like 're_PASTE%' then return 0; end if;

  for m in
    select * from public.mail_outbox
     where status = 'pending' and attempts < 3
     order by id
     limit p_limit
     for update skip locked
  loop
    select net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || api_key),
      body    := jsonb_build_object(
                   'from',    s.from_name || ' <' || s.from_email || '>',
                   'to',      array[m.to_email],
                   'subject', m.subject,
                   'html',    m.html),
      timeout_milliseconds := 8000
    ) into req_id;

    update public.mail_outbox
       set status = 'sent', request_id = req_id, attempts = attempts + 1, sent_at = now()
     where id = m.id;
    n := n + 1;
  end loop;

  return n;
end $$;

-- ---------------------------------------------------------------------
-- Read the replies back and flag anything Resend rejected, so a failed
-- email shows up in the staff diary instead of vanishing.
-- ---------------------------------------------------------------------
create or replace function private.check_mail()
returns int language plpgsql security definer set search_path = public, extensions, net as $$
declare n int := 0;
begin
  update public.mail_outbox o
     set status = case when o.attempts >= 3 then 'failed' else 'pending' end,
         error  = left(coalesce(r.error_msg, r.content, 'HTTP ' || r.status_code::text), 400)
    from net._http_response r
   where r.id = o.request_id
     and o.status = 'sent'
     and (r.status_code is null or r.status_code >= 300);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Tomorrow's reminders
-- ---------------------------------------------------------------------
create or replace function private.queue_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare s public.settings%rowtype; b record; n int := 0;
begin
  select * into s from public.settings where id = 1;
  if not s.reminders_enabled then return 0; end if;

  for b in
    select bk.id from public.bookings bk
     where bk.status = 'booked'
       and bk.booking_date = public.today_local() + 1
       and not exists (select 1 from public.mail_outbox o
                        where o.booking_id = bk.id and o.kind = 'reminder')
  loop
    perform private.queue_booking_email(b.id, 'reminder');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Housekeeping: old sent mail does not need to sit there forever
-- ---------------------------------------------------------------------
create or replace function private.tidy_outbox()
returns void language sql security definer set search_path = public as $$
  delete from public.mail_outbox
   where status = 'sent' and created_at < now() - interval '60 days';
$$;

-- ---------------------------------------------------------------------
-- Schedule it.  pg_cron must be enabled first:
--   Supabase dashboard -> Database -> Extensions -> search "pg_cron" -> enable
-- Times below are UTC.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobname) from cron.job
      where jobname in ('mitchs-send-mail','mitchs-check-mail','mitchs-reminders','mitchs-tidy');

    perform cron.schedule('mitchs-send-mail',  '* * * * *',    $j$ select private.dispatch_mail(); $j$);
    perform cron.schedule('mitchs-check-mail', '*/5 * * * *',  $j$ select private.check_mail(); $j$);
    -- 17:00 UTC = 6pm British Summer Time, 5pm in winter. Close enough for "the evening before".
    perform cron.schedule('mitchs-reminders',  '0 17 * * *',   $j$ select private.queue_reminders(); $j$);
    perform cron.schedule('mitchs-tidy',       '30 3 * * 1',   $j$ select private.tidy_outbox(); $j$);
    raise notice 'Scheduled jobs created.';
  else
    raise notice 'pg_cron is not enabled yet — enable it, then run this file again.';
  end if;
end $$;
