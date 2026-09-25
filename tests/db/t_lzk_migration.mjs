// Laesst den initDB-Stapel des Servers gegen ein echtes Postgres (pglite, PG 16)
// laufen: Upgrade vom alten Stand MIT Daten, Neustart, Neuinstallation, und die
// entschaerfte DROP-Falle. Aufruf: node t_lzk_migration.mjs <alt.js> <neu.js>
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import quelle from '../lib/quelle.js';

let ok = 0;
const pruefe = (n, b, e) => {
  if (!b) { console.error('FAIL: ' + n + (e !== undefined ? '\n      ' + JSON.stringify(e) : '')); process.exit(1); }
  ok++; console.log('OK  ' + n);
};

// Der Schema-Stapel steht als ein einziger Template-String in initDB().
// ALT: der Stapel von vor der LZK-Umstellung (server.js aus 99980fa^, einmal herausgezogen -
// die Historie gibt es in einem flachen CI-Klon nicht). NEU: der aktuelle aus server.js.
const ALT = fs.readFileSync(new URL('./fixtures/initdb_vor_lzk.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const NEU = quelle.initDbStapel(quelle.lies('server.js'));
pruefe('M0 beide Stapel gefunden', ALT.length > 5000 && NEU.length > 5000, [ALT.length, NEU.length]);

const zeilen = async (db, sql, p) => (await db.query(sql, p)).rows;

// ---------------------------------------------------------------------------
// A) Upgrade: alter Stand mit Daten -> neuer Stapel
// ---------------------------------------------------------------------------
{
  const db = new PGlite();
  await db.exec(ALT);
  const [st] = await zeilen(db, `INSERT INTO users (username, password_hash, klasse, role)
                                  VALUES ('merle','x','M3M4','student') RETURNING id`);
  await zeilen(db, `INSERT INTO users (username, password_hash, klasse, role)
                    VALUES ('herf','x','M3M4','admin')`);
  await db.query(`INSERT INTO lzk (user_id, lerntheke, typ, datum, status, pokale)
                  VALUES ($1,'kreise-und-zylinder','Basis','2026-09-10','bestanden',2),
                         ($1,'kreise-und-zylinder','Aufbau','2026-10-01','ausstehend',0),
                         ($1,'lineare-funktionen','Basis',NULL,'ausstehend',0)`, [st.id]);
  const vorher = await zeilen(db, `SELECT id, user_id, lerntheke, typ, to_char(datum,'YYYY-MM-DD') d, status, pokale
                                   FROM lzk ORDER BY id`);

  await db.exec(NEU);
  pruefe('A1 der neue Stapel laeuft ueber einen alten Stand mit Daten', true);

  const nachher = await zeilen(db, `SELECT id, user_id, lerntheke, typ, to_char(datum,'YYYY-MM-DD') d, status, pokale,
                                    subject_id, thema, anfrage, herkunft FROM lzk ORDER BY id`);
  pruefe('A2 kein LZK-Eintrag geht verloren', nachher.length === vorher.length, [vorher.length, nachher.length]);
  pruefe('A3 alle alten Werte sind unveraendert',
    vorher.every((v, i) => ['id','user_id','lerntheke','typ','d','status','pokale']
      .every(k => v[k] === nachher[i][k])), { vorher, nachher });
  const [mathe] = await zeilen(db, `SELECT id FROM subjects WHERE key='mathe'`);
  pruefe('A4 alle alten Eintraege sind jetzt Mathe', nachher.every(r => r.subject_id === mathe.id), nachher);
  pruefe('A5 und haben die neutralen Vorgaben',
    nachher.every(r => r.thema === '' && r.anfrage === null && r.herkunft === 'selbst'), nachher);

  const [lzkModus] = await zeilen(db, `SELECT count(*)::int n FROM subjects WHERE lzk_modus='direkt'`);
  const [alle] = await zeilen(db, `SELECT count(*)::int n FROM subjects`);
  pruefe('A6 alle Faecher starten im Modus "direkt"', lzkModus.n === alle.n, [lzkModus.n, alle.n]);

  // Lerntheken-LZK bleiben eindeutig ...
  let doppelt = null;
  try {
    await db.query(`INSERT INTO lzk (user_id, lerntheke, typ, status, pokale) VALUES ($1,'kreise-und-zylinder','Basis','ausstehend',0)`, [st.id]);
  } catch (e) { doppelt = e.message; }
  pruefe('A7 eine Lerntheken-LZK gibt es weiterhin nur einmal', !!doppelt && /unique|duplicate/i.test(doppelt), doppelt);
  // ... freie LZK duerfen sich wiederholen
  await db.query(`INSERT INTO lzk (user_id, lerntheke, typ, status, pokale, subject_id)
                  VALUES ($1,NULL,'LZK','ausstehend',0,$2),($1,NULL,'LZK','ausstehend',0,$2)`, [st.id, mathe.id]);
  const [frei] = await zeilen(db, `SELECT count(*)::int n FROM lzk WHERE lerntheke IS NULL`);
  pruefe('A8 freie LZK ohne Lerntheke gibt es beliebig oft', frei.n === 2, frei);

  // Neustart: derselbe Stapel noch einmal
  await db.exec(NEU);
  const [n2] = await zeilen(db, `SELECT count(*)::int n FROM lzk`);
  pruefe('A9 ein Neustart laeuft durch und laesst alles stehen', n2.n === vorher.length + 2, n2);
  const [basis] = await zeilen(db, `SELECT status, pokale FROM lzk WHERE lerntheke='kreise-und-zylinder' AND typ='Basis'`);
  pruefe('A9b die bestandene LZK hat ihre Flammen noch', basis.status === 'bestanden' && basis.pokale === 2, basis);
}

// ---------------------------------------------------------------------------
// B) Neuinstallation
// ---------------------------------------------------------------------------
{
  const db = new PGlite();
  await db.exec(NEU);
  await db.exec(NEU);
  const spalten = (await zeilen(db, `SELECT column_name, is_nullable FROM information_schema.columns
                                     WHERE table_name='lzk'`));
  const hat = n => spalten.some(s => s.column_name === n);
  pruefe('B1 eine frische Datenbank bekommt alle neuen Spalten',
    ['subject_id','thema','anfrage','herkunft'].every(hat), spalten.map(s => s.column_name));
  pruefe('B2 lerntheke darf leer sein',
    spalten.find(s => s.column_name === 'lerntheke').is_nullable === 'YES', '');
}

// ---------------------------------------------------------------------------
// C) Die DROP-Falle ist entschaerft - und war vorher echt
// ---------------------------------------------------------------------------
{
  const probe = async stapelSql => {
    const db = new PGlite();
    await db.exec(stapelSql);
    const [u] = await zeilen(db, `INSERT INTO users (username, password_hash, klasse, role)
                                  VALUES ('ben','x','M3M4','student') RETURNING id`);
    await db.query(`INSERT INTO lzk (user_id, lerntheke, typ, status, pokale) VALUES ($1,'k','Basis','bestanden',3)`, [u.id]);
    await db.exec(`ALTER TABLE lzk ADD COLUMN klasse TEXT`);   // jemand fuegt irgendwann "klasse" hinzu
    await db.exec(stapelSql);                                 // naechster Serverstart
    return (await zeilen(db, `SELECT count(*)::int n FROM lzk`))[0].n;
  };
  const alt = await probe(ALT);
  pruefe('C1 Gegenprobe: im alten Stand haette eine Spalte "klasse" alle LZK geloescht', alt === 0, alt);
  const neu = await probe(NEU);
  pruefe('C2 im neuen Stand bleiben sie erhalten', neu === 1, neu);
}

console.log('\n' + ok + ' Pruefungen bestanden.');
