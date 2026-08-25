/* Local-only stand-in for Supabase: serves /public and answers the
   /rest/v1/rpc/* calls by running the real SQL functions. Not shipped. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..', 'public');
const PORT = 8811;

const db = new Client({ connectionString: 'postgres://postgres:devpass@127.0.0.1:5432/mitchs' });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json'
};

function body(req) {
  return new Promise(res => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch (e) { res({}); } });
  });
}

async function rpc(fn, args) {
  const keys = Object.keys(args);
  const params = keys.map((k, i) => `${k} := $${i + 1}`).join(', ');
  const vals = keys.map(k => args[k]);
  const sql = `select * from public.${fn}(${params})`;
  const r = await db.query(sql, vals);
  if (r.fields.length === 1 && r.fields[0].name === fn) {
    return r.rows.length ? r.rows[0][fn] : null;
  }
  return r.rows;
}

/* --- crude PostgREST stand-in for the staff pages --------------------- */
const OPS = { eq: '=', gte: '>=', lte: '<=', gt: '>', lt: '<', neq: '<>' };

const EMBEDS = {
  bookings: {
    customers: { fk: 'customer_id', table: 'customers' },
    barbers:   { fk: 'barber_id',   table: 'barbers' },
    services:  { fk: 'service_id',  table: 'services' }
  }
};

function whereFrom(u) {
  const parts = [], vals = [];
  for (const [k, v] of u.searchParams) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const m = /^([a-z]+)\.(.*)$/s.exec(v);
    if (!m || !OPS[m[1]]) continue;
    vals.push(m[2]);
    parts.push(`"${k}" ${OPS[m[1]]} $${vals.length}`);
  }
  return { sql: parts.length ? ' where ' + parts.join(' and ') : '', vals };
}

async function restGet(table, u) {
  const w = whereFrom(u);
  const order = u.searchParams.get('order');
  const limit = u.searchParams.get('limit');
  const sql = `select * from public.${table}${w.sql}`
    + (order ? ' order by ' + order.split(',').map(c => '"' + c.trim().split('.')[0] + '"').join(',') : '')
    + (limit ? ' limit ' + parseInt(limit, 10) : '');
  const rows = (await db.query(sql, w.vals)).rows;

  const sel = u.searchParams.get('select') || '';
  const emb = EMBEDS[table] || {};
  for (const name of Object.keys(emb)) {
    if (sel.indexOf(name + '(') === -1) continue;
    const { fk, table: rel } = emb[name];
    const ids = Array.from(new Set(rows.map(r => r[fk]).filter(Boolean)));
    if (!ids.length) { rows.forEach(r => r[name] = null); continue; }
    const rel_rows = (await db.query(`select * from public.${rel} where id = any($1)`, [ids])).rows;
    const byId = {}; rel_rows.forEach(x => byId[x.id] = x);
    rows.forEach(r => r[name] = byId[r[fk]] || null);
  }
  return rows;
}

async function restWrite(method, table, u, payload) {
  if (method === 'POST') {
    const rows = Array.isArray(payload) ? payload : [payload];
    const out = [];
    for (const row of rows) {
      const keys = Object.keys(row);
      const sql = `insert into public.${table} (${keys.map(k => '"' + k + '"').join(',')})`
        + ` values (${keys.map((_, i) => '$' + (i + 1)).join(',')}) returning *`;
      out.push((await db.query(sql, keys.map(k => row[k]))).rows[0]);
    }
    return out;
  }
  const w = whereFrom(u);
  if (method === 'DELETE') {
    return (await db.query(`delete from public.${table}${w.sql} returning *`, w.vals)).rows;
  }
  const keys = Object.keys(payload);
  const sets = keys.map((k, i) => `"${k}" = $${w.vals.length + i + 1}`).join(',');
  const sql = `update public.${table} set ${sets}${w.sql} returning *`;
  return (await db.query(sql, w.vals.concat(keys.map(k => payload[k])))).rows;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const auth = String(req.headers.authorization || '');
  const staff = auth.indexOf('devtoken') !== -1;

  if (u.pathname.startsWith('/auth/v1/token')) {
    const b = await body(req);
    const r = await db.query('select id from auth.users where email = $1', [b.email || '']);
    if (!r.rows.length || b.password !== 'devpass') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Invalid login credentials' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      access_token: 'devtoken', refresh_token: 'devrefresh', expires_in: 3600,
      user: { id: r.rows[0].id, email: b.email }
    }));
  }
  if (u.pathname.startsWith('/auth/v1/logout')) { res.writeHead(204); return res.end(); }
  if (u.pathname.startsWith('/auth/v1/user')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ id: 'x' }));
  }

  // pretend to be the signed-in admin so is_admin() passes
  await db.query("select set_config('test.uid', $1, false)",
    [staff ? (await db.query('select user_id from public.admins limit 1')).rows[0].user_id : '']);

  if (u.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = u.pathname.split('/').pop();
    try {
      const out = await rpc(fn, await body(req));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(out));
    } catch (e) {
      console.error('RPC FAIL', fn, '->', e.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: e.message }));
    }
  }

  if (u.pathname.startsWith('/rest/v1/')) {
    const table = u.pathname.replace('/rest/v1/', '').split('?')[0];
    if (!staff) { res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' })); }
    try {
      const out = req.method === 'GET'
        ? await restGet(table, u)
        : await restWrite(req.method, table, u, await body(req));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(out));
    } catch (e) {
      console.error('REST FAIL', req.method, req.url, '->', e.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: e.message }));
    }
  }

  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  // serve the local config instead of the real one, so the shipped file stays untouched
  if (p === '/assets/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] });
    return res.end(fs.readFileSync(path.join(__dirname, 'config.dev.js')));
  }
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

db.connect().then(() => server.listen(PORT, () => console.log('dev server on ' + PORT)));
