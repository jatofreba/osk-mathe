// Wunschliste (Nutzerwunsch 2026-11-04): die Person, die einen Fachbuero-Wunsch gestellt hat,
// gehoert immer dazu - in Zahl und Namen, und beim "Termin daraus machen" wird sie mit
// eingeladen, auch wenn ihr eigenes "ich auch" fehlt (das liess sich frueher abwaehlen).
// Laeuft gegen die ECHTE server.js (ganz geladen, pglite).
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { ladeServer } = require('../lib/server_im_test.js');
const { lies } = require('../lib/quelle.js');

let ok = 0;
const pruefe = (n, b, e) => {
  if (!b) { console.error('FAIL: ' + n + (e !== undefined ? '\n      ' + String(typeof e === 'string' ? e : JSON.stringify(e)).slice(0, 1500) : '')); process.exit(1); }
  ok++; console.log('OK  ' + n);
};

const db = new PGlite();
const srv = await ladeServer(lies('server.js'), db);
const eins = async (sql, p) => (await db.query(sql, p || [])).rows[0];
const alle = async (sql, p) => (await db.query(sql, p || [])).rows;
const F = {};
for (const r of await alle(`SELECT id, key FROM subjects`)) F[r.key] = r.id;
const neu = async (name, rolle = 'student') =>
  (await eins(`INSERT INTO users (username, password_hash, klasse, role) VALUES ($1,'x','M3M4',$2) RETURNING id`, [name, rolle])).id;
const LB = await neu('lb', 'admin');
const P = {};
for (const n of ['ana', 'ben', 'cem', 'dia']) P[n] = await neu(n);
const S = id => ({ userId: id, role: 'student', klasse: 'M3M4' });
const A = { userId: LB, role: 'admin', klasse: 'M3M4' };
const tagIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tag = n => { const h = new Date(); return tagIso(new Date(h.getFullYear(), h.getMonth(), h.getDate() + n)); };
const slot = async (datum, uhrzeit = '10:00') => (await eins(
  `INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
   VALUES ('M3M4',$1,$2,'R1','',$3,'input',45,$4,'') RETURNING id`, [datum, uhrzeit, LB, F.mathe])).id;
const wuensche = async wer => (await srv.rufe('get', '/api/wuensche', { session: wer })).body;
const eingeladen = async slotId => (await alle(
  `SELECT u.username FROM talking_invitations ti JOIN talking_sessions ts ON ts.id = ti.session_id
   JOIN users u ON u.id = ti.listener_id WHERE ts.slot_id=$1 ORDER BY u.username`, [slotId])).map(r => r.username);

// ── W) Wunsch stellen, mitmachen, eigenes "ich auch" ─────────────────────────
let r = await srv.rufe('post', '/api/wuensche', { session: S(P.ana), body: { titel: 'Brüche', subjectId: F.mathe } });
const w1 = r.body.id;
pruefe('W1 Wunsch angelegt', r.code === 200 && w1, r.body);
r = await srv.rufe('post', '/api/wuensche/:id/interesse', { session: S(P.ben), params: { id: w1 } });
pruefe('W2 ben: "ich auch" geht weiter wie bisher', r.code === 200 && r.body.dabei === true && r.body.anzahl === 2, r.body);
r = await srv.rufe('post', '/api/wuensche/:id/interesse', { session: S(P.ana), params: { id: w1 } });
pruefe('W3 ana kann sich aus dem eigenen Wunsch nicht mehr austragen',
  r.code === 409 && r.body.error.includes('eigener Wunsch')
  && !!(await eins(`SELECT 1 AS x FROM wunsch_interesse WHERE wunsch_id=$1 AND user_id=$2`, [w1, P.ana])), r.body);

// Alter Bestand: ana hatte ihr "ich auch" frueher abgewaehlt.
await db.query(`DELETE FROM wunsch_interesse WHERE wunsch_id=$1 AND user_id=$2`, [w1, P.ana]);
let liste = await wuensche(A);
let w = liste.find(x => x.id === w1);
pruefe('W4 Lernbegleitung: ana zaehlt trotzdem mit (2) und steht bei den Namen',
  w.anzahl === 2 && JSON.stringify(w.interessierte) === '["ana","ben"]' && w.vonUsername === 'ana', w);
w = (await wuensche(S(P.ana))).find(x => x.id === w1);
pruefe('W5 ana selbst: dabei, eigener Wunsch, Zahl 2', w.ichDabei === true && w.vonMir === true && w.anzahl === 2, w);
w = (await wuensche(S(P.cem))).find(x => x.id === w1);
pruefe('W6 cem: nicht dabei, sieht keine Namen', w.ichDabei === false && w.vonMir === false && w.interessierte === undefined
  && w.vonUsername === undefined && w.anzahl === 2, w);

// ── T) Termin daraus machen ──────────────────────────────────────────────────
const s1 = await slot(tag(3));
r = await srv.rufe('post', '/api/admin/wuensche/:id/termin', { session: A, params: { id: w1 }, body: { slotId: s1 } });
pruefe('T1 die anfragende Person wird mit eingeladen (ana + ben)',
  r.code === 200 && r.body.eingeladen === 2 && JSON.stringify(await eingeladen(s1)) === '["ana","ben"]', [r.body, await eingeladen(s1)]);
pruefe('T2 als "angenommen" eingetragen, Wunsch steht auf geplant',
  (await alle(`SELECT ti.status FROM talking_invitations ti JOIN talking_sessions ts ON ts.id=ti.session_id WHERE ts.slot_id=$1`, [s1]))
    .every(x => x.status === 'angenommen')
  && (await eins(`SELECT status, slot_id FROM wunsch WHERE id=$1`, [w1])).status === 'geplant');

// Hat die anfragende Person zur selben Zeit schon etwas, wird sie wie alle anderen gemeldet.
r = await srv.rufe('post', '/api/wuensche', { session: S(P.cem), body: { titel: 'Prozente', subjectId: F.mathe } });
const w2 = r.body.id;
await srv.rufe('post', '/api/wuensche/:id/interesse', { session: S(P.dia), params: { id: w2 } });
const belegt = await slot(tag(4), '11:00');
const bs = (await eins(`INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,'x') RETURNING id`, [belegt, P.cem])).id;
const s2 = await slot(tag(4), '11:00');
r = await srv.rufe('post', '/api/admin/wuensche/:id/termin', { session: A, params: { id: w2 }, body: { slotId: s2 } });
pruefe('T3 Zeitkonflikt der anfragenden Person: gemeldet, die anderen trotzdem eingeladen',
  r.code === 200 && r.body.eingeladen === 1 && r.body.conflicts.length === 1 && r.body.conflicts[0].username === 'cem'
  && JSON.stringify(await eingeladen(s2)) === '["dia"]', r.body);

// Passiv gesetzte anfragende Person: wie bei "ich auch" nicht eingeladen.
r = await srv.rufe('post', '/api/wuensche', { session: S(P.dia), body: { titel: 'Terme', subjectId: F.mathe } });
const w3 = r.body.id;
await srv.rufe('post', '/api/wuensche/:id/interesse', { session: S(P.ben), params: { id: w3 } });
await db.query(`UPDATE users SET aktiv=false WHERE id=$1`, [P.dia]);
const s3 = await slot(tag(5));
r = await srv.rufe('post', '/api/admin/wuensche/:id/termin', { session: A, params: { id: w3 }, body: { slotId: s3 } });
pruefe('T4 passive anfragende Person wird nicht eingeladen', r.code === 200 && JSON.stringify(await eingeladen(s3)) === '["ben"]', r.body);
await db.query(`UPDATE users SET aktiv=true WHERE id=$1`, [P.dia]);

// Ohne anfragende Person (Account geloescht -> user_id NULL): zaehlt und laedt nur die anderen.
r = await srv.rufe('post', '/api/wuensche', { session: S(P.ben), body: { titel: 'Gleichungen', subjectId: F.mathe } });
const w4 = r.body.id;
await srv.rufe('post', '/api/wuensche/:id/interesse', { session: S(P.cem), params: { id: w4 } });
await db.query(`UPDATE wunsch SET user_id=NULL WHERE id=$1`, [w4]);
await db.query(`DELETE FROM wunsch_interesse WHERE wunsch_id=$1 AND user_id=$2`, [w4, P.ben]);
w = (await wuensche(A)).find(x => x.id === w4);
pruefe('T5 Wunsch ohne anfragende Person: Zahl und Namen nur von den anderen', w.anzahl === 1 && JSON.stringify(w.interessierte) === '["cem"]', w);
const s4 = await slot(tag(6));
r = await srv.rufe('post', '/api/admin/wuensche/:id/termin', { session: A, params: { id: w4 }, body: { slotId: s4 } });
pruefe('T6 ... und eingeladen wird nur cem', r.code === 200 && JSON.stringify(await eingeladen(s4)) === '["cem"]', r.body);

// Die Liste fuer die Lernbegleitung kennt das Fach jedes Wunsches (fuer die Fach-Ansicht).
liste = await wuensche(A);
pruefe('T7 jeder Wunsch traegt sein Fach', liste.length === 4 && liste.every(x => x.subjectId === F.mathe && x.subjectName), liste);

console.log(`\n${ok} Pruefungen ok`);
process.exit(0);
