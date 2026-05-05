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
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
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

// ── Admin: students ───────────────────────────────────────────────────────────
app.get('/api/admin/students', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        u.id, u.username, u.klasse, u.created_at,
        (SELECT value FROM progress WHERE user_id=u.id AND key='lerntheke_kreise_v10') AS prog,
        (SELECT value FROM progress WHERE user_id=u.id AND key='lerntheke_abgabe_v1')  AS abgabe,
        (SELECT updated_at FROM progress WHERE user_id=u.id
         ORDER BY updated_at DESC LIMIT 1) AS last_active,
        (SELECT json_object_agg(gruppe, json_build_object('status',status,'notiz',notiz))
         FROM korrektur WHERE user_id=u.id) AS korrektur
      FROM users u
      WHERE u.role='student' AND u.klasse=$1
      ORDER BY u.username
    `, [req.session.klasse]);
    res.json(r.rows.map(row => ({
      ...row,
      progress: safeJSON(row.prog),
      abgabe:   safeJSON(row.abgabe)
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
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
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
