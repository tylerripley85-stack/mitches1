-- =====================================================================
--  MITCH'S BARBERSHOP — the API the website is allowed to call
--  Run this AFTER 01_schema.sql. Safe to run more than once.
-- =====================================================================

alter table public.mail_outbox add column if not exists request_id bigint;

-- ---------------------------------------------------------------------
-- Email templates
-- ---------------------------------------------------------------------
create or replace function private.email_shell(p_heading text, p_body text)
returns text language plpgsql stable security definer set search_path = public as $$
declare s public.settings%rowtype;
begin
  select * into s from public.settings where id = 1;
  return
  '<!doctype html><html><body style="margin:0;padding:0;background:#0a0a0b;">'
  || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:28px 12px;">'
  || '<tr><td align="center">'
  || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#121214;border:1px solid #2a282c;border-radius:8px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;">'
  || '<tr><td style="padding:22px 26px;border-bottom:1px solid #2a282c;background:#17171a;">'
  ||   '<div style="font-size:22px;font-weight:bold;color:#f8f6f3;letter-spacing:.5px;">' || coalesce(s.shop_name,'') || '</div>'
  ||   '<div style="font-size:11px;letter-spacing:3px;color:#918c86;text-transform:uppercase;margin-top:3px;">' || coalesce(s.strapline,'') || '</div>'
  || '</td></tr>'
  || '<tr><td style="padding:28px 26px;color:#f8f6f3;">'
  ||   '<h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;color:#f8f6f3;">' || p_heading || '</h1>'
  ||   p_body
  || '</td></tr>'
  || '<tr><td style="padding:18px 26px;border-top:1px solid #2a282c;background:#17171a;color:#918c86;font-size:12px;line-height:1.6;">'
  ||   coalesce(s.address_1,'') || ', ' || coalesce(s.address_2,'') || ', ' || coalesce(s.postcode,'')
  ||   case when coalesce(s.phone,'') <> '' then '<br>' || s.phone else '' end
  || '</td></tr>'
  || '</table></td></tr></table></body></html>';
end $$;

create or replace function private.btn(p_url text, p_label text)
returns text language sql immutable as $$
  select '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;"><tr>'
      || '<td style="background:#ff6b18;border-radius:4px;">'
      || '<a href="' || p_url || '" style="display:inline-block;padding:13px 22px;color:#0a0a0b;'
      || 'font-weight:bold;font-size:15px;text-decoration:none;font-family:Helvetica,Arial,sans-serif;">'
      || p_label || '</a></td></tr></table>';
$$;

create or replace function private.pretty_dt(d date, t time)
returns text language sql immutable as $$
  select to_char(d, 'FMDay FMDD FMMonth') || ' at ' || to_char(t, 'HH24:MI');
$$;

-- ---------------------------------------------------------------------
-- Queue the emails
-- ---------------------------------------------------------------------
create or replace function private.queue_booking_email(p_booking uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.settings%rowtype;
  b public.bookings%rowtype;
  c public.customers%rowtype;
  bar public.barbers%rowtype;
  svc public.services%rowtype;
  manage_url text; body text; subj text; heading text;
begin
  select * into s from public.settings where id = 1;
  select * into b from public.bookings where id = p_booking;
  if not found then return; end if;
  select * into c   from public.customers where id = b.customer_id;
  select * into bar from public.barbers   where id = b.barber_id;
  select * into svc from public.services  where id = b.service_id;

  manage_url := rtrim(s.site_url,'/') || '/manage.html?t=' || c.token::text;

  body :=
    '<p style="margin:0 0 18px;color:#c3beb8;font-size:15px;line-height:1.6;">'
    || case p_kind
         when 'confirmation' then 'You are in the diary. Here are the details.'
         when 'reminder'     then 'Quick reminder — you are in the chair tomorrow.'
         when 'cancelled'    then 'That booking has been cancelled. The slot is back in the diary.'
         when 'moved'        then 'Your booking has been moved. Here are the new details.'
         else '' end
    || '</p>'
    || '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #2a282c;border-radius:6px;">'
    || '<tr><td style="padding:14px 18px;border-bottom:1px solid #2a282c;color:#918c86;font-size:12px;">WHEN</td>'
    || '<td style="padding:14px 18px;border-bottom:1px solid #2a282c;color:#f8f6f3;font-size:15px;text-align:right;">'
    ||   private.pretty_dt(b.booking_date, b.start_time) || '</td></tr>'
    || '<tr><td style="padding:14px 18px;border-bottom:1px solid #2a282c;color:#918c86;font-size:12px;">BARBER</td>'
    || '<td style="padding:14px 18px;border-bottom:1px solid #2a282c;color:#f8f6f3;font-size:15px;text-align:right;">' || bar.name || '</td></tr>'
    || '<tr><td style="padding:14px 18px;border-bottom:1px solid #2a282c;color:#918c86;font-size:12px;">SERVICE</td>'
    || '<td style="padding:14px 18px;border-bottom:1px solid #2a282c;color:#f8f6f3;font-size:15px;text-align:right;">'
    ||   svc.name || ' &middot; ' || svc.mins || ' min</td></tr>'
    || '<tr><td style="padding:14px 18px;border-bottom:1px solid #2a282c;color:#918c86;font-size:12px;">PAY IN SHOP</td>'
    || '<td style="padding:14px 18px;border-bottom:1px solid #2a282c;color:#ff6b18;font-size:15px;text-align:right;">'
    ||   s.currency || trim(to_char(b.price_pence/100.0,'FM999990.00')) || '</td></tr>'
    || '<tr><td style="padding:14px 18px;color:#918c86;font-size:12px;">REFERENCE</td>'
    || '<td style="padding:14px 18px;color:#f8f6f3;font-size:15px;text-align:right;letter-spacing:1px;">' || b.ref || '</td></tr>'
    || '</table>';

  if p_kind in ('confirmation','reminder','moved') then
    body := body || private.btn(manage_url, 'Change or cancel this booking')
      || '<p style="margin:0;color:#918c86;font-size:13px;line-height:1.6;">'
      || 'That link also shows your cut card — ' || c.stamps || ' of ' || s.stamps_required || ' stamps'
      || case when c.free_cuts > 0 then ', and you have a free cut waiting.' else '.' end
      || '</p>';
  end if;

  heading := case p_kind
    when 'confirmation' then 'See you ' || case when b.booking_date = public.today_local() then 'later' else 'soon' end || ', ' || split_part(coalesce(c.name,'there'),' ',1) || '.'
    when 'reminder'     then 'Tomorrow at ' || to_char(b.start_time,'HH24:MI') || '.'
    when 'cancelled'    then 'Booking cancelled.'
    when 'moved'        then 'Booking moved.'
    else 'Your booking' end;

  subj := case p_kind
    when 'confirmation' then s.shop_name || ' — booked for ' || private.pretty_dt(b.booking_date, b.start_time)
    when 'reminder'     then 'Reminder: ' || s.shop_name || ' tomorrow at ' || to_char(b.start_time,'HH24:MI')
    when 'cancelled'    then s.shop_name || ' — booking cancelled'
    when 'moved'        then s.shop_name || ' — booking moved to ' || private.pretty_dt(b.booking_date, b.start_time)
    else s.shop_name end;

  insert into public.mail_outbox (to_email, subject, html, kind, booking_id)
  values (c.email, subj, private.email_shell(heading, body), p_kind, p_booking)
  on conflict (booking_id, kind) where booking_id is not null do nothing;
end $$;

create or replace function private.queue_card_email(p_customer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.settings%rowtype; c public.customers%rowtype; body text; url text;
begin
  select * into s from public.settings where id = 1;
  select * into c from public.customers where id = p_customer;
  if not found then return; end if;
  url := rtrim(s.site_url,'/') || '/manage.html?t=' || c.token::text;

  body := '<p style="margin:0 0 6px;color:#c3beb8;font-size:15px;line-height:1.6;">'
    || 'Your cut card is live. Every cut you sit through gets stamped at the till — '
    || s.stamps_required || ' stamps and the next one is on us.</p>'
    || '<p style="margin:0 0 4px;color:#918c86;font-size:13px;">Card number</p>'
    || '<p style="margin:0 0 4px;color:#f8f6f3;font-size:20px;letter-spacing:3px;font-family:monospace;">' || c.card_number || '</p>'
    || '<p style="margin:0;color:#ff6b18;font-size:14px;">' || c.stamps || ' of ' || s.stamps_required || ' stamps'
    || case when c.free_cuts > 0 then ' — free cut waiting' else '' end || '</p>'
    || private.btn(url, 'Open my card')
    || '<p style="margin:0;color:#918c86;font-size:12px;line-height:1.6;">Keep this link — it is yours. '
    || 'It also lets you change or cancel a booking.</p>';

  insert into public.mail_outbox (to_email, subject, html, kind)
  values (c.email, s.shop_name || ' — your cut card', private.email_shell('Here is your card.', body), 'card');
end $$;

-- ---------------------------------------------------------------------
-- What the public website is allowed to read
-- ---------------------------------------------------------------------
create or replace function public.public_config()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'shop', (select json_build_object(
        'name', shop_name, 'strapline', strapline, 'address_1', address_1,
        'address_2', address_2, 'postcode', postcode, 'phone', phone, 'email', email,
        'instagram', instagram, 'blurb', blurb, 'getting_here', getting_here,
        'currency', currency, 'stamps_required', stamps_required,
        'horizon_days', horizon_days, 'cancel_hours', cancel_hours, 'tz', tz,
        'slot_mins', slot_mins, 'lead_mins', lead_mins)
      from public.settings where id = 1),
    'services', coalesce((select json_agg(json_build_object(
        'id', s.id, 'name', s.name, 'description', s.description,
        'price_pence', s.price_pence, 'mins', s.mins,
        'earns_stamp', s.earns_stamp, 'badge', s.badge,
        'barber_ids', coalesce((select json_agg(sb.barber_id)
                                from public.service_barbers sb
                                join public.barbers bb on bb.id = sb.barber_id and bb.active
                                where sb.service_id = s.id), '[]'::json))
        order by s.sort, s.name)
      from public.services s where s.active), '[]'::json),
    'barbers', coalesce((select json_agg(json_build_object(
        'id', id, 'name', name, 'role', role, 'bio', bio) order by sort, name)
      from public.barbers where active), '[]'::json),
    'hours', coalesce((select json_agg(json_build_object(
        'dow', dow, 'label', label, 'closed', closed,
        'opens', to_char(opens,'HH24:MI'), 'closes', to_char(closes,'HH24:MI')) order by dow)
      from public.opening_hours), '[]'::json),
    'today', public.today_local()
  );
$$;

-- ---------------------------------------------------------------------
-- Availability — returns free times only, never anyone's details
-- ---------------------------------------------------------------------
create or replace function public.availability(p_date date, p_service uuid, p_barber uuid default null)
returns table (slot_time text, barber_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  s public.settings%rowtype;
  svc public.services%rowtype;
  oh public.opening_hours%rowtype;
  open_m int; close_m int; dw int;
begin
  select * into s from public.settings where id = 1;
  select * into svc from public.services where id = p_service and active;
  if not found then return; end if;

  if p_date < public.today_local() or p_date > public.today_local() + s.horizon_days then return; end if;

  dw := extract(dow from p_date)::int;
  select * into oh from public.opening_hours where dow = dw;
  if not found or oh.closed then return; end if;

  open_m  := (extract(epoch from oh.opens)  / 60)::int;
  close_m := (extract(epoch from oh.closes) / 60)::int;
  if close_m - open_m < svc.mins then return; end if;

  return query
  select to_char(time '00:00' + make_interval(mins => g.m), 'HH24:MI'), pick.id
  from generate_series(open_m, close_m - svc.mins, s.slot_mins) as g(m)
  cross join lateral (
    select b.id
    from public.barbers b
    left join public.barber_hours bh on bh.barber_id = b.id and bh.dow = dw
    where b.active
      and (p_barber is null or b.id = p_barber)
      and coalesce(bh.works, true)
      -- if the service is limited to certain chairs, respect that
      and (not exists (select 1 from public.service_barbers sb where sb.service_id = p_service)
           or exists (select 1 from public.service_barbers sb
                      where sb.service_id = p_service and sb.barber_id = b.id))
      and (bh.opens  is null or (extract(epoch from bh.opens)/60)::int  <= g.m)
      and (bh.closes is null or (extract(epoch from bh.closes)/60)::int >= g.m + svc.mins)
      and not exists (
        select 1 from public.bookings bk
        where bk.barber_id = b.id and bk.status = 'booked'
          and bk.slot && tstzrange(public.slot_ts(p_date, g.m),
                                   public.slot_ts(p_date, g.m + svc.mins), '[)'))
      and not exists (
        select 1 from public.time_off t
        where (t.barber_id = b.id or t.barber_id is null)
          and tstzrange(t.starts_at, t.ends_at, '[)') &&
              tstzrange(public.slot_ts(p_date, g.m),
                        public.slot_ts(p_date, g.m + svc.mins), '[)'))
    order by (select count(*) from public.bookings b2
              where b2.barber_id = b.id and b2.booking_date = p_date and b2.status = 'booked'),
             b.sort, b.name
    limit 1
  ) as pick
  where public.slot_ts(p_date, g.m) >= now() + make_interval(mins => s.lead_mins)
  order by 1;
end $$;

-- ---------------------------------------------------------------------
-- The "next in the chair" panel on the home page. Returns every free
-- (day, time, barber) combination over the next few open days so the
-- page can show a spread of the team rather than the same name four times.
-- ---------------------------------------------------------------------
create or replace function public.next_openings(p_days int default 3)
returns table (slot_date date, slot_time text, barber_id uuid, barber_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  s public.settings%rowtype; svc public.services%rowtype;
  d date; opened int := 0; oh public.opening_hours%rowtype; dw int;
  open_m int; close_m int;
begin
  select * into s from public.settings where id = 1;
  select * into svc from public.services
   where active and price_pence > 0 order by sort, name limit 1;
  if not found then
    select * into svc from public.services where active order by sort, name limit 1;
  end if;
  if not found then return; end if;

  d := public.today_local();
  p_days := least(greatest(coalesce(p_days,3), 1), 14);

  while opened < p_days and d <= public.today_local() + s.horizon_days loop
    dw := extract(dow from d)::int;
    select * into oh from public.opening_hours where dow = dw;
    if found and not oh.closed then
      opened := opened + 1;
      open_m  := (extract(epoch from oh.opens)  / 60)::int;
      close_m := (extract(epoch from oh.closes) / 60)::int;

      return query
      select d,
             to_char(time '00:00' + make_interval(mins => g.m), 'HH24:MI'),
             b.id, b.name
      from generate_series(open_m, greatest(open_m, close_m - svc.mins), s.slot_mins) as g(m)
      join public.barbers b on b.active
      left join public.barber_hours bh on bh.barber_id = b.id and bh.dow = dw
      where close_m - open_m >= svc.mins
        and coalesce(bh.works, true)
        and (bh.opens  is null or (extract(epoch from bh.opens)/60)::int  <= g.m)
        and (bh.closes is null or (extract(epoch from bh.closes)/60)::int >= g.m + svc.mins)
        and (not exists (select 1 from public.service_barbers sb where sb.service_id = svc.id)
             or exists (select 1 from public.service_barbers sb
                        where sb.service_id = svc.id and sb.barber_id = b.id))
        and not exists (
          select 1 from public.bookings bk
          where bk.barber_id = b.id and bk.status = 'booked'
            and bk.slot && tstzrange(public.slot_ts(d, g.m), public.slot_ts(d, g.m + svc.mins), '[)'))
        and not exists (
          select 1 from public.time_off t
          where (t.barber_id = b.id or t.barber_id is null)
            and tstzrange(t.starts_at, t.ends_at, '[)') &&
                tstzrange(public.slot_ts(d, g.m), public.slot_ts(d, g.m + svc.mins), '[)'))
        and public.slot_ts(d, g.m) >= now() + make_interval(mins => s.lead_mins)
      order by 1, 2, b.sort, b.name;
    end if;
    d := d + 1;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Make a booking
-- ---------------------------------------------------------------------
create or replace function public.create_booking(
  p_service uuid, p_date date, p_time text,
  p_name text, p_email text, p_phone text,
  p_barber uuid default null, p_notes text default '',
  p_join boolean default true, p_hp text default ''
) returns json
language plpgsql security definer set search_path = public as $$
declare
  s public.settings%rowtype;
  svc public.services%rowtype;
  chosen uuid; cust public.customers%rowtype; b public.bookings%rowtype;
  email_l text; t time; recent int; open_cnt int; new_id uuid;
begin
  -- silent bot trap
  if coalesce(p_hp,'') <> '' then
    return json_build_object('ok', false, 'error', 'Something went wrong. Please try again.');
  end if;

  select * into s from public.settings where id = 1;

  p_name  := btrim(coalesce(p_name,''));
  p_phone := btrim(coalesce(p_phone,''));
  p_notes := left(btrim(coalesce(p_notes,'')), 500);
  email_l := lower(btrim(coalesce(p_email,'')));

  if length(p_name) < 2 or length(p_name) > 80 then
    return json_build_object('ok', false, 'error', 'Please give us your name.');
  end if;
  if email_l !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return json_build_object('ok', false, 'error', 'That email address does not look right.');
  end if;
  if length(regexp_replace(p_phone, '[^0-9]', '', 'g')) < 7 then
    return json_build_object('ok', false, 'error', 'Please give us a mobile number we can reach you on.');
  end if;

  select * into svc from public.services where id = p_service and active;
  if not found then
    return json_build_object('ok', false, 'error', 'That service is no longer on the list.');
  end if;

  begin t := p_time::time; exception when others then
    return json_build_object('ok', false, 'error', 'Pick a time from the list.');
  end;

  -- is that slot genuinely free right now?
  select a.barber_id into chosen
  from public.availability(p_date, p_service, p_barber) a
  where a.slot_time = to_char(t, 'HH24:MI')
  limit 1;

  if chosen is null then
    return json_build_object('ok', false, 'error', 'That slot has just gone. Pick another time.');
  end if;

  -- customer record
  select * into cust from public.customers where lower(email) = email_l;
  if not found then
    insert into public.customers (name, email, phone, card_number, marketing_opt_in, opted_in_at)
    values (p_name, btrim(p_email), p_phone, private.new_card_number(),
            coalesce(p_join,false), case when p_join then now() else null end)
    returning * into cust;
  else
    update public.customers
       set name  = case when coalesce(cust.name,'') = '' then p_name else cust.name end,
           phone = case when coalesce(cust.phone,'') = '' then p_phone else cust.phone end,
           marketing_opt_in = cust.marketing_opt_in or coalesce(p_join,false),
           opted_in_at = case when not cust.marketing_opt_in and coalesce(p_join,false)
                              then now() else cust.opted_in_at end
     where id = cust.id
    returning * into cust;
  end if;

  -- gentle rate limits
  select count(*) into recent from public.bookings
   where customer_id = cust.id and created_at > now() - interval '24 hours';
  if recent >= s.max_daily_per_email then
    return json_build_object('ok', false, 'error',
      'That is a lot of bookings in one day. Give the shop a ring and we will sort it.');
  end if;

  select count(*) into open_cnt from public.bookings
   where customer_id = cust.id and status = 'booked' and starts_at > now();
  if open_cnt >= s.max_open_per_email then
    return json_build_object('ok', false, 'error',
      'You already have ' || open_cnt || ' bookings with us. Cancel one first, or ring the shop.');
  end if;

  begin
    insert into public.bookings (ref, customer_id, barber_id, service_id, booking_date,
                                 start_time, mins, price_pence, notes)
    values (private.new_ref(), cust.id, chosen, svc.id, p_date, t, svc.mins, svc.price_pence, p_notes)
    returning * into b;
  exception when exclusion_violation then
    return json_build_object('ok', false, 'error', 'Someone took that slot a second before you. Pick another time.');
  end;

  perform private.queue_booking_email(b.id, 'confirmation');

  return json_build_object(
    'ok', true,
    'ref', b.ref,
    'date', b.booking_date,
    'time', to_char(b.start_time,'HH24:MI'),
    'mins', b.mins,
    'service', svc.name,
    'price_pence', b.price_pence,
    'barber', (select name from public.barbers where id = chosen),
    'token', cust.token,
    'stamps', cust.stamps,
    'free_cuts', cust.free_cuts,
    'card_number', cust.card_number,
    'stamps_required', s.stamps_required
  );
end $$;

-- ---------------------------------------------------------------------
-- The customer's own link:  /manage.html?t=<token>
-- ---------------------------------------------------------------------
create or replace function public.card_by_token(p_token uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare s public.settings%rowtype; c public.customers%rowtype;
begin
  select * into s from public.settings where id = 1;
  select * into c from public.customers where token = p_token;
  if not found then return json_build_object('ok', false, 'error', 'That link is not valid any more.'); end if;

  return json_build_object(
    'ok', true,
    'name', c.name, 'email', c.email, 'phone', c.phone,
    'card_number', c.card_number, 'stamps', c.stamps, 'free_cuts', c.free_cuts,
    'redeemed', c.redeemed, 'marketing_opt_in', c.marketing_opt_in,
    'stamps_required', s.stamps_required, 'cancel_hours', s.cancel_hours,
    'bookings', coalesce((
      select json_agg(json_build_object(
          'id', b.id, 'ref', b.ref, 'date', b.booking_date,
          'time', to_char(b.start_time,'HH24:MI'), 'mins', b.mins,
          'status', b.status, 'service', sv.name, 'service_id', sv.id,
          'price_pence', b.price_pence, 'barber', ba.name, 'barber_id', ba.id,
          'locked', (b.starts_at < now() + make_interval(hours => s.cancel_hours)))
        order by b.starts_at desc)
      from public.bookings b
      join public.services sv on sv.id = b.service_id
      join public.barbers  ba on ba.id = b.barber_id
      where b.customer_id = c.id and b.starts_at > now() - interval '90 days'), '[]'::json)
  );
end $$;

create or replace function public.cancel_booking(p_token uuid, p_booking uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s public.settings%rowtype; c public.customers%rowtype; b public.bookings%rowtype;
begin
  select * into s from public.settings where id = 1;
  select * into c from public.customers where token = p_token;
  if not found then return json_build_object('ok', false, 'error', 'That link is not valid any more.'); end if;

  select * into b from public.bookings where id = p_booking and customer_id = c.id;
  if not found then return json_build_object('ok', false, 'error', 'We cannot find that booking.'); end if;
  if b.status <> 'booked' then return json_build_object('ok', false, 'error', 'That booking is already closed.'); end if;
  if b.starts_at < now() + make_interval(hours => s.cancel_hours) then
    return json_build_object('ok', false, 'error',
      'It is too close to the appointment to cancel online. Give the shop a ring.');
  end if;

  update public.bookings set status = 'cancelled', updated_at = now() where id = b.id;
  perform private.queue_booking_email(b.id, 'cancelled');
  return json_build_object('ok', true);
end $$;

create or replace function public.reschedule_booking(
  p_token uuid, p_booking uuid, p_date date, p_time text)
returns json language plpgsql security definer set search_path = public as $$
declare
  s public.settings%rowtype; c public.customers%rowtype; b public.bookings%rowtype;
  chosen uuid; t time;
begin
  select * into s from public.settings where id = 1;
  select * into c from public.customers where token = p_token;
  if not found then return json_build_object('ok', false, 'error', 'That link is not valid any more.'); end if;

  select * into b from public.bookings where id = p_booking and customer_id = c.id;
  if not found then return json_build_object('ok', false, 'error', 'We cannot find that booking.'); end if;
  if b.status <> 'booked' then return json_build_object('ok', false, 'error', 'That booking is already closed.'); end if;
  if b.starts_at < now() + make_interval(hours => s.cancel_hours) then
    return json_build_object('ok', false, 'error',
      'It is too close to the appointment to move it online. Give the shop a ring.');
  end if;

  begin t := p_time::time; exception when others then
    return json_build_object('ok', false, 'error', 'Pick a time from the list.');
  end;

  select a.barber_id into chosen
  from public.availability(p_date, b.service_id, null) a
  where a.slot_time = to_char(t, 'HH24:MI') limit 1;
  if chosen is null then
    return json_build_object('ok', false, 'error', 'That slot has just gone. Pick another time.');
  end if;

  begin
    update public.bookings
       set booking_date = p_date, start_time = t, barber_id = chosen, updated_at = now()
     where id = b.id;
  exception when exclusion_violation then
    return json_build_object('ok', false, 'error', 'Someone took that slot a second before you. Pick another.');
  end;

  delete from public.mail_outbox where booking_id = b.id and kind in ('moved','reminder') and status = 'pending';
  perform private.queue_booking_email(b.id, 'moved');
  return json_build_object('ok', true);
end $$;

-- Join the card without booking. Always answers the same way, so the form
-- can never be used to find out who is or is not a customer.
create or replace function public.join_card(
  p_name text, p_email text, p_phone text default '', p_hp text default '')
returns json language plpgsql security definer set search_path = public as $$
declare email_l text; c public.customers%rowtype;
begin
  if coalesce(p_hp,'') <> '' then return json_build_object('ok', true); end if;
  email_l := lower(btrim(coalesce(p_email,'')));
  if email_l !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return json_build_object('ok', false, 'error', 'That email address does not look right.');
  end if;

  select * into c from public.customers where lower(email) = email_l;
  if not found then
    insert into public.customers (name, email, phone, card_number, marketing_opt_in, opted_in_at)
    values (left(btrim(coalesce(p_name,'')),80), btrim(p_email), left(btrim(coalesce(p_phone,'')),30),
            private.new_card_number(), true, now())
    returning * into c;
  else
    update public.customers
       set marketing_opt_in = true,
           opted_in_at = coalesce(c.opted_in_at, now()),
           name = case when coalesce(c.name,'') = '' then left(btrim(coalesce(p_name,'')),80) else c.name end
     where id = c.id returning * into c;
  end if;

  perform private.queue_card_email(c.id);
  return json_build_object('ok', true);
end $$;

-- "Send me my card" — same answer whether or not the address is on file
create or replace function public.request_card_link(p_email text)
returns json language plpgsql security definer set search_path = public as $$
declare c public.customers%rowtype; recent int;
begin
  select * into c from public.customers where lower(email) = lower(btrim(coalesce(p_email,'')));
  if found then
    select count(*) into recent from public.mail_outbox
     where to_email = c.email and kind = 'card' and created_at > now() - interval '10 minutes';
    if recent = 0 then perform private.queue_card_email(c.id); end if;
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.unsubscribe(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  update public.customers set marketing_opt_in = false where token = p_token;
  return json_build_object('ok', found);
end $$;

-- ---------------------------------------------------------------------
-- Staff-only actions
-- ---------------------------------------------------------------------
create or replace function public.complete_booking(p_booking uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  s public.settings%rowtype; b public.bookings%rowtype;
  c public.customers%rowtype; stamps_it boolean;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  select * into s from public.settings where id = 1;
  select * into b from public.bookings where id = p_booking;
  if not found then return json_build_object('ok', false, 'error', 'Booking not found.'); end if;
  if b.status = 'done' then return json_build_object('ok', true, 'already', true); end if;

  update public.bookings set status = 'done', updated_at = now() where id = b.id;

  -- a free cut, or a service marked as not earning one, does not stamp the card
  select sv.earns_stamp into stamps_it from public.services sv where sv.id = b.service_id;
  stamps_it := coalesce(stamps_it, true) and not b.free_cut and b.price_pence > 0;

  select * into c from public.customers where id = b.customer_id;
  if stamps_it then
    update public.customers set stamps = stamps + 1 where id = b.customer_id returning * into c;
    if c.stamps >= s.stamps_required then
      update public.customers
         set stamps = stamps - s.stamps_required, free_cuts = free_cuts + 1
       where id = c.id returning * into c;
    end if;
  end if;

  return json_build_object('ok', true, 'stamped', stamps_it,
                           'stamps', c.stamps, 'free_cuts', c.free_cuts,
                           'stamps_required', s.stamps_required);
end $$;

create or replace function public.set_booking_status(p_booking uuid, p_status text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  if p_status not in ('booked','cancelled','noshow') then
    return json_build_object('ok', false, 'error', 'Unknown status.');
  end if;
  update public.bookings set status = p_status::public.booking_status, updated_at = now()
   where id = p_booking;
  return json_build_object('ok', true);
end $$;

create or replace function public.adjust_stamps(p_customer uuid, p_delta int)
returns json language plpgsql security definer set search_path = public as $$
declare s public.settings%rowtype; c public.customers%rowtype;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  select * into s from public.settings where id = 1;
  update public.customers set stamps = greatest(0, stamps + p_delta)
   where id = p_customer returning * into c;
  if not found then return json_build_object('ok', false, 'error', 'Customer not found.'); end if;
  while c.stamps >= s.stamps_required loop
    update public.customers set stamps = stamps - s.stamps_required, free_cuts = free_cuts + 1
     where id = c.id returning * into c;
  end loop;
  return json_build_object('ok', true, 'stamps', c.stamps, 'free_cuts', c.free_cuts);
end $$;

create or replace function public.redeem_free_cut(p_customer uuid)
returns json language plpgsql security definer set search_path = public as $$
declare c public.customers%rowtype;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  update public.customers
     set free_cuts = free_cuts - 1, redeemed = redeemed + 1
   where id = p_customer and free_cuts > 0 returning * into c;
  if not found then return json_build_object('ok', false, 'error', 'No free cut on that card.'); end if;
  return json_build_object('ok', true, 'free_cuts', c.free_cuts, 'redeemed', c.redeemed);
end $$;

-- Walk-ins and phone bookings, entered by the shop. Skips the "book at
-- least an hour ahead" rule and the anti-spam limits, but the database
-- still refuses to put two people in one chair.
create or replace function public.staff_create_booking(
  p_service uuid, p_barber uuid, p_date date, p_time text,
  p_name text, p_email text default '', p_phone text default '',
  p_notes text default '', p_free boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  svc public.services%rowtype; cust public.customers%rowtype;
  b public.bookings%rowtype; t time; email_l text; n int;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;

  select * into svc from public.services where id = p_service;
  if not found then return json_build_object('ok', false, 'error', 'Unknown service.'); end if;
  if p_barber is null or not exists (select 1 from public.barbers where id = p_barber) then
    return json_build_object('ok', false, 'error', 'Pick a barber.');
  end if;

  begin t := p_time::time; exception when others then
    return json_build_object('ok', false, 'error', 'That is not a valid time.');
  end;

  email_l := lower(btrim(coalesce(p_email,'')));
  if email_l = '' then
    -- walk-in with no email: park them under a placeholder so the diary still works
    email_l := 'walkin+' || replace(gen_random_uuid()::text,'-','') || '@no-email.local';
    insert into public.customers (name, email, phone, card_number, marketing_opt_in)
    values (coalesce(nullif(btrim(p_name),''),'Walk-in'), email_l, btrim(coalesce(p_phone,'')),
            private.new_card_number(), false)
    returning * into cust;
  else
    select * into cust from public.customers where lower(email) = email_l;
    if not found then
      insert into public.customers (name, email, phone, card_number, marketing_opt_in)
      values (coalesce(nullif(btrim(p_name),''),'Customer'), btrim(p_email),
              btrim(coalesce(p_phone,'')), private.new_card_number(), false)
      returning * into cust;
    end if;
  end if;

  begin
    insert into public.bookings (ref, customer_id, barber_id, service_id, booking_date,
                                 start_time, mins, price_pence, notes, free_cut)
    values (private.new_ref(), cust.id, p_barber, svc.id, p_date, t, svc.mins,
            case when p_free then 0 else svc.price_pence end,
            left(btrim(coalesce(p_notes,'')),500), coalesce(p_free,false))
    returning * into b;
  exception when exclusion_violation then
    return json_build_object('ok', false, 'error', 'That barber already has someone in the chair then.');
  end;

  if cust.email not like '%@no-email.local' then
    perform private.queue_booking_email(b.id, 'confirmation');
  end if;

  return json_build_object('ok', true, 'ref', b.ref, 'id', b.id);
end $$;

create or replace function public.staff_send_card(p_customer uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  perform private.queue_card_email(p_customer);
  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Grants: exactly which functions the anonymous website may call
-- ---------------------------------------------------------------------
revoke all on function public.availability(date, uuid, uuid) from public;
revoke all on function public.create_booking(uuid, date, text, text, text, text, uuid, text, boolean, text) from public;

grant execute on function public.public_config()                       to anon, authenticated;
grant execute on function public.availability(date, uuid, uuid)        to anon, authenticated;
grant execute on function public.next_openings(int)                    to anon, authenticated;
grant execute on function public.create_booking(uuid, date, text, text, text, text, uuid, text, boolean, text) to anon, authenticated;
grant execute on function public.card_by_token(uuid)                   to anon, authenticated;
grant execute on function public.cancel_booking(uuid, uuid)            to anon, authenticated;
grant execute on function public.reschedule_booking(uuid, uuid, date, text) to anon, authenticated;
grant execute on function public.join_card(text, text, text, text)     to anon, authenticated;
grant execute on function public.request_card_link(text)               to anon, authenticated;
grant execute on function public.unsubscribe(uuid)                     to anon, authenticated;

grant execute on function public.complete_booking(uuid)                to authenticated;
grant execute on function public.set_booking_status(uuid, text)        to authenticated;
grant execute on function public.adjust_stamps(uuid, int)              to authenticated;
grant execute on function public.redeem_free_cut(uuid)                 to authenticated;
grant execute on function public.staff_send_card(uuid)                 to authenticated;
grant execute on function public.staff_create_booking(uuid, uuid, date, text, text, text, text, text, boolean) to authenticated;
