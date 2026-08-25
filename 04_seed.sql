-- =====================================================================
--  MITCH'S BARBERSHOP — starting data
--  Run AFTER 03_email.sql. Safe to run more than once: it will not
--  overwrite anything Mitch has already changed in the staff diary.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Shop details
-- ---------------------------------------------------------------------
update public.settings set
  shop_name    = 'Mitch''s',
  strapline    = 'Barbershop',
  address_1    = '18 Grange Road',
  address_2    = 'Ramsgate, Thanet',
  postcode     = 'CT11 9LR',
  blurb        = 'A young shop on Grange Road doing sharp, modern work — fades, scissor cuts and beards — without the wait or the fuss.',
  getting_here = 'We are on Grange Road in Ramsgate. Add parking and bus details here from the staff diary.',
  tz           = 'Europe/London',
  updated_at   = now()
where id = 1;

-- ---------------------------------------------------------------------
-- Opening hours  ——  CHECK THESE. They are a sensible guess, not gospel.
-- Mitch can change them himself under Settings in the staff diary.
-- ---------------------------------------------------------------------
insert into public.opening_hours (dow, label, closed, opens, closes) values
  (0, 'Sunday',    true,  '10:00', '16:00'),
  (1, 'Monday',    true,  '09:00', '18:00'),
  (2, 'Tuesday',   false, '09:00', '18:00'),
  (3, 'Wednesday', false, '09:00', '18:00'),
  (4, 'Thursday',  false, '09:00', '19:00'),
  (5, 'Friday',    false, '09:00', '19:00'),
  (6, 'Saturday',  false, '08:30', '17:00')
on conflict (dow) do nothing;

-- ---------------------------------------------------------------------
-- The team
-- ---------------------------------------------------------------------
insert into public.barbers (name, role, bio, sort) values
  ('Mitch',    'Owner · Master barber', 'Runs the shop and trains the team. Fades, scissor work and beards.', 1),
  ('Ronnie',   'Apprentice barber',     'Learning the trade under Mitch. Free cuts while he trains.',        2),
  ('Owen',     'Apprentice barber',     'Learning the trade under Mitch. Free cuts while he trains.',        3),
  ('Lawrence', 'Apprentice barber',     'Learning the trade under Mitch. Free cuts while he trains.',        4)
on conflict (lower(name)) do nothing;

-- ---------------------------------------------------------------------
-- The price list  (taken from the shop's current booking system)
-- ---------------------------------------------------------------------
insert into public.services (name, description, price_pence, mins, sort, earns_stamp, badge) values
  ('Haircut',                'Clippers and scissors, washed and styled the way you want it.',        1900, 30,  1, true,  ''),
  ('Skin Fade',              'Taken down to the skin, blended clean, finished sharp.',               2000, 30,  2, true,  ''),
  ('Skin Fade & Beard Trim', 'The full sit down. Fade and beard, start to finish.',                  3000, 30,  3, true,  ''),
  ('Haircut & Beard Trim',   'Cut and beard sorted in one go.',                                      2900, 30,  4, true,  ''),
  ('Re-style',               'Going for something different. We will talk it through first.',        2200, 30,  5, true,  ''),
  ('Beard Trim',             'Shaped, edged with the trimmer, hot towel to finish.',                 1000, 30,  6, true,  ''),
  ('One grade all over',     'Single guard through the lot, neckline tidied.',                       1400, 20,  7, true,  ''),
  ('0 Grade all over',       'Straight down to a zero. In and out.',                                 1000, 15,  8, true,  ''),
  ('Kids cut 12 and under',  'For the young ones. Quick, calm, no fuss.',                            1400, 30,  9, true,  ''),
  ('Eyebrow Threading',      'Tidied and shaped. Ten minutes.',                                       500, 10, 10, true,  ''),
  ('Apprentice cut — free',  'Ronnie, Owen and Lawrence are training, so this one is on the house. Same cuts, same shop, no charge.',
                                                                                                        0, 30, 11, false, 'FREE')
on conflict (lower(name)) do nothing;

-- ---------------------------------------------------------------------
-- Free cuts are apprentices only — Mitch's chair stays paid
-- ---------------------------------------------------------------------
insert into public.service_barbers (service_id, barber_id)
select s.id, b.id
from public.services s
join public.barbers  b on b.name in ('Ronnie','Owen','Lawrence')
where s.name = 'Apprentice cut — free'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Sanity check — run this on its own afterwards if you want to see it
-- ---------------------------------------------------------------------
-- select name, price_pence/100.0 as price, mins, earns_stamp from services order by sort;
-- select * from public_config();
