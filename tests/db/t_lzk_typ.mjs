// Typ freier LZK (Basis/Aufbau/LZK) und die LZK-Daten fuer das Python-Tool -
// gegen echtes Postgres (pglite). Aufruf: node t_lzk_typ.mjs <server.js>
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

const MATHE = (await eins(`SELECT id FROM subjects WHERE key='mathe'`)).id;
const DEUTSCH = (await eins(`SELECT id FROM subjects WHERE key='deutsch'`)).id;
const neu = async (name, rolle) =>
  (await eins(`INSERT INTO users (username, password_hash, klasse, role) VALUES ($1,'x','M3M4',$2) RETURNING id`, [name, rolle])).id;
const MERLE = await neu('merle', 'student'), BEN = await neu('ben', 'student'), HERF = await neu('herf', 'admin');

const hilfen = src.slice(src.indexOf("const LZK_STATUS = "), src.indexOf("app.get('/api/lzk',"));
// Die Schuelerliste braucht safeJSON aus server.js.
const safe = src.slice(src.indexOf('function safeJSON('), src.indexOf('\n}\n', src.indexOf('function safeJSON(')) + 2);
function handler(marke) {
  const a = src.indexOf(marke);
  if (a < 0) throw new Error('nicht gefunden: ' + marke);
  const roh = src.slice(a, src.indexOf('\n});\n', a));
  return new Function('pool', 'getLerntheckenMeta', safe + hilfen + '\nreturn async function (req, res) '
    + roh.slice(roh.indexOf('{', roh.indexOf('async (req, res)'))) + '\n};')(pool, () => []);
}
const rufe = async (h, session, body = {}, params = {}) => {
  const r = { code: 200, body: null };
  r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; return r; };
  await h({ session, body, params, query: {} }, r);
  return r;
};
const S = { userId: MERLE, role: 'student', klasse: 'M3M4' };
const A = { userId: HERF, role: 'admin', klasse: 'M3M4' };
const heute = new Date(); heute.setUTCDate(heute.getUTCDate() + 3);
const TAG = heute.toISOString().slice(0, 10);
const typVon = async id => (await eins(`SELECT typ FROM lzk WHERE id=$1`, [id])).typ;

const anlegen = handler("app.post('/api/lzk', requireLogin");
const eintrag = handler("app.post('/api/admin/lzk/eintrag', requireAdmin");
const aendern = handler("app.patch('/api/admin/lzk/:id', requireAdmin");
const liste = handler("app.get('/api/admin/students', requireAdmin");

// 1) Typ beim Anlegen
const r1 = await rufe(anlegen, S, { subjectId: MATHE, datum: TAG, thema: 'Bruchrechnung', typ: 'Basis' });
pruefe('T1 eine freie Mathe-LZK kann Basis sein', r1.code === 200 && await typVon(r1.body.id) === 'Basis', r1.body);
const r2 = await rufe(anlegen, S, { subjectId: DEUTSCH, datum: TAG, thema: 'Erörterung' });
pruefe('T2 ohne Angabe bleibt es "LZK"', await typVon(r2.body.id) === 'LZK', '');
const r3 = await rufe(anlegen, S, { subjectId: DEUTSCH, datum: TAG, typ: 'Quatsch' });
pruefe('T3 ein unbekannter Typ wird zu "LZK" statt Fehler', r3.code === 200 && await typVon(r3.body.id) === 'LZK', r3.body);
const r4 = await rufe(eintrag, A, { userIds: [MERLE, BEN], subjectId: MATHE, datum: TAG, thema: 'Bruchrechnung', typ: 'Aufbau' });
pruefe('T4 die Lernbegleitung legt fuer mehrere als Aufbau an',
  r4.code === 200 && (await Promise.all(r4.body.ids.map(typVon))).every(t => t === 'Aufbau'), r4.body);

// 2) Typ aendern
const p1 = await rufe(aendern, A, { typ: 'Aufbau' }, { id: r1.body.id });
pruefe('T5 Basis/Aufbau einer freien LZK laesst sich aendern', p1.code === 200 && await typVon(r1.body.id) === 'Aufbau', p1.body);
const p2 = await rufe(aendern, A, { typ: 'Irgendwas' }, { id: r1.body.id });
pruefe('T5b ein unbekannter Typ wird hier abgewiesen', p2.code === 400, p2.body);
const lt = await eins(`INSERT INTO lzk (user_id, lerntheke, typ, datum, status, pokale, subject_id) VALUES ($1,'kreise','Basis','2026-09-10','ausstehend',0,$2) RETURNING id`, [MERLE, MATHE]);
const p3 = await rufe(aendern, A, { typ: 'Aufbau' }, { id: lt.id });
pruefe('T5c bei einer Lerntheken-LZK steht Basis/Aufbau fest', p3.code === 409, p3.body);
const p4 = await rufe(aendern, A, { datum: '2026-09-17' }, { id: lt.id });
const verschoben = await eins(`SELECT to_char(datum,'YYYY-MM-DD') d FROM lzk WHERE id=$1`, [lt.id]);
pruefe('T6 verschieben geht auch bei einer Lerntheken-LZK', p4.code === 200 && verschoben.d === '2026-09-17', verschoben);

// 3) Was das Python-Tool bekommt
const l = await rufe(liste, A);
pruefe('P1 die Schuelerliste laeuft', l.code === 200 && Array.isArray(l.body), l.body);
const merle = l.body.find(x => x.username === 'merle');
const frei = (merle.lzk || []).find(x => x.thema === 'Bruchrechnung' && x.typ === 'Aufbau' && x.lerntheke === null);
pruefe('P2 jede LZK kommt mit id, Fach, Thema und Anfrage-Zustand',
  frei && Number.isInteger(frei.id) && frei.fach === 'mathe' && 'anfrage' in frei, merle.lzk);
const alt = (merle.lzk || []).find(x => x.lerntheke === 'kreise');
pruefe('P3 und die alten Felder unveraendert', alt && alt.typ === 'Basis' && 'datum' in alt && 'status' in alt && 'pokale' in alt, alt);
pruefe('P4 Deutsch-LZK tragen ihr Fach', (merle.lzk || []).some(x => x.fach === 'deutsch'), merle.lzk);

console.log('\n' + ok + ' Pruefungen bestanden.');
