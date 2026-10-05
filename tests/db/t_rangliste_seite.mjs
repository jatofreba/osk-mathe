// Startseite: "Meine Flammen" und die Ranglisten zaehlen das laufende Halbjahr (Nutzerwunsch
// 2026-10-05) - Seite und Server ZUSAMMEN: die echte public/index.html (seite_im_test.js) holt
// ihre Daten von der echten server.js (server_im_test.js, pglite). Alle Daten liegen relativ zu
// heute, damit der Test in jedem Halbjahr gleich laeuft.
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { ladeServer } = require('../lib/server_im_test.js');
const { ladeSeite } = require('../lib/seite_im_test.js');
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
const neu = async (name, klasse = 'M3M4') => (await eins(
  `INSERT INTO users (username, password_hash, klasse, role, created_at) VALUES ($1,'x',$2,'student', NOW() - INTERVAL '2 years') RETURNING id`,
  [name, klasse])).id;
const P = {};
for (const n of ['ana', 'ben']) P[n] = await neu(n);
P.fremd = await neu('fremd', 'M1M2');

const heute = new Date();
const tagIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hjVon = d => {
  const m = d.getMonth() + 1, y = d.getFullYear(), start = m >= 8 ? y : y - 1;
  return String(start).slice(-2) + String(start + 1).slice(-2) + '_' + ((m >= 8 || m === 1) ? 1 : 2);
};
const HJ = hjVon(heute);
const HJ_TEXT = `${HJ.slice(-1)}. Halbjahr 20${HJ.slice(0, 2)}/${HJ.slice(2, 4)}`;

// Eine echte Lerntheke mit Basis-Gruppe und einer Gruppe mit Abstufungen
const meta = (await srv.rufe('get', '/api/lerntheken-meta', { session: { userId: P.ana, role: 'student', klasse: 'M3M4' } })).body;
const stufig = g => g && g.required > 0 && g.total > g.required;
const lt = meta.find(m => m.key && m.groups && m.groups.Basis && Object.values(m.groups).some(stufig));
const [gName, grp] = Object.entries(lt.groups).find(([, g]) => stufig(g));
const ids = lt.stations.filter(s => s.group === gName).map(s => s.id).slice(0, grp.total);
const VOLL = 3 * Object.values(lt.groups).filter(g => g.total > 0).length;

// ana: die Pflicht-Anzahl vor einem Jahr, den Rest heute; LZK Basis heute mit 2 Flammen.
// fremd (anderes Tandem): alles heute - stuende sonst ganz oben.
for (const n of ['ana', 'fremd']) {
  await db.query(`INSERT INTO lerntheke_access (user_id, lerntheke, gesperrt) VALUES ($1,$2,false)`, [P[n], lt.key]);
  await db.query(`INSERT INTO progress (user_id, key, value) VALUES ($1,$2,$3)`, [P[n], lt.key, JSON.stringify(ids)]);
}
await db.query(`INSERT INTO lerntheke_access (user_id, lerntheke, gesperrt) VALUES ($1,$2,false)`, [P.ben, lt.key]);
for (const [uid, liste, wann] of [[P.ana, ids.slice(0, grp.required), "NOW() - INTERVAL '1 year'"],
  [P.ana, ids.slice(grp.required), 'NOW()'], [P.fremd, ids, 'NOW()']]) {
  for (const id of liste)
    await db.query(`INSERT INTO station_events (user_id, progress_key, station_id, completed_at) VALUES ($1,$2,$3,${wann})`, [uid, lt.key, id]);
}
await db.query(`INSERT INTO lzk (user_id, lerntheke, typ, datum, status, pokale, subject_id) VALUES ($1,$2,'Basis',$3,'bestanden',2,$4)`,
  [P.ana, lt.key, tagIso(heute), F.mathe]);

// ── Seite, verbunden mit dem Server ──────────────────────────────────────────
const seite = ladeSeite();
const wer = { userId: P.ana, username: 'ana', role: 'student', klasse: 'M3M4', kurs: 'E' };
let offen = 0;
const serverFetch = srv.fetchFuer(() => ({ userId: wer.userId, role: wer.role, klasse: wer.klasse }));
let umleiten = null; // (url) => Antwort statt Server, fuer den Rueckfall-Test
seite.kontext.fetch = async (url, ...a) => {
  offen++;
  try {
    if (umleiten && umleiten(url)) return umleiten(url);
    return await serverFetch(url, ...a);
  } finally { offen--; }
};
const speicher = {};
seite.kontext.localStorage = { getItem: k => (k in speicher ? speicher[k] : null), setItem: (k, v) => { speicher[k] = String(v); }, removeItem: k => { delete speicher[k]; } };
const ruhe = async () => { do { await new Promise(r => setTimeout(r, 5)); } while (offen > 0); await new Promise(r => setTimeout(r, 5)); };
const startseite = async () => {
  seite.lauf(`me = __werte.me; ltMeta = []; subjectsMeta = [];`, { me: wer });
  await seite.lauf(`loadPickerData()`);
  await ruhe();
  return seite.element('home-trophy-summary').innerHTML;
};

let h = await startseite();
const panel = h.slice(h.indexOf('Meine Flammen'), h.indexOf('trophy-lb-col rank-col'));
pruefe('S1 "Meine Flammen" nennt das Halbjahr', h.includes('Meine Flammen – ' + HJ_TEXT), h.slice(0, 600));
const gross = panel.match(/font-size:22px[^>]*>(\d+) <span[^>]*>von (\d+)<\/span>/);
pruefe('S2 gross: die Flammen dieses Halbjahres (2 Zuwachs + 2 LZK) von dem, was zu Beginn offen war',
  gross && gross[1] === '4' && gross[2] === String(VOLL - 1 + 3), gross && gross.slice(1));
pruefe('S3 klein darunter: die Summe seit Beginn (3 + 2)',
  panel.includes(`Insgesamt: 5 von ${VOLL + 3} Flammen`), panel.slice(0, 1500));
pruefe('S4 der Text unter dem Balken spricht vom Halbjahr', panel.includes('% der in diesem Halbjahr erreichbaren Flammen'), panel.slice(0, 1500));
const zeileVon = name => (panel.match(new RegExp(name + '</span>[\\s\\S]*?<span[^>]*>(\\d+)/(\\d+) ')) || []).slice(1).join('/');
pruefe('S5 Aufschluesselung im Halbjahr: Lerntheken 2 von ' + (VOLL - 1) + ', LZK 2 von 3',
  zeileVon('Mathe-Lerntheken') === `2/${VOLL - 1}` && zeileVon('LZK') === '2/3', [zeileVon('Mathe-Lerntheken'), zeileVon('LZK')]);
const rangteil = h.slice(h.indexOf('trophy-lb-col rank-col'));
pruefe('S6 die Ranglisten heissen nach dem Halbjahr',
  rangteil.includes('Rangliste – Flammen im Halbjahr') && rangteil.includes('% der im ' + HJ_TEXT + ' für dich erreichbaren Flammen'), rangteil.slice(0, 800));
pruefe('S7 nur das eigene Tandem: je Liste zwei Zeilen (ana, ben), fremd fehlt',
  (rangteil.match(/class="lb-row[" ]/g) || []).length === 4, rangteil);
pruefe('S8 du stehst vorn - mit 4 Flammen', /lb-me">\s*<span class="lb-rank">🥇<\/span>[\s\S]*?🔥 4</.test(rangteil), rangteil);

// ── Rueckfall: ein Server ohne "ich" (aelterer Stand) - dann wie frueher die Gesamtwerte ──
umleiten = url => (String(url).startsWith('/api/leaderboard')
  ? { ok: true, status: 200, json: async () => ({ rows: [{ username: 'ana', pokale: 5, ownMax: 10 }], globalMax: 20 }) } : null);
h = await startseite();
const alt = h.slice(h.indexOf('Meine Flammen'), h.indexOf('trophy-lb-col rank-col'));
const grossAlt = alt.match(/font-size:22px[^>]*>(\d+) <span[^>]*>von (\d+)<\/span>/);
pruefe('R1 ohne "ich": Titel ohne Halbjahr, gross die Gesamtwerte, keine doppelte Zeile',
  alt.startsWith('Meine Flammen</div>') && grossAlt && grossAlt[1] === '5' && grossAlt[2] === String(VOLL + 3)
  && !alt.includes('Insgesamt:') && alt.includes('% aller möglichen Flammen'), alt.slice(0, 800));

console.log('\n' + ok + ' Pruefungen bestanden.');
