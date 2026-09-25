// LZK fuer mehrere Personen auf einmal - gegen echtes Postgres (pglite).
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import quelle from '../lib/quelle.js';

const src = quelle.lies('server.js');
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

const DEUTSCH = (await eins(`SELECT id FROM subjects WHERE key='deutsch'`)).id;
const neu = async (name, rolle, klasse = 'M3M4') =>
  (await eins(`INSERT INTO users (username, password_hash, klasse, role) VALUES ($1,'x',$2,$3) RETURNING id`, [name, klasse, rolle])).id;
const A = await neu('alva', 'student'), B = await neu('ben', 'student'), C = await neu('carla', 'student');
const FREMD = await neu('fremd', 'student', 'M7M8');
const HERF = await neu('herf', 'admin');

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
const anzahl = async () => (await eins(`SELECT count(*)::int n FROM lzk`)).n;

// 1) Drei Personen auf einmal
{
  const r = await rufe({ userIds: [A, B, C], subjectId: DEUTSCH, datum: '2026-10-01', thema: 'Erörterung' });
  pruefe('M1 drei Personen, ein Aufruf', r.code === 200 && r.body.ids.length === 3, r.body);
  const z = await alle(`SELECT user_id, to_char(datum,'YYYY-MM-DD') d, thema, herkunft, subject_id, lerntheke, status, pokale
                        FROM lzk ORDER BY user_id`);
  pruefe('M2 jede Person bekommt ihre EIGENE LZK', new Set(z.map(x => x.user_id)).size === 3 && z.length === 3, z);
  pruefe('M3 mit gleichem Tag, Thema und Fach',
    z.every(x => x.d === '2026-10-01' && x.thema === 'Erörterung' && x.subject_id === DEUTSCH), z);
  pruefe('M4 als freie LZK der Lernbegleitung, unbewertet',
    z.every(x => x.herkunft === 'lernbegleitung' && x.lerntheke === null && x.status === 'ausstehend' && x.pokale === 0), z);
  pruefe('M4b die Antwort nennt auch die erste ID (aeltere Aufrufer)', r.body.id === r.body.ids[0], r.body);
}

// 2) Alles oder nichts
{
  const vorher = await anzahl();
  const r = await rufe({ userIds: [A, FREMD], subjectId: DEUTSCH, datum: '2026-10-02', thema: 'x' });
  pruefe('M5 ist eine Person aus einer fremden Lerngruppe dabei, wird abgelehnt', r.code === 404, r);
  pruefe('M5b und GAR NICHTS angelegt - auch nicht fuer die passende Person', await anzahl() === vorher, await anzahl());
  const r2 = await rufe({ userIds: [A, HERF], subjectId: DEUTSCH, datum: '2026-10-02' });
  pruefe('M5c eine Lernbegleitung ist keine Schueler:in - ebenfalls nichts', r2.code === 404 && await anzahl() === vorher, r2);
}

// 3) Randfaelle
{
  const vorher = await anzahl();
  const r = await rufe({ userIds: [B, B, String(B)], subjectId: DEUTSCH, datum: '2026-10-03' });
  pruefe('M6 doppelt Angeklickte zaehlen einmal', r.code === 200 && r.body.ids.length === 1 && await anzahl() === vorher + 1, r.body);
  const leer = await rufe({ userIds: [], subjectId: DEUTSCH, datum: '2026-10-03' });
  pruefe('M7 niemand ausgewaehlt: klare Meldung', leer.code === 400 && /mindestens eine Person/.test(leer.body.error), leer.body);
  const alt = await rufe({ userId: C, subjectId: DEUTSCH, datum: '2026-10-04' });
  pruefe('M8 der alte Aufruf mit einer userId geht weiter', alt.code === 200 && alt.body.ids.length === 1, alt.body);
  const ohneDatum = await rufe({ userIds: [A], subjectId: DEUTSCH });
  pruefe('M9 ohne Datum nichts', ohneDatum.code === 400, ohneDatum.body);
}

console.log('\n' + ok + ' Pruefungen bestanden.');
