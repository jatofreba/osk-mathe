// Halbjahr-Auswertung und Rangliste mit freien LZK - gegen echtes Postgres.
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
const id = async k => (await eins(`SELECT id FROM subjects WHERE key=$1`, [k])).id;
const MATHE = await id('mathe'), DEUTSCH = await id('deutsch');
const u = (await eins(`INSERT INTO users (username, password_hash, klasse, role) VALUES ('merle','x','M3M4','student') RETURNING id`)).id;

// Drei LZK: Mathe-Lerntheke, Deutsch frei (bewertet), Deutsch angefragt (zaehlt nicht)
await db.query(`INSERT INTO lzk (user_id, lerntheke, typ, datum, status, pokale, subject_id, thema, anfrage)
  VALUES ($1,'kreise-und-zylinder','Basis','2026-09-10','bestanden',2,$2,'',NULL),
         ($1,NULL,'LZK','2026-09-15','bestanden',3,$3,'Erörterung',NULL),
         ($1,NULL,'LZK','2026-09-20','ausstehend',0,$3,'Wunsch',  'offen')`, [u, MATHE, DEUTSCH]);

// --- halbjahrOverview mit seinen Helfern ausfuehren ----------------------
const schneideFn = kopf => {
  const a = src.indexOf(kopf);
  if (a < 0) throw new Error('nicht gefunden: ' + kopf);
  return src.slice(a, src.indexOf('\n}\n', a) + 2);
};
const code = schneideFn('function halbjahrForDate(d) {') + schneideFn('async function halbjahrOverview(klasse, onlyUid) {');
const halbjahrOverview = new Function('pool', code + '\nreturn halbjahrOverview;')(pool);
const hj = await halbjahrOverview('M3M4', u);
const person = (hj.students || [])[0];
pruefe('H1 die Auswertung laeuft gegen die neue Tabelle', !!person, hj);
const alleLzk = Object.values(person.byHalbjahr).flatMap(b => b.lzk);
pruefe('H2 bewertete LZK beider Faecher kommen an', alleLzk.length === 2, alleLzk);
pruefe('H3 die offene Anfrage zaehlt nicht mit', !alleLzk.some(l => l.thema === 'Wunsch'), alleLzk);
const de = alleLzk.find(l => l.subjectId === DEUTSCH);
pruefe('H4 jede LZK traegt ihr Fach und Thema', de && de.thema === 'Erörterung' && de.pokale === 3, de);
pruefe('H5 die Mathe-LZK bleibt Mathe', alleLzk.some(l => l.subjectId === MATHE && l.lerntheke === 'kreise-und-zylinder'), alleLzk);

// --- Rangliste: die Abfrage laeuft, die freien LZK zaehlen mit -----------
{
  const r = src.slice(src.indexOf("app.get('/api/leaderboard'"), src.indexOf('\n});\n', src.indexOf("app.get('/api/leaderboard'")));
  const sql = (r.match(/pool\.query\(`(SELECT user_id, lerntheke, typ, pokale[^`]*)`\)/) || [])[1];
  pruefe('R1 die Rangliste holt anfrage mit', !!sql && /anfrage/.test(sql), sql);
  const zeilen = (await db.query(sql)).rows;
  pruefe('R1b die Abfrage laeuft gegen die neue Tabelle', zeilen.length === 3, zeilen);

  // Den neuen Block isoliert ausfuehren - genau der Text aus server.js
  const a = r.indexOf('// Freie LZK (ohne Lerntheke');
  const block = r.slice(r.indexOf('(lzkByUser', a), r.indexOf('});', r.indexOf('(lzkByUser', a)) + 3);
  const lauf = new Function('lzkByUser', 'u', 'let pokale = 0, ownMax = 0;\n' + block + '\nreturn { pokale, ownMax };');
  const erg = lauf({ [u]: zeilen }, { id: u });
  pruefe('R2 eine bewertete freie LZK bringt ihre Flammen in die Rangliste', erg.pokale === 3, erg);
  pruefe('R3 und 3 ins Maximum - die Anfrage und die Lerntheken-LZK zaehlen hier nicht doppelt', erg.ownMax === 3, erg);
}

console.log('\n' + ok + ' Pruefungen bestanden.');
