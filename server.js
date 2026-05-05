const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '.data', 'lerntheke.db');
const SESSION_DB = process.env.SESSION_DB || path.join(__dirname, '.data', 'sessions.db');

// Ensure data directory exists
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    klasse       TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'student',
    created_at   TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS progress (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, key),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id);
`);

// ── Seed admin accounts ───────────────────────────────────────────────────────
// Default password: admin123  →  CHANGE ON FIRST LOGIN
// Admin accounts – username / display-klasse
const ADMINS = [
  { username: 'admin_m1m2', klasse: 'M1M2' },
  { username: 'admin_m3m4', klasse: 'M3M4' },
  { username: 'admin_m5m6', klasse: 'M5M6' },
  { username: 'admin_m7m8', klasse: 'M7M8' },
];
const seedAdmin = db.prepare(`
  INSERT OR IGNORE INTO users (username, password_hash, klasse, role)
  VALUES (?, ?, ?, 'admin')
`);
ADMINS.forEach(a => seedAdmin.run(a.username, bcrypt.hashSync('admin123', 10), a.klasse));

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(session({
  store: new SqliteStore({ db: SESSION_DB, concurrentDB: true }),
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

// ── Auth routes ───────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?')
                 .get((username || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash))
    return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
  Object.assign(req.session, {
    userId: user.id, username: user.username,
    klasse: user.klasse, role: user.role
  });
  res.json({ ok: true, username: user.username, klasse: user.klasse, role: user.role });
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

app.post('/api/change-password', requireLogin, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'Passwort mind. 6 Zeichen' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(oldPassword || '', user.password_hash))
    return res.status(401).json({ error: 'Altes Passwort falsch' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), req.session.userId);
  res.json({ ok: true });
});

// ── Progress routes ───────────────────────────────────────────────────────────
app.get('/api/progress', requireLogin, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM progress WHERE user_id = ?')
                 .all(req.session.userId);
  const out = {};
  rows.forEach(r => { out[r.key] = r.value; });
  res.json(out);
});

app.post('/api/progress', requireLogin, (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key fehlt' });
  db.prepare(`
    INSERT INTO progress (user_id, key, value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, key) DO UPDATE
    SET value = excluded.value, updated_at = excluded.updated_at
  `).run(req.session.userId, key, String(value));
  res.json({ ok: true });
});

// ── Admin: read students ──────────────────────────────────────────────────────
app.get('/api/admin/students', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT
      u.id, u.username, u.klasse, u.created_at,
      (SELECT value FROM progress WHERE user_id=u.id AND key='lerntheke_kreise_v10') AS prog,
      (SELECT value FROM progress WHERE user_id=u.id AND key='lerntheke_abgabe_v1')  AS abgabe,
      (SELECT updated_at FROM progress WHERE user_id=u.id
       ORDER BY updated_at DESC LIMIT 1) AS last_active
    FROM users u
    WHERE u.role = 'student' AND u.klasse = ?
    ORDER BY u.username
  `).all(req.session.klasse);

  res.json(rows.map(r => ({
    ...r,
    progress: r.prog   ? safeJSON(r.prog)   : {},
    abgabe:   r.abgabe ? safeJSON(r.abgabe) : {}
  })));
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const k = req.session.klasse;
  const total  = db.prepare('SELECT COUNT(*) n FROM users WHERE role=? AND klasse=?').get('student', k).n;
  const active = db.prepare(`
    SELECT COUNT(DISTINCT u.id) n FROM users u
    JOIN progress p ON p.user_id = u.id
    WHERE u.role='student' AND u.klasse=?
      AND p.updated_at > datetime('now','-7 days')
  `).get(k).n;
  res.json({ klasse: k, total, active });
});

// ── Admin: manage students ────────────────────────────────────────────────────
app.post('/api/admin/create-student', requireAdmin, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  if (password.length < 4)
    return res.status(400).json({ error: 'Passwort mind. 4 Zeichen' });
  try {
    db.prepare('INSERT INTO users (username,password_hash,klasse,role) VALUES (?,?,?,?)')
      .run(username.trim().toLowerCase(), bcrypt.hashSync(password, 10), req.session.klasse, 'student');
    res.json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: 'Benutzername bereits vergeben' });
  }
});

app.post('/api/admin/bulk-create', requireAdmin, (req, res) => {
  const { students } = req.body;
  if (!Array.isArray(students) || students.length === 0)
    return res.status(400).json({ error: 'Leere Liste' });

  const ins = db.prepare(
    'INSERT OR IGNORE INTO users (username,password_hash,klasse,role) VALUES (?,?,?,?)'
  );
  let created = 0, skipped = 0;
  db.transaction(() => {
    students.forEach(s => {
      if (!s.username || !s.password) { skipped++; return; }
      const r = ins.run(s.username.trim().toLowerCase(), bcrypt.hashSync(s.password, 10), req.session.klasse, 'student');
      r.changes ? created++ : skipped++;
    });
  })();
  res.json({ ok: true, created, skipped });
});

app.post('/api/admin/reset-password', requireAdmin, (req, res) => {
  const { userId, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4)
    return res.status(400).json({ error: 'Passwort mind. 4 Zeichen' });
  const r = db.prepare(
    'UPDATE users SET password_hash=? WHERE id=? AND klasse=? AND role=?'
  ).run(bcrypt.hashSync(newPassword, 10), userId, req.session.klasse, 'student');
  if (!r.changes) return res.status(404).json({ error: 'Schüler:in nicht gefunden' });
  res.json({ ok: true });
});

app.delete('/api/admin/student/:id', requireAdmin, (req, res) => {
  const r = db.prepare('DELETE FROM users WHERE id=? AND klasse=? AND role=?')
              .run(req.params.id, req.session.klasse, 'student');
  if (!r.changes) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json({ ok: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeJSON(str) {
  try { return JSON.parse(str); } catch { return {}; }
}


// ── Lerntheke list (dynamic) ──────────────────────────────────────────────────
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
  } catch {
    res.json([]);
  }
});

// ── Catch-all → SPA ───────────────────────────────────────────────────────────
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

app.listen(PORT, () => console.log(`✓ Lerntheke auf Port ${PORT}`));
