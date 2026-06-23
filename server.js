require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── PostgreSQL Pool ───────────────────────────────────────────────────────────
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'test123',
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'lerntheke'
});

// ── Schema ────────────────────────────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           SERIAL PRIMARY KEY,
      username     TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      klasse       TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'student',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS progress (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, key)
    );
    CREATE TABLE IF NOT EXISTS session (
      sid    TEXT PRIMARY KEY,
      sess   JSON NOT NULL,
      expire TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS korrektur (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      gruppe     TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'ausstehend',
      notiz      TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      admin_id   INTEGER REFERENCES users(id),
      UNIQUE(user_id, gruppe)
    );
    CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id);
    CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);
    CREATE INDEX IF NOT EXISTS idx_korrektur_user ON korrektur(user_id);
  `);

  // Seed admin accounts (only if they don't exist)
  const admins = [
    { username: 'admin_m1m2', klasse: 'M1M2' },
    { username: 'admin_m3m4', klasse: 'M3M4' },
    { username: 'admin_m5m6', klasse: 'M5M6' },
    { username: 'admin_m7m8', klasse: 'M7M8' },
  ];
  for (const a of admins) {
    const hash = await bcrypt.hash('admin123', 10);
    await pool.query(`
      INSERT INTO users (username, password_hash, klasse, role)
      VALUES ($1, $2, $3, 'admin')
      ON CONFLICT (username) DO NOTHING
    `, [a.username, hash, a.klasse]);
  }
  console.log('✓ Datenbank bereit');

  // Auto-sync stations from JSON files into HTML on every startup
  await syncAllStations();
}

async function syncAllStations() {
  const dir = path.join(__dirname, 'public', 'lerntheken', 'stations');
  if (!fs.existsSync(dir)) return;
  for (const lernthekeId of fs.readdirSync(dir)) {
    const data = readStationsDir(lernthekeId);
    if (!data) continue;
    const htmlPath = path.join(__dirname, 'public', 'lerntheken', `${lernthekeId}.html`);
    if (!fs.existsSync(htmlPath)) continue;
    try {
      const maxId = data.stations.reduce((m, s) => Math.max(m, s.id), -1);
      const meta    = Array(maxId + 1).fill(null);
      const content = Array(maxId + 1).fill(null);
      data.stations.forEach(s => {
        const { task_html, sol_html, ...m } = s;
        meta[s.id]    = m;
        content[s.id] = { task_html: task_html || '', sol_html: sol_html || '', hilfen: s.hilfen || [] };
      });
      const groups = JSON.parse(JSON.stringify(data.groups));
      Object.keys(groups).forEach(g => {
        groups[g].total = data.stations.filter(s => s.group === g).length;
      });
      let html = fs.readFileSync(htmlPath, 'utf8');
      html = replaceJsConstant(html, 'TOTAL',   String(data.stations.length));
      html = replaceJsConstant(html, 'GROUPS',  JSON.stringify(groups));
      html = replaceJsConstant(html, 'META',    JSON.stringify(meta));
      html = replaceJsConstant(html, 'CONTENT', JSON.stringify(content));
      if (data.hilfen && data.hilfen.length)
        html = replaceJsConstant(html, 'HILFEN', JSON.stringify(data.hilfen));
      fs.writeFileSync(htmlPath, html, 'utf8');

      // Orphan cleanup
      const ltKey = extractJSValue(html, 'KEY');
      if (ltKey) {
        const existingIds = new Set(data.stations.map(s => s.id));
        const users = await pool.query(`SELECT user_id, value FROM progress WHERE key=$1`, [ltKey]);
        for (const row of users.rows) {
          try {
            const arr = JSON.parse(row.value);
            if (!Array.isArray(arr)) continue;
            const filtered = arr.filter(id => existingIds.has(Number(id)));
            if (filtered.length !== arr.length)
              await pool.query(`UPDATE progress SET value=$1, updated_at=NOW() WHERE user_id=$2 AND key=$3`,
                [JSON.stringify(filtered), row.user_id, ltKey]);
          } catch {}
        }
        const inputs = await pool.query(`SELECT user_id, key FROM progress WHERE key LIKE 'lerntheke_inputs_%'`);
        for (const row of inputs.rows) {
          const stId = parseInt(row.key.replace('lerntheke_inputs_', ''), 10);
          if (!isNaN(stId) && !existingIds.has(stId))
            await pool.query(`DELETE FROM progress WHERE user_id=$1 AND key=$2`, [row.user_id, row.key]);
        }
      }
      delete ltMetaCache[lernthekeId];
      console.log(`✓ Sync: ${lernthekeId} (${data.stations.length} Stationen)`);
    } catch(e) { console.warn(`⚠ Sync fehlgeschlagen für ${lernthekeId}: ${e.message}`); }
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(session({
  store: new pgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'bitte-aendern-' + Math.random(),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'strict' }
}));

// ── Auth helpers ──────────────────────────────────────────────────────────────
const requireLogin = (req, res, next) =>
  req.session.userId ? next() : res.status(401).json({ error: 'Nicht angemeldet' });

const requireAdmin = (req, res, next) =>
  req.session.role === 'admin' ? next() : res.status(403).json({ error: 'Kein Zugriff' });

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const r = await pool.query('SELECT * FROM users WHERE username=$1', [(username||'').trim().toLowerCase()]);
    const user = r.rows[0];
    if (!user || !await bcrypt.compare(password||'', user.password_hash))
      return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
    Object.assign(req.session, {
      userId: user.id, username: user.username,
      klasse: user.klasse, role: user.role
    });
    res.json({ ok: true, username: user.username, klasse: user.klasse, role: user.role });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  res.json({
    loggedIn: true, userId: req.session.userId,
    username: req.session.username, klasse: req.session.klasse, role: req.session.role
  });
});

app.post('/api/change-password', requireLogin, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'Passwort mind. 6 Zeichen' });
    const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.session.userId]);
    const user = r.rows[0];
    if (!await bcrypt.compare(oldPassword||'', user.password_hash))
      return res.status(401).json({ error: 'Altes Passwort falsch' });
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',
      [await bcrypt.hash(newPassword, 10), req.session.userId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Progress ──────────────────────────────────────────────────────────────────
app.get('/api/progress', requireLogin, async (req, res) => {
  try {
    const r = await pool.query('SELECT key, value FROM progress WHERE user_id=$1', [req.session.userId]);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    res.json(out);
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/progress', requireLogin, async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'key fehlt' });
    await pool.query(`
      INSERT INTO progress (user_id, key, value, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, key) DO UPDATE
      SET value=$3, updated_at=NOW()
    `, [req.session.userId, key, String(value)]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Stations (JSON-file-based) ────────────────────────────────────────────────
const STATIONS_DIR = path.join(__dirname, 'public', 'lerntheken', 'stations');

function readStationsDir(lernthekeId) {
  const dir = path.join(STATIONS_DIR, lernthekeId);
  if (!fs.existsSync(dir)) return null;
  const config = safeJSON(fs.readFileSync(path.join(dir, '_config.json'), 'utf8'));
  const stations = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && f !== '_config.json')
    .map(f => safeJSON(fs.readFileSync(path.join(dir, f), 'utf8')))
    .filter(Boolean)
    .sort((a, b) => a.id - b.id);
  return { ...config, stations };
}

function replaceJsConstant(html, varName, newValue) {
  // Support const, let, and var declarations
  let marker = '', idx = -1;
  for (const kw of ['const', 'let', 'var']) {
    const m = `${kw} ${varName}=`;
    const i = html.indexOf(m);
    if (i !== -1 && (idx === -1 || i < idx)) { idx = i; marker = m; }
  }
  if (idx === -1) return html;
  const after = html.slice(idx + marker.length);
  const opener = after[0];
  if (opener !== '[' && opener !== '{') {
    // number / bool – replace until ;
    const end = after.search(/[;\s]/);
    return html.slice(0, idx + marker.length) + newValue + after.slice(end);
  }
  const closer = opener === '[' ? ']' : '}';
  let depth = 0, inStr = false, strChar = '', esc = false, end = 0;
  for (let i = 0; i < after.length; i++) {
    const c = after[i];
    if (esc) { esc = false; continue; }
    if (inStr) { if (c === '\\') { esc = true; continue; } if (c === strChar) inStr = false; }
    else { if (c === '"' || c === "'") { inStr = true; strChar = c; } else if (c === opener) depth++; else if (c === closer) { depth--; if (depth === 0) { end = i; break; } } }
  }
  return html.slice(0, idx + marker.length) + newValue + after.slice(end + 1);
}

// GET /api/stations/:lerntheke – serve station data from JSON files
app.get('/api/stations/:lerntheke', requireLogin, (req, res) => {
  const data = readStationsDir(req.params.lerntheke);
  if (!data) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(data);
});

// POST /api/admin/sync-stations/:lerntheke – write JSON files back into HTML
app.post('/api/admin/sync-stations/:lerntheke', requireAdmin, async (req, res) => {
  try {
    const id = req.params.lerntheke;
    const data = readStationsDir(id);
    if (!data) return res.status(404).json({ error: 'Stations-Ordner nicht gefunden' });

    const htmlPath = path.join(__dirname, 'public', 'lerntheken', `${id}.html`);
    if (!fs.existsSync(htmlPath)) return res.status(404).json({ error: 'HTML-Datei nicht gefunden' });

    // Build dense arrays indexed by station id
    const maxId = data.stations.reduce((m, s) => Math.max(m, s.id), -1);
    const meta    = Array(maxId + 1).fill(null);
    const content = Array(maxId + 1).fill(null);
    data.stations.forEach(s => {
      const { task_html, sol_html, ...m } = s;
      meta[s.id]    = m;
      content[s.id] = { task_html: task_html || '', sol_html: sol_html || '', hilfen: s.hilfen || [] };
    });
    // Keep sparse array (nulls for deleted IDs) so META[id] addressing stays correct
    const metaClean    = meta;
    const contentClean = content;

    // Update GROUPS totals from actual station counts
    const groups = JSON.parse(JSON.stringify(data.groups));
    Object.keys(groups).forEach(g => {
      groups[g].total = data.stations.filter(s => s.group === g).length;
    });

    let html = fs.readFileSync(htmlPath, 'utf8');
    html = replaceJsConstant(html, 'TOTAL',   String(metaClean.length));
    html = replaceJsConstant(html, 'GROUPS',  JSON.stringify(groups));
    html = replaceJsConstant(html, 'META',    JSON.stringify(metaClean));
    html = replaceJsConstant(html, 'CONTENT', JSON.stringify(contentClean));
    if (data.hilfen && data.hilfen.length) {
      html = replaceJsConstant(html, 'HILFEN', JSON.stringify(data.hilfen));
    }

    fs.writeFileSync(htmlPath, html, 'utf8');
    delete ltMetaCache[id]; // invalidate metadata cache

    // ── Orphan cleanup: remove progress for deleted station IDs ──────────────
    const existingIds = new Set(data.stations.map(s => s.id));
    // Read KEY dynamically from the (just-updated) HTML file
    const freshHtml = fs.readFileSync(htmlPath, 'utf8');
    const ltKey = extractJSValue(freshHtml, 'KEY');

    // Get all users who have progress for this lerntheke
    const users = await pool.query(
      `SELECT user_id, value FROM progress WHERE key = $1`, [ltKey]
    );
    let cleaned = 0;
    for (const row of users.rows) {
      try {
        const doneArr = JSON.parse(row.value);
        if (!Array.isArray(doneArr)) continue;
        const filtered = doneArr.filter(stId => existingIds.has(Number(stId)));
        if (filtered.length !== doneArr.length) {
          await pool.query(
            `UPDATE progress SET value=$1, updated_at=NOW() WHERE user_id=$2 AND key=$3`,
            [JSON.stringify(filtered), row.user_id, ltKey]
          );
          cleaned++;
        }
      } catch {}
    }

    // Delete orphaned input entries (lerntheke_inputs_{stationId})
    const inputPattern = `lerntheke_inputs_%`;
    const inputRows = await pool.query(
      `SELECT user_id, key FROM progress WHERE key LIKE $1`, [inputPattern]
    );
    for (const row of inputRows.rows) {
      const stId = parseInt(row.key.replace('lerntheke_inputs_', ''), 10);
      if (!isNaN(stId) && !existingIds.has(stId)) {
        await pool.query(`DELETE FROM progress WHERE user_id=$1 AND key=$2`, [row.user_id, row.key]);
      }
    }

    res.json({ ok: true, stations: data.stations.length, progressCleaned: cleaned });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Lerntheken list ───────────────────────────────────────────────────────────
app.get('/api/lerntheken', requireLogin, (req, res) => {
  const dir = path.join(__dirname, 'public', 'lerntheken');
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.html'))
      .map(f => ({
        id: f.replace('.html', ''),
        title: f.replace('.html', '').replace(/-/g, ' ').replace(/_/g, ' '),
        url: '/lerntheken/' + f
      }));
    res.json(files);
  } catch { res.json([]); }
});

// ── Lerntheken metadata (KEY, GROUPS, station→group map, totals) ──────────────
function extractJSValue(html, varName) {
  // Support const, let, and var declarations
  let idx = -1;
  let marker = '';
  for (const kw of ['const', 'let', 'var']) {
    const m = `${kw} ${varName}=`;
    const i = html.indexOf(m);
    if (i !== -1 && (idx === -1 || i < idx)) { idx = i; marker = m; }
  }
  if (idx === -1) return null;
  const start = idx + marker.length;
  const opener = html[start];

  // Quoted string
  if (opener === '"' || opener === "'") {
    let i = start + 1;
    while (i < html.length && html[i] !== opener) {
      if (html[i] === '\\') i++;
      i++;
    }
    return html.slice(start + 1, i);
  }

  // Array or object – bracket matching
  if (opener === '[' || opener === '{') {
    const closer = opener === '[' ? ']' : '}';
    let depth = 0, inStr = false, strChar = '', escaped = false, end = start;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (escaped) { escaped = false; continue; }
      if (inStr) {
        if (c === '\\') { escaped = true; continue; }
        if (c === strChar) inStr = false;
      } else {
        if (c === '"' || c === "'") { inStr = true; strChar = c; }
        else if (c === opener) depth++;
        else if (c === closer) { depth--; if (depth === 0) { end = i; break; } }
      }
    }
    try { return JSON.parse(html.slice(start, end + 1)); } catch { return null; }
  }

  // Number / boolean – read until ; or whitespace
  let end = start;
  while (end < html.length && !/[;\s]/.test(html[end])) end++;
  const raw = html.slice(start, end);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  return isNaN(n) ? null : n;
}

const ltMetaCache = {}; // cleared on server restart

function getLerntheckenMeta() {
  const dir = path.join(__dirname, 'public', 'lerntheken');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
  return files.map(f => {
    const id = f.replace('.html', '');
    if (ltMetaCache[id]) return ltMetaCache[id];
    try {
      const html = fs.readFileSync(path.join(dir, f), 'utf8');
      const key       = extractJSValue(html, 'KEY');
      const abgabeKey = extractJSValue(html, 'ABGABE_KEY');
      const total     = extractJSValue(html, 'TOTAL');
      const groups    = extractJSValue(html, 'GROUPS');
      const meta      = extractJSValue(html, 'META');
      // strip task/sol HTML from meta to keep response small
      const stations  = (meta || []).map(s => ({ id: s.id, group: s.group, title: s.title }));
      const rawTitle  = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || id;
      const title     = rawTitle.replace(/\s*·.*$/, '').trim(); // strip " · Jahrgangsstufe X"
      const result = { id, title, url: `/lerntheken/${f}`, key, abgabeKey, total, groups, stations };
      ltMetaCache[id] = result;
      return result;
    } catch { return null; }
  }).filter(Boolean);
}

app.get('/api/lerntheken-meta', requireLogin, (req, res) => {
  try { res.json(getLerntheckenMeta()); }
  catch(e) { res.status(500).json({ error: 'Fehler beim Lesen der Metadaten' }); }
});

// ── Admin: students ───────────────────────────────────────────────────────────
app.get('/api/admin/students', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        u.id, u.username, u.klasse, u.created_at,
        (SELECT json_object_agg(key, value)
         FROM progress WHERE user_id=u.id) AS all_progress,
        (SELECT json_build_object('key', key, 'updated_at', updated_at)
         FROM progress WHERE user_id=u.id
           AND key NOT LIKE 'lerntheke_inputs_%'
           AND key NOT LIKE '%_abgabe_%'
         ORDER BY updated_at DESC LIMIT 1) AS last_active_info,
        (SELECT json_object_agg(gruppe, json_build_object('status',status,'notiz',notiz))
         FROM korrektur WHERE user_id=u.id) AS korrektur
      FROM users u
      WHERE u.role='student' AND u.klasse=$1
      ORDER BY u.username
    `, [req.session.klasse]);
    res.json(r.rows.map(row => ({
      ...row,
      all_progress: safeJSON(row.all_progress)
    })));
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const k = req.session.klasse;
    const total  = (await pool.query('SELECT COUNT(*) n FROM users WHERE role=$1 AND klasse=$2', ['student', k])).rows[0].n;
    const active = (await pool.query(`
      SELECT COUNT(DISTINCT u.id) n FROM users u
      JOIN progress p ON p.user_id=u.id
      WHERE u.role='student' AND u.klasse=$1
        AND p.updated_at > NOW() - INTERVAL '7 days'
    `, [k])).rows[0].n;
    res.json({ klasse: k, total: parseInt(total), active: parseInt(active) });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/admin/create-student', requireAdmin, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Fehlende Angaben' });
    if (password.length < 4) return res.status(400).json({ error: 'Passwort mind. 4 Zeichen' });
    await pool.query(
      'INSERT INTO users (username,password_hash,klasse,role) VALUES ($1,$2,$3,$4)',
      [username.trim().toLowerCase(), await bcrypt.hash(password, 10), req.session.klasse, 'student']
    );
    res.json({ ok: true });
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Benutzername bereits vergeben' });
    res.status(500).json({ error: 'Serverfehler' });
  }
});

app.post('/api/admin/bulk-create', requireAdmin, async (req, res) => {
  try {
    const { students } = req.body;
    if (!Array.isArray(students)) return res.status(400).json({ error: 'Array erforderlich' });
    let created = 0, skipped = 0;
    for (const s of students) {
      if (!s.username || !s.password) { skipped++; continue; }
      try {
        await pool.query(
          'INSERT INTO users (username,password_hash,klasse,role) VALUES ($1,$2,$3,$4)',
          [s.username.trim().toLowerCase(), await bcrypt.hash(s.password, 10), req.session.klasse, 'student']
        );
        created++;
      } catch { skipped++; }
    }
    res.json({ ok: true, created, skipped });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/admin/reset-password', requireAdmin, async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    if (!newPassword || newPassword.length < 4)
      return res.status(400).json({ error: 'Passwort mind. 4 Zeichen' });
    const r = await pool.query(
      'UPDATE users SET password_hash=$1 WHERE id=$2 AND klasse=$3 AND role=$4',
      [await bcrypt.hash(newPassword, 10), userId, req.session.klasse, 'student']
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.delete('/api/admin/student/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      'DELETE FROM users WHERE id=$1 AND klasse=$2 AND role=$3',
      [req.params.id, req.session.klasse, 'student']
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeJSON(s) {
  if (!s) return {};
  if (typeof s === 'object') return s; // pg already parsed JSON columns
  try { return JSON.parse(s); } catch { return {}; }
}


// ── Korrektur (Admin bewertet Abgaben) ───────────────────────────────────────

// Admin: get all korrektur status for a student
app.get('/api/admin/korrektur/:userId', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT gruppe, status, notiz, updated_at FROM korrektur WHERE user_id=$1',
      [req.params.userId]
    );
    const out = {};
    r.rows.forEach(row => { out[row.gruppe] = { status: row.status, notiz: row.notiz, updated_at: row.updated_at }; });
    res.json(out);
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Admin: set korrektur status
app.post('/api/admin/korrektur', requireAdmin, async (req, res) => {
  try {
    const { userId, gruppe, status, notiz } = req.body;
    if (!userId || !gruppe || !status) return res.status(400).json({ error: 'Fehlende Angaben' });
    if (!['ausstehend','bestanden','nicht_bestanden'].includes(status))
      return res.status(400).json({ error: 'Ungültiger Status' });
    await pool.query(`
      INSERT INTO korrektur (user_id, gruppe, status, notiz, admin_id, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (user_id, gruppe) DO UPDATE
      SET status=$3, notiz=$4, admin_id=$5, updated_at=NOW()
    `, [userId, gruppe, status, notiz||'', req.session.userId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Student: get own korrektur status
app.get('/api/korrektur', requireLogin, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT gruppe, status, notiz FROM korrektur WHERE user_id=$1',
      [req.session.userId]
    );
    const out = {};
    r.rows.forEach(row => { out[row.gruppe] = { status: row.status, notiz: row.notiz }; });
    res.json(out);
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});


// Admin: get full progress (including inputs) of a specific student
app.get('/api/admin/student-progress/:userId', requireAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;
    // Verify student belongs to admin's class
    const user = await pool.query(
      'SELECT id, username, klasse FROM users WHERE id=$1 AND klasse=$2 AND role=$3',
      [userId, req.session.klasse, 'student']
    );
    if (!user.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });

    const rows = await pool.query(
      'SELECT key, value FROM progress WHERE user_id=$1',
      [userId]
    );
    const progress = {};
    rows.rows.forEach(r => { progress[r.key] = r.value; });
    res.json({ username: user.rows[0].username, progress });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Catch-all ─────────────────────────────────────────────────────────────────
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// ── Start ─────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => console.log(`✓ Lerntheke auf Port ${PORT}`));
}).catch(err => {
  console.error('DB Init fehlgeschlagen:', err);
  process.exit(1);
});
