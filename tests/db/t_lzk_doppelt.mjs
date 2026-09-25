// Dieselbe LZK entsteht nicht zweimal (Doppelklick, erneutes Senden aus dem Python-Tool nach
// einem Verbindungsabbruch): beide Anlege-Wege verwenden eine gleiche LZK wieder.
import { PGlite } from '@electric-sql/pglite';
import quelle from '../lib/quelle.js';

const src = quelle.lies('server.js');
let ok = 0;
const pruefe = (n, b, e) => {
  if (!b) { console.error('FAIL: ' + n + (e !== undefined ? '\n      ' + JSON.stringify(e) : '')); process.exit(1); }
  ok++; console.log('OK  ' + n);
};

const db = new PGlite();
await db.exec(quelle.initDbStapel(src));
const pool = quelle.poolAus(db);
const eins = async (sql, p) => (await db.query(sql, p || [])).rows[0];
const anzahl = async () => (await eins(`SELECT count(*)::int n FROM lzk`)).n;

const MATHE = (await eins(`SELECT id FROM subjects WHERE key='mathe'`)).id;
const DEUTSCH = (await eins(`SELECT id FROM subjects WHERE key='deutsch'`)).id;
const neu = async (name, rolle, klasse = 'M3M4') =>
  (await eins(`INSERT INTO users (username, password_hash, klasse, role) VALUES ($1,'x',$2,$3) RETURNING id`, [name, klasse, rolle])).id;
const A = await neu('ga.em', 'student'), B = await neu('li.po', 'student');
const FREMD = await neu('fremd', 'student', 'M7M8');
const HERF = await neu('herf', 'admin');

const hilfen = src.slice(src.indexOf("const LZK_STATUS = "), src.indexOf("app.get('/api/lzk',"));
function handler(marke) {
  const a = src.indexOf(marke);
  if (a < 0) throw new Error('nicht gefunden: ' + marke);
  const roh = src.slice(a, src.indexOf('\n});\n', a));
  return new Function('pool', hilfen + '\nreturn async function (req, res) '
    + roh.slice(roh.indexOf('{', roh.indexOf('async (req, res)'))) + '\n};')(pool);
}
const EINTRAG = handler("app.post('/api/admin/lzk/eintrag', requireAdmin");
const ANFRAGE = handler("app.post('/api/lzk', requireLogin");
const rufe = async (h, session, body) => {
  const r = { code: 200, body: null };
  r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; return r; };
  await h({ session, body, params: {}, query: {} }, r);
  return r;
};
const LB = { userId: HERF, role: 'admin', klasse: 'M3M4' };
const S = uid => ({ userId: uid, role: 'student', klasse: 'M3M4' });
const tag = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const D30 = tag(5);

// ── 1) Lernbegleitung (Kalender-Dialog, Python-Tool) ─────────────────────────
const basis = { userIds: [A], subjectId: MATHE, datum: D30, thema: 'Kreise', typ: 'Basis' };
let r = await rufe(EINTRAG, LB, basis);
pruefe('E1 angelegt', r.code === 200 && Number.isInteger(r.body.id) && r.body.vorhanden === 0, r.body);
const erste = r.body.id;
let vorher = await anzahl();
r = await rufe(EINTRAG, LB, basis);
pruefe('E2 derselbe Aufruf noch einmal: dieselbe LZK, keine neue', r.code === 200 && r.body.id === erste && r.body.vorhanden === 1
  && await anzahl() === vorher, r.body);
r = await rufe(EINTRAG, LB, { ...basis, thema: '  KREISE ' });
pruefe('E3 Gross/klein und Leerzeichen im Thema egal', r.body.id === erste && await anzahl() === vorher, r.body);
for (const [was, anders] of [['anderer Tag', { datum: tag(6) }], ['Aufbau statt Basis', { typ: 'Aufbau' }],
  ['anderes Fach', { subjectId: DEUTSCH, typ: 'LZK' }], ['anderes Thema', { thema: 'Terme 1' }]]) {
  vorher = await anzahl();
  r = await rufe(EINTRAG, LB, { ...basis, ...anders });
  pruefe(`E4 ${was}: eine neue LZK`, r.code === 200 && r.body.id !== erste && await anzahl() === vorher + 1, r.body);
}
vorher = await anzahl();
r = await rufe(EINTRAG, LB, { ...basis, userIds: [B, A] });
pruefe('E5 mehrere: wer sie hat, behaelt sie, die anderen bekommen eine',
  r.code === 200 && r.body.ids.length === 2 && r.body.ids[1] === erste && r.body.ids[0] !== erste
  && r.body.id === r.body.ids[0] && r.body.vorhanden === 1 && await anzahl() === vorher + 1, r.body);
await db.query(`UPDATE lzk SET status='bestanden', pokale=2 WHERE id=$1`, [erste]);
vorher = await anzahl();
r = await rufe(EINTRAG, LB, basis);
pruefe('E6 auch eine schon bewertete gleiche LZK wird nicht verdoppelt', r.body.id === erste && await anzahl() === vorher, r.body);
const z = await eins(`SELECT status, pokale FROM lzk WHERE id=$1`, [erste]);
pruefe('E6b ... und ihr Ergebnis bleibt', z.status === 'bestanden' && z.pokale === 2, z);
// Eine offene Anfrage ist kein fester Termin - die Lernbegleitung legt trotzdem fest.
const anfrage = await rufe(ANFRAGE, S(B), { subjectId: MATHE, datum: tag(9), thema: 'Volumen', typ: 'Basis' });
vorher = await anzahl();
r = await rufe(EINTRAG, LB, { userIds: [B], subjectId: MATHE, datum: tag(9), thema: 'Volumen', typ: 'Basis' });
pruefe('E7 eine offene Anfrage gleichen Inhalts wird nicht als fester Termin wiederverwendet',
  r.code === 200 && r.body.id !== anfrage.body.id && await anzahl() === vorher + 1, r.body);
vorher = await anzahl();
r = await rufe(EINTRAG, LB, { ...basis, userIds: [A, FREMD], datum: tag(12) });
pruefe('E8 weiterhin alles oder nichts: fremde Person dabei -> nichts angelegt', r.code === 404 && await anzahl() === vorher, r.body);

// ── 2) Schueler:innen fragen an ───────────────────────────────────────────────
const wunsch = { subjectId: DEUTSCH, datum: tag(4), thema: 'Erörterung' };
r = await rufe(ANFRAGE, S(A), wunsch);
pruefe('A1 angefragt', r.code === 200 && r.body.anfrage === 'offen' && r.body.vorhanden === false, r.body);
const ersteAnfrage = r.body.id;
vorher = await anzahl();
r = await rufe(ANFRAGE, S(A), { ...wunsch, thema: 'erörterung ' });
pruefe('A2 dieselbe Anfrage noch einmal: keine zweite', r.body.id === ersteAnfrage && r.body.vorhanden === true && await anzahl() === vorher, r.body);
const ohne = await rufe(ANFRAGE, S(A), { subjectId: DEUTSCH, thema: 'Gedicht' });
r = await rufe(ANFRAGE, S(A), { subjectId: DEUTSCH, thema: 'Gedicht' });
pruefe('A3 auch ohne Wunschtermin keine zweite', r.body.id === ohne.body.id && r.body.vorhanden === true, r.body);
vorher = await anzahl();
r = await rufe(ANFRAGE, S(A), { ...wunsch, datum: tag(7) });
pruefe('A4 anderer Wunschtermin: eine neue Anfrage', r.body.id !== ersteAnfrage && await anzahl() === vorher + 1, r.body);
await db.query(`UPDATE lzk SET anfrage='abgelehnt' WHERE id=$1`, [ersteAnfrage]);
vorher = await anzahl();
r = await rufe(ANFRAGE, S(A), wunsch);
pruefe('A5 nach einer Ablehnung darf neu angefragt werden', r.body.id !== ersteAnfrage && await anzahl() === vorher + 1, r.body);
vorher = await anzahl();
r = await rufe(ANFRAGE, S(B), wunsch);
pruefe('A6 eine andere Person fragt dasselbe an: eigene Anfrage', r.body.id !== ersteAnfrage && await anzahl() === vorher + 1, r.body);

// ── 3) Die Sperre ────────────────────────────────────────────────────────────
pruefe('L1 Pruefen und Anlegen laufen unter einer Transaktions-Sperre',
  /pg_advisory_xact_lock/.test(hilfen) && /await client\.query\('BEGIN'\)/.test(hilfen) && /ROLLBACK/.test(hilfen));
const offen = await eins(`SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory'`);
pruefe('L2 nach dem Anlegen ist keine Sperre mehr gehalten', offen.n === 0, offen);

console.log('\n' + ok + ' Pruefungen bestanden.');
