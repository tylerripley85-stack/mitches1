#!/bin/bash
# Rebuild a throwaway database and run every check.
set -u
cd "$(dirname "$0")/.."
su postgres -c "dropdb --if-exists mitchs; createdb mitchs" || exit 1
sed -e '/create extension if not exists pg_net/d' supabase/01_schema.sql > /tmp/01.sql
cp supabase/02_functions.sql /tmp/02.sql
cp supabase/03_email.sql     /tmp/03.sql
cp supabase/04_seed.sql      /tmp/04.sql
cp tests/00_stub.sql         /tmp/00.sql
cp tests/10_flow.sql         /tmp/10.sql
chmod 644 /tmp/*.sql
for f in 00 01 02 03 04; do
  su postgres -c "psql -v ON_ERROR_STOP=1 -q -d mitchs -f /tmp/$f.sql" >/tmp/out.$f 2>&1 \
    || { echo "SETUP FAILED at $f"; grep -i error /tmp/out.$f | head; exit 1; }
done
su postgres -c "psql -q -d mitchs -f /tmp/10.sql" 2>&1 | sed 's/^psql:[^ ]* //' | grep -v '^$'
