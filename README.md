# Mitch's Barbershop — booking site

Plain HTML, CSS and JavaScript on the front. Supabase (Postgres) on the back.
No build step, no framework, no npm install. Edit a file, push, done.

```
public/                what gets served
  index.html           the shop: services, team, booking, cut card signup
  manage.html          the customer's own page (from the link in their email)
  staff.html           the diary — real login, not a PIN
  privacy.html         GDPR privacy notice
  terms.html           booking terms
  robots.txt
  assets/
    config.js          >>> the only file you must edit <<<
    api.js             talks to Supabase (plain fetch, no libraries)
    site.js            public site
    manage.js          customer page
    staff.js           staff diary
    brand.css          all the styling
    logo.png           Mitch's logo, transparent
supabase/
  01_schema.sql        tables + security rules
  02_functions.sql     everything the website is allowed to do
  03_email.sql         sending emails + scheduled jobs
  04_seed.sql          the real price list, team and hours
vercel.json            hosting config + security headers
tests/                 local test suite (not deployed)
```

---

## Setting it up

About 30 minutes, start to finish. Do the steps in order.

### 1. Create the database

1. Go to **supabase.com**, sign up, click **New project**.
2. Name it `mitchs-barbershop`. Pick region **West EU (London)** — closest to Ramsgate,
   and it keeps the data in the UK/EU.
3. Set a database password and save it somewhere. You will rarely need it.
4. Wait about two minutes for it to finish building.

Then open **SQL Editor** in the left sidebar and run these four files, **in this order**,
by pasting each one in and pressing Run:

1. `supabase/01_schema.sql`
2. `supabase/02_functions.sql`
3. `supabase/03_email.sql`
4. `supabase/04_seed.sql`

Each should say "Success". If one errors, stop and fix it before the next — they build on each other.

### 2. Point the website at it

In Supabase go to **Project Settings → API** and copy two things:

- **Project URL** (looks like `https://abcdefgh.supabase.co`)
- **anon public** key (a long string)

Open `public/assets/config.js` and paste them in:

```js
window.CONFIG = {
  SUPABASE_URL: "https://abcdefgh.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi..."
};
```

Both are meant to be public — they are in every visitor's browser. The anon key can only do
what the security rules allow: read the price list, read the team, read the hours, check what
is free, and make a booking. **Never** put the `service_role` key in this file. That one bypasses
everything.

### 3. Turn on emails

1. Go to **resend.com**, sign up (free tier is 3,000 emails a month — plenty).
2. Create an **API key** and copy it.
3. In the Supabase SQL Editor, run this one line with your key pasted in:

```sql
insert into private.secrets (key, value)
values ('resend_api_key', 're_your_real_key_here')
on conflict (key) do update set value = excluded.value;
```

Until you verify a domain, Resend only lets you send from `onboarding@resend.dev`, which is
fine for testing. Once the domain is live (step 6), add it in Resend, add the DNS records it
gives you, then set the from address in the staff diary under **Settings → Card & diary rules**
to something like `bookings@mitchsbarbershop.co.uk`.

### 4. Turn on the scheduler

Emails go out through a queue that a scheduled job drains every minute.

1. Supabase → **Database → Extensions** → search `pg_cron` → enable it.
2. Go back to the SQL Editor and run `supabase/03_email.sql` **again**.
   This time it will say "Scheduled jobs created."

Four jobs get set up: send the queue (every minute), check for bounces (every 5 minutes),
queue tomorrow's reminders (5pm UTC daily), tidy old records (weekly).

### 5. Create the staff login

1. Supabase → **Authentication → Users → Add user**.
2. Email: Mitch's real email. Password: something decent. Tick **Auto Confirm User**.
3. Then in the SQL Editor:

```sql
insert into public.admins (user_id, name)
select id, 'Mitch' from auth.users where email = 'mitch@his-real-email.com';
```

Repeat for anyone else who should see the diary. Somebody who is not in the `admins` table
can log in and still see nothing — the database refuses them, not the page.

### 6. Put it online

**Easiest way:**

1. Push this folder to a GitHub repo.
2. Go to **vercel.com**, sign in with GitHub, **Add New → Project**, pick the repo.
3. Framework preset: **Other**. Leave everything else alone — `vercel.json` handles it.
4. Deploy.

You get a free URL like `mitchs-barbershop.vercel.app`. That is a real, live, working site.

**Adding a real domain later:** buy the domain, go to Vercel → your project → Settings → Domains,
add it, and copy the two DNS records Vercel gives you into the registrar. Takes ten minutes and
nothing else changes.

### 7. The one setting people forget

Open `https://your-site/staff.html`, sign in, go to **Settings → Card & diary rules**, and set
**Website address** to the real URL (no trailing slash). Every link in every email is built from
that, so if it is wrong the "change or cancel" links go nowhere.

While you are in Settings, fill in the phone number, email and opening hours — the hours in
`04_seed.sql` are a sensible guess, not Mitch's actual hours. Check them with him.

---

## Checking it works

Do this before handing it over:

1. Open the site, book yourself in for tomorrow with a real email address.
2. The confirmation email should land within a minute. If it does not, run
   `select * from mail_outbox order by id desc limit 5;` in the SQL editor — the `error`
   column will tell you why.
3. Click the link in the email. Move the booking. Cancel it.
4. Sign into `staff.html`, add a walk-in, mark it done, check the stamp landed on the card.
5. Try to open `staff.html` in a private window without logging in. You should get the login screen
   and nothing else.

---

## For Mitch — running it day to day

Everything happens at **your-site/staff.html**. Bookmark it on the phone.

**Diary tab** — today's bookings in time order.
- **Done** when they get out of the chair. That is what stamps their cut card.
- **No show** if they never turned up. **Cancel** frees the slot for someone else.
- **+ Add booking** for walk-ins and anyone who rings up. Ignores the hour's-notice rule.
- **Block out time** for lunch, training, holidays. The website stops offering those slots straight away.

**Members tab** — everyone on the cut card.
- **+ Stamp** if someone paid but was not booked in.
- **Redeem** when they claim a free cut.
- **Export mailing list** gives you a CSV of everyone who ticked the box. Only email those people.

**Settings tab** — prices, services, the team, opening hours, how many cuts earn a free one.
Change anything and the website updates immediately. No developer needed.

---

## What it costs to run

| Service   | Plan | Cost |
|-----------|------|------|
| Supabase  | Free tier | £0 |
| Resend    | Free tier, 3,000 emails/month | £0 |
| Vercel    | Hobby | £0 |
| Domain    | .co.uk | about £10–12 a year |

A four-chair shop will not get near any of the free limits. If it ever does, Supabase Pro is
$25/month and Resend's next tier is $20/month.

---

## How the security actually works

Worth understanding, because it is the whole reason this exists rather than a single HTML file.

- **Customer details are never in the page.** Names, emails and phone numbers live in the database
  behind row-level security. The website's public key has no read access to the `customers` or
  `bookings` tables at all — not "hidden", *refused*.
- **The booking form cannot read the diary.** It calls one function, `create_booking`, which
  validates everything server-side and returns only that person's own booking back.
- **Double-booking is impossible, not unlikely.** There is a Postgres exclusion constraint on
  (barber, time range). Two people clicking the same slot in the same second: one gets it, the
  other gets "that slot has just gone". The database enforces it, not the JavaScript.
- **Staff use real accounts** with hashed passwords and expiring sessions. There is no PIN in the
  source code.
- **Customers reach their own booking through a secret token** in their email link. There is no
  "look up by email address" anywhere, so nobody can fish for someone else's details.
- **Anti-spam:** a hidden honeypot field, a cap of 3 open bookings and 5 bookings a day per email
  address, and server-side validation of everything.

## Where it still needs a human

- **No SMS.** Email reminders only. Adding Twilio is about an hour's work if Mitch wants texts.
- **No deposits.** Nothing is charged online. Stripe can be added later.
- **Reminders go at 5pm UTC** — 6pm British Summer Time, 5pm in winter. Change the cron line in
  `03_email.sql` if that is not right.
- **Bounced emails** show as a red banner in the diary. Check the `mail_outbox` table if one appears.

---

## Testing (for whoever maintains this)

Needs Postgres and Node locally.

```bash
tests/all.sh
```

Rebuilds a throwaway database, runs ~60 SQL checks (booking, double-booking, stamps, free cuts,
cancellation, rate limits, privacy), then drives the real pages in a headless browser against it —
public site, customer page and staff diary — and fails if anything errors.

`tests/devserver.js` is a local stand-in for Supabase so the pages can be tested without touching
the live project. None of `tests/` is deployed.
