// Delicious Library Shared — homage to Delicious Library (Delicious Monster, 2005)
// Zero-dependency hostable web app: Node 22+ only (built-in node:sqlite).
// Run: node server.js  (then open http://localhost:3000)
'use strict';
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'library.db');
let db;
try {
  db = new DatabaseSync(DB_FILE);
} catch (e) {
  console.error('Could not open database ' + DB_FILE + ': ' + e.message);
  console.error('Node 22.5+ required (node --version). Run with a writable directory.');
  process.exit(1);
}

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL,
  passhash BLOB NOT NULL, salt BLOB NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS items(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
  title TEXT NOT NULL, creator TEXT DEFAULT '', kind TEXT DEFAULT 'book',
  year TEXT DEFAULT '', rating INTEGER DEFAULT 0, shelf TEXT DEFAULT '',
  notes TEXT DEFAULT '', pub INTEGER DEFAULT 1, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id);
CREATE INDEX IF NOT EXISTS idx_items_pub ON items(pub);`);

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const parseBody = req => new Promise((ok, bad) => {
  let s = ''; req.on('data', c => { s += c; if (s.length > 1e6) req.destroy(); });
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { bad(); } });
  req.on('error', bad);
});
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';')
  .map(c => c.trim().split('=')).filter(a => a.length === 2)
  .map(([k, v]) => [k, decodeURIComponent(v)]));
const me = req => {
  const t = cookies(req).sid; if (!t) return null;
  const s = db.prepare('SELECT user_id FROM sessions WHERE token=?').get(t);
  if (!s) return null;
  return db.prepare('SELECT id,name FROM users WHERE id=?').get(s.user_id) || null;
};
const KIND = v => ['book', 'movie', 'music', 'game'].includes(v) ? v : 'book';

function serve(pub, res) {
  let f = path.join(__dirname, 'public', pub === '/' ? 'index.html' : pub.slice(1));
  if (!f.startsWith(path.join(__dirname, 'public'))) return json(res, 403, { error: 'no' });
  fs.readFile(f, (e, d) => {
    if (e) return json(res, 404, { error: 'not found' });
    const t = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': t }); res.end(d);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    // ---- auth ----
    if (req.method === 'POST' && u.pathname === '/api/register') {
      const { name, pass } = await parseBody(req);
      if (!name || !/^[A-Za-z0-9_.-]{2,24}$/.test(name)) return json(res, 400, { error: 'name: 2-24 chars, letters/numbers/._-' });
      if (!pass || pass.length < 4) return json(res, 400, { error: 'password min 4 chars' });
      if (db.prepare('SELECT id FROM users WHERE name=?').get(name)) return json(res, 409, { error: 'name taken' });
      const salt = crypto.randomBytes(16), hash = crypto.scryptSync(pass, salt, 64);
      const r = db.prepare('INSERT INTO users(name,passhash,salt,created) VALUES(?,?,?,?)')
        .run(name, hash, salt, Date.now());
      const tok = crypto.randomBytes(24).toString('hex');
      db.prepare('INSERT INTO sessions(token,user_id,created) VALUES(?,?,?)').run(tok, Number(r.lastInsertRowid), Date.now());
      res.writeHead(200, { 'Set-Cookie': `sid=${tok}; HttpOnly; Path=/; SameSite=Lax`, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: 1, name }));
    }
    if (req.method === 'POST' && u.pathname === '/api/login') {
      const { name, pass } = await parseBody(req);
      const row = db.prepare('SELECT * FROM users WHERE name=?').get(name || '');
      if (!row || !crypto.timingSafeEqual(crypto.scryptSync(pass || '', row.salt, 64), row.passhash))
        return json(res, 401, { error: 'bad login' });
      const tok = crypto.randomBytes(24).toString('hex');
      db.prepare('INSERT INTO sessions(token,user_id,created) VALUES(?,?,?)').run(tok, row.id, Date.now());
      res.writeHead(200, { 'Set-Cookie': `sid=${tok}; HttpOnly; Path=/; SameSite=Lax`, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: 1, name: row.name }));
    }
    if (req.method === 'POST' && u.pathname === '/api/logout') {
      const t = cookies(req).sid;
      if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(t);
      res.writeHead(200, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0', 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: 1 }));
    }
    if (req.method === 'GET' && u.pathname === '/api/me')
      return json(res, 200, { user: me(req) });
    // ---- own library ----
    if (u.pathname === '/api/items' && req.method === 'GET') {
      const user = me(req); if (!user) return json(res, 401, { error: 'login first' });
      const q = (u.searchParams.get('q') || '').trim(), kind = u.searchParams.get('kind') || '';
      let sql = 'SELECT * FROM items WHERE user_id=?', args = [user.id];
      if (KIND(kind) && u.searchParams.get('kind')) { sql += ' AND kind=?'; args.push(kind); }
      if (q) { sql += ' AND (title LIKE ? OR creator LIKE ? OR shelf LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
      return json(res, 200, { items: db.prepare(sql + ' ORDER BY created DESC').all(...args) });
    }
    if (u.pathname === '/api/items' && req.method === 'POST') {
      const user = me(req); if (!user) return json(res, 401, { error: 'login first' });
      const b = await parseBody(req);
      if (!b.title || !String(b.title).trim()) return json(res, 400, { error: 'title required' });
      const r = db.prepare(`INSERT INTO items(user_id,title,creator,kind,year,rating,shelf,notes,pub,created)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(user.id, String(b.title).slice(0, 200),
        String(b.creator || '').slice(0, 200), KIND(b.kind), String(b.year || '').slice(0, 8),
        Math.max(0, Math.min(5, +b.rating || 0)), String(b.shelf || '').slice(0, 60),
        String(b.notes || '').slice(0, 2000), b.pub === 0 ? 0 : 1, Date.now());
      return json(res, 200, { ok: 1, id: Number(r.lastInsertRowid) });
    }
    const m = u.pathname.match(/^\/api\/items\/(\d+)$/);
    if (m) {
      const user = me(req); if (!user) return json(res, 401, { error: 'login first' });
      const id = +m[1];
      const own = db.prepare('SELECT * FROM items WHERE id=? AND user_id=?').get(id, user.id);
      if (!own) return json(res, 404, { error: 'not found' });
      if (req.method === 'PUT') {
        const b = await parseBody(req);
        db.prepare(`UPDATE items SET title=?,creator=?,kind=?,year=?,rating=?,shelf=?,notes=?,pub=? WHERE id=?`)
          .run(String(b.title || own.title).slice(0, 200), String(b.creator ?? own.creator).slice(0, 200),
            KIND(b.kind || own.kind), String(b.year ?? own.year).slice(0, 8),
            Math.max(0, Math.min(5, +b.rating || 0)), String(b.shelf ?? own.shelf).slice(0, 60),
            String(b.notes ?? own.notes).slice(0, 2000), b.pub === 0 ? 0 : 1, id);
        return json(res, 200, { ok: 1 });
      }
      if (req.method === 'DELETE') {
        db.prepare('DELETE FROM items WHERE id=?').run(id);
        return json(res, 200, { ok: 1 });
      }
    }
    // ---- discover / public ----
    if (req.method === 'GET' && u.pathname === '/api/discover') {
      const q = (u.searchParams.get('q') || '').trim(), kind = u.searchParams.get('kind') || '';
      let sql = `SELECT items.*, users.name AS owner FROM items JOIN users ON users.id=items.user_id WHERE pub=1`, args = [];
      if (kind) { sql += ' AND kind=?'; args.push(KIND(kind)); }
      if (q) { sql += ' AND (title LIKE ? OR creator LIKE ? OR users.name LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
      return json(res, 200, { items: db.prepare(sql + ' ORDER BY items.created DESC LIMIT 200').all(...args) });
    }
    if (req.method === 'GET' && u.pathname.startsWith('/api/u/')) {
      const name = decodeURIComponent(u.pathname.slice(7));
      const owner = db.prepare('SELECT id,name FROM users WHERE name=?').get(name);
      if (!owner) return json(res, 404, { error: 'no such shelf' });
      const viewer = me(req);
      const items = db.prepare('SELECT * FROM items WHERE user_id=? AND (pub=1 OR ?=user_id) ORDER BY created DESC')
        .all(owner.id, viewer ? viewer.id : -1);
      return json(res, 200, { owner: owner.name, mine: !!viewer && viewer.id === owner.id, items });
    }
    // DEBUG ONLY bypass — remove before any public hosting
    if (req.method === 'POST' && u.pathname === '/api/debug-bypass') {
      let row = db.prepare('SELECT * FROM users WHERE name=?').get('debug');
      if (!row) {
        const salt = crypto.randomBytes(16), hash = crypto.scryptSync('debug', salt, 64);
        const r = db.prepare('INSERT INTO users(name,passhash,salt,created) VALUES(?,?,?,?)')
          .run('debug', hash, salt, Date.now());
        row = { id: Number(r.lastInsertRowid), name: 'debug' };
      }
      const tok = crypto.randomBytes(24).toString('hex');
      db.prepare('INSERT INTO sessions(token,user_id,created) VALUES(?,?,?)').run(tok, row.id, Date.now());
      res.writeHead(200, { 'Set-Cookie': `sid=${tok}; HttpOnly; Path=/; SameSite=Lax`, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: 1, name: 'debug' }));
    }
    if (req.method === 'GET') return serve(u.pathname, res);
    return json(res, 404, { error: 'nope' });
  } catch (e) { console.error('API error:', e); return json(res, 500, { error: 'server error: ' + (e && e.message ? e.message : e) }); }
});

server.listen(PORT, () => console.log(`Delicious Library Shared on http://localhost:${PORT}`));
