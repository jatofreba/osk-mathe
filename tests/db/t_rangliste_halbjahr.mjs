// Rangliste je Halbjahr (Nutzerwunsch 2026-10-05): gezaehlt wird der ZUWACHS im Halbjahr -
// Lerntheken-Flammen, die im Halbjahr dazukamen, LZK mit Datum im Halbjahr, Talks des
// Halbjahres -, und nur das eigene Tandem. "ich" liefert die eigene Aufschluesselung fuer
// "Meine Flammen". Laeuft gegen die ECHTE server.js (ganz geladen, pglite) und die echten
// Lerntheken-Dateien.
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
const F = {};
for (const r of (await db.query(`SELECT id, key FROM subjects`)).rows) F[r.key] = r.id;
// Alle Accounts gibt es seit dem Schuljahr 25/26 - so zaehlen beide Halbjahre unten.
const neu = async (name, klasse = 'M3M4', rolle = 'student') =>
  (await eins(`INSERT INTO users (username, password_hash, klasse, role, created_at) VALUES ($1,'x',$2,$3,'2025-09-01') RETURNING id`,
    [name, klasse, rolle])).id;
const LB = await neu('lb_rang', 'M3M4', 'admin');
const P = {};
for (const n of ['ana', 'ben', 'cem', 'dia']) P[n] = await neu(n);
P.fremd = await neu('fremd', 'M1M2');
const S = (uid, klasse = 'M3M4') => ({ userId: uid, role: 'student', klasse });
const A = { userId: LB, role: 'admin', klasse: 'M3M4' };
const rang = (session, halbjahr = '2627_1') =>
  srv.rufe('get', '/api/leaderboard', { session, query: halbjahr ? { halbjahr } : {} }).then(r => r.body);
const zeile = (b, name) => (b.rows || []).find(z => z.username === name);

// --- eine echte Lerntheke: mit Basis-Gruppe und einer Gruppe mit Abstufungen -----
const meta = (await srv.rufe('get', '/api/lerntheken-meta', { session: S(P.ana) })).body;
const stufig = g => g && g.required > 0 && g.total > g.required;
const lt = meta.find(m => m.key && m.groups && m.groups.Basis && Object.values(m.groups).some(stufig));
pruefe('V0 es gibt eine passende Lerntheke', !!lt, meta.map(m => m.key));
const [gName, grp] = Object.entries(lt.groups).find(([, g]) => stufig(g));
const ids = lt.stations.filter(s => s.group === gName).map(s => s.id).slice(0, grp.total);
pruefe('V0b die Gruppe hat genug Stationen', ids.length === grp.total, { gName, grp, ids });
const gruppen = Object.values(lt.groups).filter(g => g.total > 0).length;
const VOLL = 3 * gruppen; // erreichbar in der Lerntheke, wenn zu Beginn noch nichts erledigt war

const fortschritt = (uid, stationen) =>
  db.query(`INSERT INTO progress (user_id, key, value) VALUES ($1,$2,$3)`, [uid, lt.key, JSON.stringify(stationen)]);
const erledigt = async (uid, stationen, wann) => {
  for (const id of stationen)
    await db.query(`INSERT INTO station_events (user_id, progress_key, station_id, completed_at) VALUES ($1,$2,$3,$4)`,
      [uid, lt.key, id, wann]);
};
const frei = uid => db.query(`INSERT INTO lerntheke_access (user_id, lerntheke, gesperrt) VALUES ($1,$2,false)`, [uid, lt.key]);
const IM_HJ = '2026-09-20T10:00:00Z', HJ_DAVOR = '2026-03-10T10:00:00Z';

// ana: die ganze Gruppe in DIESEM Halbjahr; ben: dieselbe im letzten; cem: Altbestand ohne
// Zeitstempel (vor dem Logging); dia: die Pflicht-Anzahl im letzten, den Rest jetzt.
for (const n of ['ana', 'ben', 'cem', 'dia', 'fremd']) { await frei(P[n]); await fortschritt(P[n], ids); }
await erledigt(P.ana, ids, IM_HJ);
await erledigt(P.ben, ids, HJ_DAVOR);
await erledigt(P.dia, ids.slice(0, grp.required), HJ_DAVOR);
await erledigt(P.dia, ids.slice(grp.required), IM_HJ);
await erledigt(P.fremd, ids, IM_HJ);

// LZK: Lerntheken-LZK in diesem Halbjahr, freie LZK im letzten, offene Anfrage, ohne Datum
await db.query(`INSERT INTO lzk (user_id, lerntheke, typ, datum, status, pokale, subject_id, thema, anfrage) VALUES
  ($1,$2,'Basis','2026-09-30','bestanden',2,$3,'',NULL),
  ($1,NULL,'LZK','2026-03-12','bestanden',3,$4,'Erörterung',NULL),
  ($5,NULL,'LZK','2026-10-20','ausstehend',0,$4,'Wunsch','offen'),
  ($6,$2,'Basis',NULL,'bestanden',3,$3,'',NULL)`,
  [P.ana, lt.key, F.mathe, F.deutsch, P.ben, P.cem]);

// Talks: je ein gehaltener Vortrag von ana in beiden Halbjahren; Soll je Halbjahr 1 + 2
const slot = async (halbjahr, datum) => (await eins(`INSERT INTO talking_slots
  (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
  VALUES ('M3M4',$1,'09:00','R1',$2,$3,'talk',45,$4,'') RETURNING id`, [datum, halbjahr, LB, F.mathe])).id;
await db.query(`INSERT INTO talking_sessions (slot_id, presenter_id, thema, presented_status, pokale) VALUES
  ($1,$3,'Kreise','erledigt',3), ($2,$3,'Prozente','erledigt',2)`,
  [await slot('2627_1', '2026-09-15'), await slot('2526_2', '2026-04-20'), P.ana]);
for (const hj of ['2627_1', '2526_2'])
  await db.query(`INSERT INTO subject_halbjahr_targets (subject_id, halbjahr, pflicht_praesentieren, pflicht_zuhoeren)
                  VALUES ($1,$2,1,2)`, [F.mathe, hj]);
const TALK_SOLL = 3 * 1 + 2 * 2;

// ── L) Lerntheken: nur der Zuwachs im Halbjahr ─────────────────────────────────
let b = await rang(S(P.ana));
const teil = name => b.rows && zeile(b, name);
pruefe('L0 die Antwort nennt das Halbjahr', b.halbjahr === '2627_1', b.halbjahr);
const ich = b.ich;
pruefe('L1 alles in diesem Halbjahr erledigt: die vollen 3 Flammen der Gruppe',
  ich && ich.teile.lerntheken.earned === 3 && ich.teile.lerntheken.max === VOLL, ich);
// ben/cem/dia sehen ihre eigene Aufschluesselung nur selbst - also je mit eigener Sitzung
const ichVon = async n => (await rang(S(P[n]))).ich;
let x = await ichVon('ben');
pruefe('L2 im letzten Halbjahr erledigt: jetzt 0, und die Gruppe ist nicht mehr erreichbar',
  x.teile.lerntheken.earned === 0 && x.teile.lerntheken.max === VOLL - 3, x);
x = await ichVon('cem');
pruefe('L3 Altbestand ohne Zeitstempel zaehlt als vorher erledigt',
  x.teile.lerntheken.earned === 0 && x.teile.lerntheken.max === VOLL - 3, x);
x = await ichVon('dia');
pruefe('L4 Pflicht vorher, Rest jetzt: nur der Zuwachs (2) zaehlt, erreichbar war noch 2',
  x.teile.lerntheken.earned === 2 && x.teile.lerntheken.max === VOLL - 1, x);

// ── K) LZK: nach Datum im Halbjahr ─────────────────────────────────────────────
pruefe('K1 die Lerntheken-LZK dieses Halbjahres zaehlt, die freie aus dem letzten nicht',
  ich.teile.lzk.earned === 2 && ich.teile.lzk.max === 3, ich.teile.lzk);
x = await ichVon('ben');
pruefe('K2 eine offene Anfrage zaehlt nicht', x.teile.lzk.earned === 0 && x.teile.lzk.max === 0, x.teile.lzk);
x = await ichVon('cem');
pruefe('K3 eine LZK ohne Datum gehoert zu keinem Halbjahr (wie in der Halbjahr-Uebersicht)',
  x.teile.lzk.earned === 0 && x.teile.lzk.max === 0, x.teile.lzk);

// ── T) Talks: nur das Halbjahr ─────────────────────────────────────────────────
pruefe('T1 Talks: nur der Vortrag dieses Halbjahres, Soll nur dieses Halbjahres',
  ich.teile.talks.mathe && ich.teile.talks.mathe.earned === 3 && ich.teile.talks.mathe.max === TALK_SOLL, ich.teile.talks);

// ── I) "ich" passt zur eigenen Zeile ───────────────────────────────────────────
const summe = k => ich.teile.lerntheken[k] + ich.teile.lzk[k] + Object.values(ich.teile.talks).reduce((s, t) => s + t[k], 0);
pruefe('I1 die Teile ergeben die Summe', summe('earned') === ich.pokale && summe('max') === ich.ownMax, ich);
pruefe('I2 und die Summe steht so in der Rangliste',
  teil('ana').pokale === ich.pokale && teil('ana').ownMax === ich.ownMax && ich.pokale === 3 + 2 + 3, teil('ana'));
pruefe('I3 die Rangliste verraet keine Aufschluesselung anderer', !('teile' in teil('ben')) && !('teile' in teil('ana')), b.rows);
for (const n of ['ben', 'cem', 'dia']) {
  const e = await ichVon(n);
  const sum = k => e.teile.lerntheken[k] + e.teile.lzk[k] + Object.values(e.teile.talks).reduce((s, t) => s + t[k], 0);
  pruefe('I3b ' + n + ': Zeile in der Rangliste = eigene Teile',
    sum('earned') === e.pokale && sum('max') === e.ownMax && teil(n).pokale === e.pokale && teil(n).ownMax === e.ownMax, { e, z: teil(n) });
}
const adm = await rang(A);
pruefe('I4 Lernbegleitung: kein "ich", aber die Liste des Tandems', adm.ich === null && adm.rows.length === 4, adm);

// ── D) nur das eigene Tandem ───────────────────────────────────────────────────
pruefe('D1 Rangliste von M3M4: nur die vier aus M3M4 - kein fremdes Tandem, keine Lernbegleitung',
  b.rows.map(z => z.username).sort().join(',') === 'ana,ben,cem,dia', b.rows);
const fremd = await rang(S(P.fremd, 'M1M2'));
pruefe('D2 im anderen Tandem steht nur, wer dort ist', fremd.rows.length === 1 && fremd.rows[0].username === 'fremd'
  && fremd.ich && fremd.ich.teile.lerntheken.earned === 3, fremd);
pruefe('D3 sortiert nach Flammen im Halbjahr', b.rows[0].username === 'ana', b.rows);

// ── H) anderes Halbjahr ────────────────────────────────────────────────────────
b = await rang(S(P.ana), '2526_2');
pruefe('H1 letztes Halbjahr: Stationen, die erst danach kamen, zaehlen dort nicht',
  b.ich.teile.lerntheken.earned === 0 && b.ich.teile.lerntheken.max === VOLL, b.ich);
pruefe('H2 ... dafuer die freie LZK und der Vortrag von damals',
  b.ich.teile.lzk.earned === 3 && b.ich.teile.lzk.max === 3 && b.ich.teile.talks.mathe.earned === 2, b.ich);
x = (await rang(S(P.ben), '2526_2')).ich;
pruefe('H3 ben: im letzten Halbjahr die volle Gruppe', x.teile.lerntheken.earned === 3 && x.teile.lerntheken.max === VOLL, x);
x = (await rang(S(P.dia), '2526_2')).ich;
pruefe('H4 dia: im letzten Halbjahr nur die Pflicht-Stufe (1 Flamme)',
  x.teile.lerntheken.earned === 1 && x.teile.lerntheken.max === VOLL, x);
b = await rang(S(P.ana), '2627_2');
pruefe('H5 ein neues Halbjahr startet fuer alle bei 0', b.rows.length === 4 && b.rows.every(z => z.pokale === 0), b.rows);

// ── S) Standard: das laufende Halbjahr ─────────────────────────────────────────
const jetzt = (() => {
  const d = new Date(), m = d.getMonth() + 1, y = d.getFullYear();
  const start = m >= 8 ? y : y - 1, sem = (m >= 8 || m === 1) ? 1 : 2;
  return String(start).slice(-2) + String(start + 1).slice(-2) + '_' + sem;
})();
pruefe('S1 ohne Angabe: das laufende Halbjahr', (await rang(S(P.ana), null)).halbjahr === jetzt);
pruefe('S2 Unsinn als Halbjahr: ebenso', (await rang(S(P.ana), "2627_1' OR 1=1")).halbjahr === jetzt);

console.log('\n' + ok + ' Pruefungen bestanden.');
