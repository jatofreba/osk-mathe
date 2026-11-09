// Schnellanlegen in "Meine Woche" der Lernbegleitung (Nutzerwunsch 2026-11-09) - Seite und
// Server ZUSAMMEN (seite_im_test + server_im_test, pglite):
//  - freie Stelle in einem Feld antippen (Rechtsklick auch auf einer Kachel) -> Menue mit
//    "＋ <Fach>-FaBü" und "＋ <Fach>-Talk",
//  - das Anlege-Fenster kommt vorausgefuellt: Tag, erste freie Zeit im Feld, Dauer bis zum
//    naechsten belegten Termin bzw. Feldende, hoechstens die Fach-Vorgabe,
//  - belegt ist nur, was das eigene Fach hat oder was man selbst haelt,
//  - Vergangenes bleibt stumm, volle Felder und solche hinter der 8-Wochen-Frist sagen warum,
//  - der Talks-Reiter legt weiter wie bisher an (Fach des Reiters, danach Talks neu laden),
//  - ein abgebrochener Wunsch haengt sich nicht mehr an den naechsten Termin.
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { ladeServer } = require('../lib/server_im_test.js');
const { ladeSeite } = require('../lib/seite_im_test.js');
const { lies } = require('../lib/quelle.js');

let ok = 0;
const pruefe = (n, b, e) => {
  if (!b) { console.error('FAIL: ' + n + (e !== undefined ? '\n      ' + String(typeof e === 'string' ? e : JSON.stringify(e)).slice(0, 2500) : '')); process.exit(1); }
  ok++; console.log('OK  ' + n);
};

const db = new PGlite();
const srv = await ladeServer(lies('server.js'), db);
const eins = async (sql, p) => (await db.query(sql, p || [])).rows[0];
const F = {};
for (const r of (await db.query(`SELECT id, key FROM subjects`)).rows) F[r.key] = r.id;
// Englisch arbeitet in 15-Minuten-Fachbueros - die Vorgabe deckelt die Dauer.
await db.query(`UPDATE subjects SET default_dauer=15 WHERE key='englisch'`);
const neu = async (name, rolle, fach) => (await eins(
  `INSERT INTO users (username, password_hash, klasse, role, default_subject_id) VALUES ($1,'x','M3M4',$2,$3) RETURNING id`,
  [name, rolle, fach])).id;
const LB = await neu('lb_mathe', 'admin', F.mathe);
const LB2 = await neu('lb_englisch', 'admin', F.englisch);

// ── Seite, verbunden mit dem Server; "jetzt" = heute 09:10 ───────────────────
const tagIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const heute = tagIso(new Date());
const seite = ladeSeite({ heute: heute + 'T09:10:00' });
let wer = { userId: LB, username: 'lb_mathe', role: 'admin', klasse: 'M3M4', superAdmin: false, defaultSubjectId: F.mathe };
let offen = 0;
const serverFetch = srv.fetchFuer(() => ({ userId: wer.userId, role: wer.role, klasse: wer.klasse }));
seite.kontext.fetch = async (...a) => { offen++; try { return await serverFetch(...a); } finally { offen--; } };
const meldungen = [];
seite.kontext.alert = t => meldungen.push(String(t));
const ruhe = async () => { do { await new Promise(r => setTimeout(r, 5)); } while (offen > 0); await new Promise(r => setTimeout(r, 5)); };
const lauf = (code, werte) => seite.lauf(code, werte);
const wert = id => seite.element(id).value;
const menue = () => seite.element('aw-schnell');

// Welche Ansicht nach dem Anlegen neu geladen wird, protokollieren (die echte laeuft weiter).
lauf(`globalThis.__geladen = [];
  { const lc = loadCalendar, lt = loadTalkingAdmin;
    loadCalendar = (...a) => { __geladen.push('kalender'); return lc(...a); };
    loadTalkingAdmin = (...a) => { __geladen.push('talks'); return lt(...a); }; }
  globalThis.__offen = [];
  { const om = openModal; openModal = (id) => { __offen.push(id); return om(id); }; }`);
await lauf(`me = __werte.me; loadSubjectsMeta()`, { me: wer }); await ruhe();

// Tage der naechsten Woche (Mo-Fr) - alle in der Zukunft und innerhalb der Frist.
const T = lauf(`(() => { const m = lwMonday(); m.setDate(m.getDate() + 7);
  return [0, 1, 2, 3, 4].map(i => { const d = new Date(m); d.setDate(m.getDate() + i); return lwDateStr(d); }); })()`);
const slot = async (datum, uhrzeit, dauer, fach, admin, typ = 'input') => (await eins(
  `INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
   VALUES ('M3M4',$1,$2,'R1',$3,$4,$5,$6,$7,'') RETURNING id`,
  [datum, uhrzeit, typ === 'talk' ? '2627_1' : '', admin, typ, dauer, fach])).id;
// Montag
await slot(T[0], '08:45', 15, F.mathe, LB);              // Feld 0: eigenes Mathe-FaBü 08:45-09:00
await slot(T[0], '10:45', 45, F.englisch, LB2);          // Feld 2: anderes Fach, andere Person - zaehlt nicht
await slot(T[0], '11:30', 45, F.englisch, LB);           // Feld 3: eigener Termin in anderem Fach - belegt
await slot(T[0], '12:30', 45, F.mathe, LB2, 'talk');     // Feld 4: Mathe-Talk der Kollegin - belegt
// Dienstag
await slot(T[1], '08:45', 90, F.mathe, LB2);             // Feld 0 und reicht in Feld 1 hinein
await slot(T[1], '10:45', 17, F.mathe, LB);              // Feld 2: bis 11:02 ...
await slot(T[1], '11:05', 15, F.mathe, LB);              // ... dann 11:05-11:20; Luecke 3 Min zu kurz

const zeige = async (woche) => { await lauf(`_awWoche = ${woche}; loadCalendar()`); await ruhe(); return seite.element('cal-adminweek').innerHTML; };
// Felder in Rasterreihenfolge: Index = Block * 5 + Tag.
const felder = h => [...h.matchAll(/<div class="lw-cell[^"]*"[^>]*>/g)].map(m => m[0]);
const ev = (typ, aufKachel) => ({ type: typ, clientX: 300, clientY: 200, verhindert: false,
  target: { closest: sel => (aufKachel && sel.includes('.lw-chip')) ? {} : null },
  preventDefault() { this.verhindert = true; } });
const klick = (datum, bi, typ = 'click', aufKachel = false) => {
  const e = ev(typ, aufKachel);
  lauf(`awFeldKlick(__werte.e, __werte.d, __werte.b)`, { e, d: datum, b: bi });
  return e;
};
const zu = () => lauf('awSchnellZu()');

// ── R) Raster ────────────────────────────────────────────────────────────────
let h = await zeige(1);
let f = felder(h);
pruefe('R1 25 Felder, freie mit Klick, Rechtsklick und Hinweis', f.length === 25
  && f[1 * 5 + 0].includes('aw-feld aw-feld-frei') && f[1 * 5 + 0].includes(`onclick="awFeldKlick(event,'${T[0]}',1)"`)
  && f[1 * 5 + 0].includes(`oncontextmenu="awFeldKlick(event,'${T[0]}',1)"`) && f[1 * 5 + 0].includes('title="Hier einen Termin anlegen"'), f.slice(0, 7));
pruefe('R2 volle Felder antworten, zeigen aber kein ＋ (Mo 11:30, Mo 12:30, Di 08:45, Di 09:30)',
  [3 * 5 + 0, 4 * 5 + 0, 0 * 5 + 1, 1 * 5 + 1].every(i => f[i].includes(' aw-feld"') && f[i].includes('onclick=') && !f[i].includes('aw-feld-frei')),
  [3 * 5 + 0, 4 * 5 + 0, 0 * 5 + 1, 1 * 5 + 1].map(i => f[i]));
pruefe('R3 die Kacheln stehen unveraendert in ihren Feldern', (h.match(/data-aw="/g) || []).length === 7, h.length);
pruefe('R4 Legende erklaert das ＋', h.includes('＋ freie Stelle in einem Feld antippen: Termin dort anlegen'));

h = await zeige(2);
f = felder(h);
pruefe('R5 leere Woche: das Raster steht trotzdem da, alle Felder frei, mit Hinweis statt Legende',
  f.length === 25 && f.every(x => x.includes('aw-feld-frei'))
  && h.includes('Diese Woche sind keine Termine angelegt – freie Stelle in einem Feld antippen legt einen an.')
  && !h.includes('mw-legend'), h.slice(0, 400));

h = await zeige(-1);
f = felder(h);
pruefe('R6 vergangene Woche: kein Feld antippbar', f.length === 25 && f.every(x => !x.includes('onclick') && !x.includes('aw-feld')), f[0]);

h = await zeige(9);
f = felder(h);
pruefe('R7 hinter der 8-Wochen-Frist: antippbar fuer den Hinweis, aber kein ＋',
  f.every(x => x.includes(' aw-feld"') && !x.includes('aw-feld-frei')), f[0]);
const fristTag = lauf(`(() => { const m = lwMonday(); m.setDate(m.getDate() + 63); return lwDateStr(m); })()`);
klick(fristTag, 0);
pruefe('R8 ... und sagt dann bis wann planbar ist, ohne Knopf',
  menue().hidden === false && menue().innerHTML.includes('Liegt hinter der 8-Wochen-Frist – planbar bis')
  && !menue().innerHTML.includes('<button'), menue().innerHTML);
zu();

// ── K) Klicken ───────────────────────────────────────────────────────────────
h = await zeige(1);
let e = klick(T[0], 0);
let m = menue().innerHTML;
const moText = lauf(`lwFmtDay(__werte.d)`, { d: T[0] });
pruefe('K1 freie Stelle neben dem eigenen 15-Min-FaBü: Menue ab 09:00, Dauer bis Feldende',
  menue().hidden === false && e.verhindert && m.includes(`${moText} · 1. Block (1/2)`) && m.includes('noch frei: 09:00–09:30')
  && m.includes(`onclick="awSchnellAnlegen('input')">＋ Mathe-FaBü · 09:00–09:30</button>`)
  && m.includes(`onclick="awSchnellAnlegen('talk')">＋ Mathe-Talk · 09:00–09:30</button>`), m);
{
  // Fenstermasse fuer die Lage (die Allzweck-Attrappe hat keine Zahlen); Menue 220 x 120.
  const fenster = seite.kontext.window;
  seite.kontext.window = { innerWidth: 1000, innerHeight: 700 };
  const lage = () => [menue().style.left, menue().style.top].join(' ');
  const an = (x, y) => { const e2 = ev('click'); e2.clientX = x; e2.clientY = y;
    lauf(`awFeldKlick(__werte.e, __werte.d, 0)`, { e: e2, d: T[0] }); return lage(); };
  const mitte = an(300, 200), rechts = an(990, 200), unten = an(300, 650);
  seite.kontext.window = fenster;
  pruefe('K2 das Menue steht am Klickpunkt, am rechten Rand eingerueckt, unten nach oben geklappt',
    mitte === '300px 200px' && rechts === '772px 200px' && unten === '300px 530px', [mitte, rechts, unten]);
}
zu();
e = klick(T[0], 0, 'click', true);
pruefe('K3 Klick auf eine Kachel bleibt bei der Kachel: kein Menue', menue().hidden === true && !e.verhindert);
e = klick(T[0], 0, 'contextmenu', true);
pruefe('K4 Rechtsklick auf der Kachel oeffnet es doch', menue().hidden === false && e.verhindert
  && menue().innerHTML.includes('＋ Mathe-FaBü · 09:00–09:30'));
zu();

klick(T[0], 2);
pruefe('K5 ein Englisch-FaBü der Kollegin belegt fuer Mathe nichts', menue().innerHTML.includes('noch frei: 10:45–11:30')
  && menue().innerHTML.includes('＋ Mathe-FaBü · 10:45–11:30'), menue().innerHTML);
for (const [d, bi, was] of [[T[0], 3, 'eigener Englisch-Termin'], [T[0], 4, 'Mathe-Talk der Kollegin'],
  [T[1], 0, 'Mathe 08:45-10:15'], [T[1], 1, 'hineinreichender Mathe-Termin']]) {
  klick(d, bi);
  pruefe(`K6 voll (${was}): Hinweis, kein Knopf`, menue().innerHTML.includes('In diesem Feld ist für Mathe keine Zeit mehr frei.')
    && !menue().innerHTML.includes('<button'), menue().innerHTML);
}
lauf(`openModal = (id) => { __offen.push(id); }`);
lauf(`__offen.length = 0; awSchnellAnlegen('input')`); await ruhe();
pruefe('K7 im vollen Feld legt "Anlegen" nichts an (kein Fenster)', lauf('__offen.length') === 0);
klick(T[1], 2);
pruefe('K8 Luecke unter 5 Min zaehlt nicht: erste freie Zeit 11:20 fuer 10 Min',
  menue().innerHTML.includes('noch frei: 11:20–11:30') && menue().innerHTML.includes('＋ Mathe-FaBü · 11:20–11:30'), menue().innerHTML);
zu();

// ── A) Anlegen: Fachbuero ────────────────────────────────────────────────────
lauf(`activeSubject = 'englisch'`);   // zuletzt im Englisch-Talks-Reiter gewesen - zaehlt nicht
klick(T[0], 0);
lauf(`__offen.length = 0; awSchnellAnlegen('input')`); await ruhe();
pruefe('A1 FaBü-Fenster offen, Menue zu', lauf('__offen.join()') === 'modal-input-slot' && menue().hidden === true);
pruefe('A2 vorausgefuellt: Tag, 09:00, 30 Min, Mathe, Ort aus dem Fach, ich als Lernbegleitung',
  wert('islot-datum') === T[0] && wert('islot-uhrzeit') === '09:00' && wert('islot-dauer') === '30'
  && wert('islot-subject') === String(F.mathe) && wert('islot-ort') === 'Mathe-Fachbüro' && wert('islot-teacher') === String(LB)
  && seite.element('islot-recurring').checked === false && wert('islot-thema') === '',
  ['islot-datum', 'islot-uhrzeit', 'islot-dauer', 'islot-subject', 'islot-ort', 'islot-teacher'].map(wert));
lauf('__geladen.length = 0');
await lauf('submitInputSlot()'); await ruhe();
let neuSlot = await eins(`SELECT to_char(datum,'YYYY-MM-DD') AS datum, uhrzeit, dauer, subject_id AS fach, typ, admin_id AS lb
  FROM talking_slots ORDER BY id DESC LIMIT 1`);
pruefe('A3 so angelegt', JSON.stringify(neuSlot) === JSON.stringify({ datum: T[0], uhrzeit: '09:00', dauer: 30, fach: F.mathe, typ: 'input', lb: LB }), neuSlot);
klick(T[0], 0);
pruefe('A4 danach ist das Feld fuer Mathe voll', lauf('__geladen.includes("kalender")')
  && menue().innerHTML.includes('keine Zeit mehr frei'), menue().innerHTML);
zu();

// ── T) Anlegen: Talk ─────────────────────────────────────────────────────────
klick(T[0], 1);
lauf(`__offen.length = 0; awSchnellAnlegen('talk')`);
pruefe('T1 Talk-Fenster: Mathe (nicht das zuletzt offene Englisch), Tag, 09:30, 45 Min, Halbjahr des Tags',
  lauf('__offen.join()') === 'modal-talking-slot' && seite.element('tslot-titel').textContent === 'Mathe-Talk-Termin anlegen'
  && wert('tslot-datum') === T[0] && wert('tslot-uhrzeit') === '09:30' && wert('tslot-dauer') === '45'
  && wert('tslot-ort') === 'Mathe-Fachbüro' && wert('tslot-halbjahr') === lauf(`halbjahrForDateClient(__werte.d + 'T00:00:00')`, { d: T[0] }),
  [seite.element('tslot-titel').textContent, ...['tslot-datum', 'tslot-uhrzeit', 'tslot-dauer', 'tslot-ort', 'tslot-halbjahr'].map(wert)]);
lauf('__geladen.length = 0');
await lauf('submitTalkingSlot()'); await ruhe();
neuSlot = await eins(`SELECT to_char(datum,'YYYY-MM-DD') AS datum, uhrzeit, dauer, subject_id AS fach, typ, halbjahr
  FROM talking_slots ORDER BY id DESC LIMIT 1`);
pruefe('T2 als Mathe-Talk angelegt', neuSlot.datum === T[0] && neuSlot.uhrzeit === '09:30' && neuSlot.dauer === 45
  && neuSlot.fach === F.mathe && neuSlot.typ === 'talk' && neuSlot.halbjahr === wert('tslot-halbjahr'), neuSlot);
pruefe('T3 danach wird "Meine Woche" neu geladen, nicht der Talks-Reiter', lauf('__geladen.join()') === 'kalender', lauf('__geladen.join()'));

// Talks-Reiter wie bisher: Fach des Reiters, leere Felder, danach Talks neu laden.
lauf(`activeSubject = 'englisch'; openTalkingSlotModal()`);
pruefe('T4 Talks-Reiter: Englisch, Datum und Uhrzeit leer, Dauer aus dem Fach, laufendes Halbjahr',
  seite.element('tslot-titel').textContent === 'Englisch-Talk-Termin anlegen' && wert('tslot-datum') === '' && wert('tslot-uhrzeit') === ''
  && wert('tslot-dauer') === '15' && wert('tslot-halbjahr') === lauf('currentHalbjahrGuess()'),
  ['tslot-datum', 'tslot-uhrzeit', 'tslot-dauer', 'tslot-halbjahr'].map(wert));
seite.element('tslot-datum').value = T[3];
seite.element('tslot-uhrzeit').value = '10:45';
lauf('__geladen.length = 0');
await lauf('submitTalkingSlot()'); await ruhe();
neuSlot = await eins(`SELECT to_char(datum,'YYYY-MM-DD') AS datum, subject_id AS fach, typ FROM talking_slots ORDER BY id DESC LIMIT 1`);
pruefe('T5 ... legt einen Englisch-Talk an und laedt den Talks-Reiter', neuSlot.fach === F.englisch && neuSlot.datum === T[3]
  && lauf('__geladen.join()') === 'talks', [neuSlot, lauf('__geladen.join()')]);

// ── D) Dauer, Fach, heute ────────────────────────────────────────────────────
wer = { userId: LB2, username: 'lb_englisch', role: 'admin', klasse: 'M3M4', superAdmin: false, defaultSubjectId: F.englisch };
await lauf(`me = __werte.me; _awWoche = 1; loadCalendar()`, { me: wer }); await ruhe();
klick(T[2], 1);
pruefe('D1 Englisch (Vorgabe 15 Min): leeres Feld bietet 09:30–09:45', menue().innerHTML.includes('noch frei: 09:30–10:15')
  && menue().innerHTML.includes('＋ Englisch-FaBü · 09:30–09:45'), menue().innerHTML);
lauf(`awSchnellAnlegen('input')`); await ruhe();
pruefe('D2 ... und das Fenster traegt 15 Min ein', wert('islot-dauer') === '15' && wert('islot-uhrzeit') === '09:30'
  && wert('islot-subject') === String(F.englisch), ['islot-dauer', 'islot-uhrzeit', 'islot-subject'].map(wert));

lauf(`me = Object.assign({}, me, { defaultSubjectId: __werte.f })`, { f: F.lernberatung });
klick(T[2], 1);
pruefe('D3 Lernberatung: nur "＋ Lernberatung-Termin", kein Talk', menue().innerHTML.includes('＋ Lernberatung-Termin · 09:30–10:15')
  && !menue().innerHTML.includes('Talk'), menue().innerHTML);
zu();
lauf(`me = __werte.me`, { me: wer });

const zustand = d => lauf(`JSON.stringify(awFeldZustand(__werte.d, 0))`, { d });
const gestern = lauf(`(() => { const d = new Date(); d.setDate(d.getDate() - 1); return lwDateStr(d); })()`);
pruefe('D4 heute um 09:10: das laufende Feld ab jetzt', JSON.parse(zustand(heute)).frei[0][0] === 9 * 60 + 10, zustand(heute));
pruefe('D5 gestern: vorbei', JSON.parse(zustand(gestern)).art === 'vorbei');
klick(gestern, 0);
pruefe('D6 ... und dort geht kein Menue auf', menue().hidden === true);

// ── W) Wunsch haengt nur am eigenen Fenster ──────────────────────────────────
lauf(`_wunschFuerTermin = 77`);   // Wunsch-Fenster geoeffnet und abgebrochen
klick(T[2], 2);
lauf(`awSchnellAnlegen('input')`); await ruhe();
pruefe('W1 Schnellanlegen nimmt keinen liegengebliebenen Wunsch mit', lauf('_wunschFuerTermin') === null);
lauf(`_wunschFuerTermin = 77`);
await lauf(`openInputSlotModal()`); await ruhe();
pruefe('W2 "+ FaBü-Termin" ebenso - und ohne Vorbelegung bleibt die Uhrzeit leer, die Dauer aus dem Fach',
  lauf('_wunschFuerTermin') === null && wert('islot-uhrzeit') === '' && wert('islot-dauer') === '15', ['islot-uhrzeit', 'islot-dauer'].map(wert));
lauf(`_wunschFuerTermin = 77`);
await lauf(`openInputSlotModal(null, { subjectId: __werte.f, thema: 'Brüche', ausWunsch: true })`, { f: F.mathe }); await ruhe();
pruefe('W3 aus dem Wunsch heraus bleibt er dran', lauf('_wunschFuerTermin') === 77 && wert('islot-thema') === 'Brüche');
pruefe('W4 und der Wunsch-Weg gibt das mit', lies('public/index.html').includes(
  "openInputSlotModal(null, { subjectId: w.subjectId, thema: w.titel, ausWunsch: true });"));

// ── S) Schliessen ────────────────────────────────────────────────────────────
const quelle = lies('public/index.html');
pruefe('S1 das Menue geht bei Escape, Tippen daneben und Scrollen zu',
  quelle.includes("if (menue && !menue.hidden && !menue.contains(e.target)) awSchnellZu();")
  && quelle.includes("document.addEventListener('keydown', e => { if (e.key === 'Escape') awSchnellZu(); });")
  && quelle.includes("window.addEventListener('scroll', () => awSchnellZu(), true);"));

console.log(`\n${ok} Pruefungen ok`);
process.exit(0);
