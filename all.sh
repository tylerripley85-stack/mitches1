#!/bin/bash
# Full check: rebuild a throwaway database, run the SQL suite, then drive
# the real pages in a browser against it. Local only.
set -u
cd "$(dirname "$0")/.."

echo "=== rebuilding test database ==="
pkill -f "[d]evserver" 2>/dev/null; sleep 1
su postgres -c "dropdb --if-exists mitchs; createdb mitchs" || exit 1
sed -e '/create extension if not exists pg_net/d' supabase/01_schema.sql > /tmp/01.sql
cp supabase/02_functions.sql /tmp/02.sql
cp supabase/03_email.sql     /tmp/03.sql
cp supabase/04_seed.sql      /tmp/04.sql
cp tests/00_stub.sql         /tmp/00.sql
cp tests/10_flow.sql         /tmp/10.sql
chmod 644 /tmp/*.sql
for f in 00 01 02 03 04; do
  su postgres -c "psql -v ON_ERROR_STOP=1 -q -d mitchs -f /tmp/$f.sql" >/tmp/setup.$f 2>&1 \
    || { echo "SETUP FAILED at $f"; grep -i error /tmp/setup.$f | head; exit 1; }
done

echo
echo "=== SQL suite ==="
su postgres -c "psql -q -d mitchs -f /tmp/10.sql" > /tmp/flow.out 2>&1
sed 's/^psql:[^ ]* //' /tmp/flow.out | grep -Ev '^NOTICE:  PASS|^$' | head -20
echo "checks passed: $(grep -c 'PASS' /tmp/flow.out)   failed: $(grep -c 'FAIL' /tmp/flow.out)"

echo
echo "=== rebuilding clean for the browser run ==="
su postgres -c "dropdb --if-exists mitchs; createdb mitchs" || exit 1
for f in 00 01 02 03 04; do su postgres -c "psql -q -d mitchs -f /tmp/$f.sql" >/dev/null 2>&1; done
su postgres -c "psql -q -d mitchs -c \"insert into auth.users (email) values ('mitch@example.com')\"" >/dev/null 2>&1
su postgres -c "psql -q -d mitchs -c \"insert into public.admins (user_id, name) select id,'Mitch' from auth.users where email='mitch@example.com'\"" >/dev/null 2>&1

(setsid node tests/devserver.js >/tmp/dev.log 2>&1 &)
sleep 4

echo
echo "=== public site + customer page ==="
node tests/browser.js
SITE=$?

echo
echo "=== staff diary ==="
node tests/staff-browser.js
STAFF=$?

pkill -f "[d]evserver" 2>/dev/null
echo
echo "site exit=$SITE  staff exit=$STAFF"
