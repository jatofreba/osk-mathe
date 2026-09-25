// Das Python-Tool legt eine freie Mathe-LZK an - genau mit dem Koerper, den osk_sync.lzk_anlegen
// schickt. Danach muss sie im Admin-Kalender stehen und das Tool sie beim naechsten Abruf wiederfinden.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import quelle from '../lib/quelle.js';

const src = quelle.lies('server.js');
const html = quelle.lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => {
  if (!b) { console.error('FAIL: ' + n + (e !== undefined ? '\n      ' + JSON.stringify(e) : '')); process.exit(1); }
  ok++; console.log('OK  ' + n);
};

const a0 = src.indexOf('async function initDB() {');
const s0 = src.indexOf('`', src.indexOf('await pool.query(', a0)) + 1;
const db = new PGlite();
await db.exec(src.slice(s0, src.indexOf('\n  `);', s0)));
const pool = quelle.poolAus(db);
const eins = async (sql, p) => (await db.query(sql, p || [])).rows[0];
const alle = async (sql, p) => (await db.query(sql, p || [])).rows;

const MATHE = (await eins(`SELECT id FROM subjects WHERE key='mathe'`)).id;
const neu = async (name, rolle, klasse = 'M3M4') =>
  (await eins(`INSERT INTO users (username, password_hash, klasse, role) VALUES ($1,'x',$2,$3) RETURNING id`, [name, klasse, rolle])).id;
const GABRIEL = await neu('ga.em', 'student');
const HERF = await neu('herf', 'admin');

// Der echte Handler, herausgeschnitten wie in t_lzk_mehrere
const hilfen = src.slice(src.indexOf("const LZK_STATUS = "), src.indexOf("app.get('/api/lzk',"));
const marke = "app.post('/api/admin/lzk/eintrag', requireAdmin";
const roh = src.slice(src.indexOf(marke), src.indexOf('\n});\n', src.indexOf(marke)));
const H = new Function('pool', hilfen + '\nreturn async function (req, res) '
  + roh.slice(roh.indexOf('{', roh.indexOf('async (req, res)'))) + '\n};')(pool);
const rufe = async body => {
  const r = { code: 200, body: null };
  r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; return r; };
  await H({ session: { userId: HERF, role: 'admin', klasse: 'M3M4' }, body }, r);
  return r;
};

// 1) Genau der Koerper aus osk_sync.lzk_anlegen (siehe test_lzk_anlegen.py, C2)
const r = await rufe({ userIds: [GABRIEL], subjectId: MATHE, datum: '2026-09-30', thema: 'Kreise', typ: 'Basis' });
pruefe('A1 angelegt, mit ID in der Antwort', r.code === 200 && Number.isInteger(r.body.id), r.body);
const z = await eins(`SELECT lerntheke, typ, thema, subject_id, anfrage, herkunft, status, pokale,
                             to_char(datum,'YYYY-MM-DD') d FROM lzk WHERE id=$1`, [r.body.id]);
pruefe('A2 freie Mathe-LZK: ohne Lerntheke, Basis, Titel = Baustein',
  z.lerntheke === null && z.typ === 'Basis' && z.thema === 'Kreise' && z.subject_id === MATHE, z);
pruefe('A3 fester Termin der Lernbegleitung, unbewertet',
  z.anfrage === null && z.herkunft === 'lernbegleitung' && z.status === 'ausstehend' && z.pokale === 0 && z.d === '2026-09-30', z);

// 2) Der Admin-Kalender (dieselbe Abfrage wie /api/calendar fuer Lernbegleitungen)
const felder = src.slice(src.indexOf('const LZK_FELDER = `') + 'const LZK_FELDER = `'.length);
const LZK_FELDER = felder.slice(0, felder.indexOf('`'));
const cal = await alle(`SELECT ${LZK_FELDER}, u.username FROM lzk l JOIN users u ON u.id = l.user_id
                        WHERE u.klasse=$1 AND u.role='student' AND u.aktiv=true`, ['M3M4']);
const imKal = cal.find(x => x.id === r.body.id);
pruefe('K1 die LZK steht im Kalender der Lernbegleitung', !!imKal && imKal.username === 'ga.em' && imKal.datumIso === '2026-09-30', cal);
// ... und der Browser zeigt sie einer Mathe-Lernbegleitung an
const f0 = html.indexOf('function calLzkZeigen(l) {');
const zeigen = new Function('me', 'return ' + html.slice(f0, html.indexOf('\n}\n', f0) + 2))(
  { role: 'admin', defaultSubjectId: MATHE });
pruefe('K2 der Kalender-Filter laesst sie fuer Mathe durch', zeigen(imKal) === true, imKal);
const zeigenDeutsch = new Function('me', 'return ' + html.slice(f0, html.indexOf('\n}\n', f0) + 2))(
  { role: 'admin', defaultSubjectId: (await eins(`SELECT id FROM subjects WHERE key='deutsch'`)).id });
pruefe('K2b (fuer eine Deutsch-Lernbegleitung bleibt sie ausgeblendet - wie jede Mathe-LZK)', zeigenDeutsch(imKal) === false);
const t0 = html.indexOf('function lzkTitel(l) {');
const titel = new Function('hjLtTitle', 'return ' + html.slice(t0, html.indexOf('\n}\n', t0) + 2))(k => k);
pruefe('K3 Anzeige: "Basis-LZK · Kreise"', titel(imKal) === 'Basis-LZK · Kreise', titel(imKal));

// 3) Was das Tool beim naechsten Abruf sieht (Teilabfrage aus /api/admin/students)
const q0 = src.indexOf("(SELECT json_agg(json_build_object('id',l.id");
const teil = src.slice(q0, src.indexOf(') AS lzk,', q0) + 1).replace('l.user_id=u.id', 'l.user_id=$1');
const liste = (await eins(`SELECT ${teil} AS lzk`, [GABRIEL])).lzk;
const e = liste.find(x => x.id === r.body.id);
pruefe('T1 das Tool bekommt ID, Fach, Thema, Typ und Datum', !!e && e.fach === 'mathe' && e.thema === 'Kreise'
  && e.typ === 'Basis' && e.lerntheke === null && e.anfrage === null && String(e.datum).startsWith('2026-09-30'), liste);

console.log('\n' + ok + ' Pruefungen bestanden.');
