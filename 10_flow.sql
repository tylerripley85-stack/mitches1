-- Functional tests. Local only.
\set ON_ERROR_STOP on
\pset pager off

create or replace function pg_temp.ck(label text, cond boolean) returns void
language plpgsql as $$
begin
  if cond then raise notice 'PASS  %', label;
  else raise exception 'FAIL  %', label; end if;
end $$;

do $$
declare
  cfg json; n int; d date; t text; res json; res2 json;
  svc_haircut uuid; svc_free uuid; svc_brow uuid;
  mitch uuid; ronnie uuid;
  tok uuid; bk uuid; cust uuid; admin_id uuid;
  i int;
begin
  select id into svc_haircut from services where name = 'Haircut';
  select id into svc_free    from services where name = 'Apprentice cut — free';
  select id into svc_brow    from services where name = 'Eyebrow Threading';
  select id into mitch  from barbers where name = 'Mitch';
  select id into ronnie from barbers where name = 'Ronnie';

  -- 1. config
  cfg := public_config();
  perform pg_temp.ck('config lists 11 services', json_array_length(cfg->'services') = 11);
  perform pg_temp.ck('config lists 4 barbers',    json_array_length(cfg->'barbers')  = 4);
  perform pg_temp.ck('config hides customer data', (cfg->>'customers') is null);

  -- next open Thursday, comfortably in the future
  d := today_local();
  while extract(dow from d) <> 4 or d <= today_local() loop d := d + 1; end loop;

  -- 2. availability
  select count(*) into n from availability(d, svc_haircut, null);
  perform pg_temp.ck('haircut has slots on an open day', n > 20);

  select count(*) into n from availability(d, svc_haircut, null)
   where slot_time = '09:00';
  perform pg_temp.ck('first slot is at opening time', n = 1);

  -- shop is shut Mondays
  select count(*) into n from availability(d + 4, svc_haircut, null);
  perform pg_temp.ck('no slots on a closed day', n = 0);

  -- 3. free cut is apprentices only
  select count(*) into n from availability(d, svc_free, mitch);
  perform pg_temp.ck('Mitch does not do the free cut', n = 0);
  select count(*) into n from availability(d, svc_free, ronnie);
  perform pg_temp.ck('Ronnie does the free cut', n > 0);

  -- 4. book it
  res := create_booking(svc_haircut, d, '10:00', 'Danny Cole',
                        'danny@example.com', '07700900123', null, 'Number one back and sides.', true, '');
  perform pg_temp.ck('booking accepted', (res->>'ok')::boolean);
  perform pg_temp.ck('booking has a reference', (res->>'ref') like 'MB-%');
  tok := (res->>'token')::uuid;

  -- 5. that exact chair+time is gone for that barber
  select count(*) into n from availability(d, svc_haircut, (
    select barber_id from bookings b join customers c on c.id = b.customer_id
     where c.email = 'danny@example.com' limit 1))
   where slot_time = '10:00';
  perform pg_temp.ck('slot no longer offered for that barber', n = 0);

  -- 6. overlapping service also blocked for that barber (30 min cut from 09:45)
  select count(*) into n from availability(d, svc_haircut, (
    select barber_id from bookings b join customers c on c.id = b.customer_id
     where c.email = 'danny@example.com' limit 1))
   where slot_time = '09:45';
  perform pg_temp.ck('overlapping start blocked too', n = 0);

  -- 7. the database itself refuses a double booking
  begin
    insert into bookings (ref, customer_id, barber_id, service_id, booking_date, start_time, mins)
    select 'MB-ZZ9999', b.customer_id, b.barber_id, b.service_id, b.booking_date, b.start_time, b.mins
      from bookings b join customers c on c.id = b.customer_id
     where c.email = 'danny@example.com' limit 1;
    raise exception 'FAIL  exclusion constraint did not fire';
  exception when exclusion_violation then
    raise notice 'PASS  database blocks a double booking';
  end;

  -- 8. honeypot
  res := create_booking(svc_haircut, d, '11:00', 'Bot', 'bot@example.com', '07700900999', null, '', true, 'gotcha');
  perform pg_temp.ck('honeypot rejected', not (res->>'ok')::boolean);

  -- 9. bad input
  res := create_booking(svc_haircut, d, '11:00', 'X', 'nope', '1', null, '', true, '');
  perform pg_temp.ck('short name rejected', not (res->>'ok')::boolean);
  res := create_booking(svc_haircut, d, '11:00', 'Real Name', 'not-an-email', '07700900111', null, '', true, '');
  perform pg_temp.ck('bad email rejected', (res->>'error') like '%email%');
  res := create_booking(svc_haircut, d, '11:00', 'Real Name', 'ok@example.com', '12', null, '', true, '');
  perform pg_temp.ck('bad phone rejected', (res->>'error') like '%mobile%');

  -- 10. taken slot
  res := create_booking(svc_haircut, d, '99:99', 'Real Name', 'ok@example.com', '07700900111', null, '', true, '');
  perform pg_temp.ck('nonsense time rejected', not (res->>'ok')::boolean);

  -- 11. customer's own link
  res := card_by_token(tok);
  perform pg_temp.ck('token opens the card', (res->>'ok')::boolean);
  perform pg_temp.ck('card shows one booking', json_array_length(res->'bookings') = 1);
  perform pg_temp.ck('card shows the card number', length(res->>'card_number') > 8);
  res := card_by_token(gen_random_uuid());
  perform pg_temp.ck('a made-up token gets nothing', not (res->>'ok')::boolean);

  -- 12. confirmation email queued
  select count(*) into n from mail_outbox where kind = 'confirmation';
  perform pg_temp.ck('confirmation email queued', n = 1);
  select count(*) into n from mail_outbox where kind = 'card';
  perform pg_temp.ck('no duplicate card email on booking', n = 0);

  -- 13. staff actions need a staff login
  select b.id into bk from bookings b join customers c on c.id = b.customer_id
   where c.email = 'danny@example.com' limit 1;
  begin
    perform complete_booking(bk);
    raise exception 'FAIL  complete_booking ran without a login';
  exception when others then
    if sqlerrm like '%not authorised%' then raise notice 'PASS  staff action blocked for the public';
    else raise; end if;
  end;

  -- become staff
  insert into auth.users (email) values ('mitch@example.com') returning id into admin_id;
  insert into admins (user_id, name) values (admin_id, 'Mitch');
  perform set_config('test.uid', admin_id::text, true);
  perform pg_temp.ck('is_admin true once listed', is_admin());

  res := complete_booking(bk);
  perform pg_temp.ck('cut logged', (res->>'ok')::boolean);
  perform pg_temp.ck('card stamped', (res->>'stamps')::int = 1);
  perform pg_temp.ck('stamp recorded as earned', (res->>'stamped')::boolean);

  -- 14. free cut does not stamp
  res := create_booking(svc_free, d, '14:00', 'Sam Free', 'sam@example.com', '07700900222', ronnie, '', true, '');
  perform pg_temp.ck('free apprentice cut booked', (res->>'ok')::boolean);
  perform pg_temp.ck('free cut costs nothing', (res->>'price_pence')::int = 0);
  select b.id into bk from bookings b join customers c on c.id = b.customer_id where c.email = 'sam@example.com';
  res := complete_booking(bk);
  perform pg_temp.ck('free cut earns no stamp', not (res->>'stamped')::boolean);
  perform pg_temp.ck('free cut leaves card at zero', (res->>'stamps')::int = 0);

  -- 15. eight stamps unlocks a free cut
  select id into cust from customers where email = 'danny@example.com';
  res := adjust_stamps(cust, 7);
  perform pg_temp.ck('eighth stamp unlocks a free cut', (res->>'free_cuts')::int = 1);
  perform pg_temp.ck('card resets to zero', (res->>'stamps')::int = 0);
  res := redeem_free_cut(cust);
  perform pg_temp.ck('free cut redeemed', (res->>'free_cuts')::int = 0 and (res->>'redeemed')::int = 1);
  res := redeem_free_cut(cust);
  perform pg_temp.ck('cannot redeem twice', not (res->>'ok')::boolean);

  -- 16. cancel and reschedule
  perform set_config('test.uid', '', true);
  res := create_booking(svc_brow, d, '15:00', 'Jo Kent', 'jo@example.com', '07700900333', mitch, '', false, '');
  tok := (res->>'token')::uuid;
  select b.id into bk from bookings b join customers c on c.id = b.customer_id where c.email = 'jo@example.com';

  res := reschedule_booking(tok, bk, d, '15:30');
  perform pg_temp.ck('booking moved', (res->>'ok')::boolean);
  select count(*) into n from bookings where id = bk and start_time = '15:30';
  perform pg_temp.ck('new time saved', n = 1);
  select count(*) into n from mail_outbox where booking_id = bk and kind = 'moved';
  perform pg_temp.ck('move email queued', n = 1);

  res := cancel_booking(gen_random_uuid(), bk);
  perform pg_temp.ck('someone else cannot cancel it', not (res->>'ok')::boolean);

  res := cancel_booking(tok, bk);
  perform pg_temp.ck('customer cancelled their own booking', (res->>'ok')::boolean);
  select count(*) into n from availability(d, svc_brow, mitch) where slot_time = '15:30';
  perform pg_temp.ck('cancelled slot back in the diary', n = 1);
  res := cancel_booking(tok, bk);
  perform pg_temp.ck('cannot cancel twice', not (res->>'ok')::boolean);

  -- 17. rate limit on open bookings
  res := create_booking(svc_brow, d, '16:00', 'Spam Man', 'spam@example.com', '07700900444', mitch, '', false, '');
  perform pg_temp.ck('first of three booked', (res->>'ok')::boolean);
  res := create_booking(svc_brow, d, '16:15', 'Spam Man', 'spam@example.com', '07700900444', mitch, '', false, '');
  perform pg_temp.ck('second of three booked', (res->>'ok')::boolean);
  res := create_booking(svc_brow, d, '16:30', 'Spam Man', 'spam@example.com', '07700900444', mitch, '', false, '');
  perform pg_temp.ck('third of three booked', (res->>'ok')::boolean);
  res := create_booking(svc_brow, d, '16:45', 'Spam Man', 'spam@example.com', '07700900444', mitch, '', false, '');
  perform pg_temp.ck('fourth open booking refused', not (res->>'ok')::boolean);

  -- 18. card link request never reveals whether an address is on file
  res  := request_card_link('danny@example.com');
  res2 := request_card_link('nobody@nowhere.example');
  perform pg_temp.ck('card link answers the same either way',
                     (res->>'ok') = (res2->>'ok') and (res->>'ok')::boolean);
  select count(*) into n from mail_outbox where kind = 'card' and to_email = 'nobody@nowhere.example';
  perform pg_temp.ck('no email sent to an unknown address', n = 0);

  -- 19. joining the card
  res := join_card('New Guy', 'newguy@example.com', '07700900555', '');
  perform pg_temp.ck('joined the card', (res->>'ok')::boolean);
  select count(*) into n from mail_outbox where kind = 'card' and to_email = 'newguy@example.com';
  perform pg_temp.ck('card email queued', n = 1);
  select count(*) into n from customers where email = 'newguy@example.com' and marketing_opt_in;
  perform pg_temp.ck('marketing consent recorded', n = 1);

  -- 20. unsubscribe
  select token into tok from customers where email = 'newguy@example.com';
  perform unsubscribe(tok);
  select count(*) into n from customers where email = 'newguy@example.com' and marketing_opt_in;
  perform pg_temp.ck('unsubscribe works', n = 0);

  -- 21. reminders
  update bookings set booking_date = today_local() + 1
   where id = (select b.id from bookings b join customers c on c.id = b.customer_id
                where c.email = 'spam@example.com' limit 1);
  n := private.queue_reminders();
  perform pg_temp.ck('reminder queued for tomorrow', n >= 1);
  i := private.queue_reminders();
  perform pg_temp.ck('reminder not queued twice', i = 0);

  -- 22. mail dispatch
  update private.secrets set value = 're_test_key' where key = 'resend_api_key';
  n := private.dispatch_mail(50);
  perform pg_temp.ck('mail dispatched', n > 0);
  select count(*) into n from net.sent where url like '%resend%';
  perform pg_temp.ck('posted to Resend', n > 0);
  select count(*) into n from mail_outbox where status = 'pending';
  perform pg_temp.ck('outbox drained', n = 0);

  raise notice '--- all checks passed ---';
end $$;

-- 23. RLS: the anonymous website cannot read people's details
set role anon;
do $$
declare n int;
begin
  begin
    select count(*) into n from public.customers;
    if n > 0 then raise exception 'FAIL  anon could read % customers', n; end if;
    raise notice 'PASS  anon sees no customers';
  exception when insufficient_privilege then
    raise notice 'PASS  anon blocked from customers table';
  end;
  begin
    select count(*) into n from public.bookings;
    if n > 0 then raise exception 'FAIL  anon could read % bookings', n; end if;
    raise notice 'PASS  anon sees no bookings';
  exception when insufficient_privilege then
    raise notice 'PASS  anon blocked from bookings table';
  end;
  begin
    select count(*) into n from private.secrets;
    raise exception 'FAIL  anon could read the secrets table';
  exception when insufficient_privilege then
    raise notice 'PASS  anon blocked from secrets';
  end;
  select count(*) into n from public.services;
  if n < 1 then raise exception 'FAIL  anon cannot read the price list'; end if;
  raise notice 'PASS  anon can read the price list';
end $$;
reset role;
