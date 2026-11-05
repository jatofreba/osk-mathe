// Fachbuero: "Alle auswählen" im Einladen-Fenster der Lernbegleitung (Nutzerwunsch 2026-11-05:
// zu einem Fachbuero alle einladen) - Seite und Server zusammen. Hakt alle angezeigten an bzw.
// ab (bei aktiver Suche nur die Treffer), zeigt halb, wenn nur einige gewaehlt sind; wer zur
// selben Zeit schon einen Termin hat, kommt wie bisher als Konflikt zurueck.
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

const quelle = lies('public/index.html');
const db = new PGlite();
const srv = await ladeServer(lies('server.js'), db);
const eins = async (sql, p) => (await db.query(sql, p || [])).rows[0];
const alle = async (sql, p) => (await db.query(sql, p || [])).rows;
const F = {};
for (const r of await alle(`SELECT id, key FROM subjects`)) F[r.key] = r.id;
const neu = async (name, rolle = 'student', aktiv = true) => (await eins(
  `INSERT INTO users (username, password_hash, klasse, role, aktiv) VALUES ($1,'x','M3M4',$2,$3) RETURNING id`, [name, rolle, aktiv])).id;
const LB = await neu('lb_alle', 'admin');
const P = {};
for (const n of ['ana', 'ben', 'cem', 'dia', 'eva', 'fin']) P[n] = await neu(n);
P.pia = await neu('pia', 'student', false);           // passiv - wird nicht angeboten
const tag = n => { const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const slot = async (datum, uhr, thema) => (await eins(
  `INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
   VALUES ('M3M4',$1,$2,'R1','2627_1',$3,'input',45,$4,$5) RETURNING id`, [datum, uhr, LB, F.mathe, thema])).id;
const teilnahmen = async slotId => (await alle(
  `SELECT u.username FROM talking_invitations ti JOIN talking_sessions ts ON ts.id = ti.session_id
   JOIN users u ON u.id = ti.listener_id WHERE ts.slot_id=$1 ORDER BY u.username`, [slotId])).map(z => z.username);

// s1: Fachbuero in drei Tagen um 10:00. fin hat zur selben Zeit schon ein anderes Fachbuero.
const s1 = await slot(tag(3), '10:00', 'Brüche üben');
const s0 = await slot(tag(3), '10:00', '');
let r = await srv.rufe('post', '/api/talking-sessions', { session: { userId: P.fin, role: 'student', klasse: 'M3M4' },
  body: { slotId: s0, thema: 'Anderes', inviteeIds: [] } });
pruefe('V0 fin hat um 10:00 schon ein Fachbuero', r.code === 200, r.body);
const s2 = await slot(tag(4), '12:00', 'Prozente');

// ── Seite, verbunden mit dem Server ──────────────────────────────────────────
const seite = ladeSeite();
const wer = { userId: LB, username: 'lb_alle', role: 'admin', klasse: 'M3M4', superAdmin: false };
let offen = 0;
const serverFetch = srv.fetchFuer(() => ({ userId: wer.userId, role: wer.role, klasse: wer.klasse }));
seite.kontext.fetch = async (...a) => { offen++; try { return await serverFetch(...a); } finally { offen--; } };
const meldungen = [];
seite.kontext.alert = t => meldungen.push(String(t));
const lauf = (code, werte) => seite.lauf(code, werte);
const ruhe = async () => { do { await new Promise(r => setTimeout(r, 5)); } while (offen > 0); await new Promise(r => setTimeout(r, 5)); };
const html = id => seite.element(id).innerHTML;
await lauf(`me = __werte.me; subjectsMeta = []; loadSubjectsMeta()`, { me: wer });
await ruhe();
const kalender = async () => {
  await lauf(`(async () => { calData = await (await fetch('/api/calendar')).json();
    calClassmates = await (await fetch('/api/classmates')).json(); })()`);
};
// Die Attrappe kennt kein echtes DOM: die gerenderten Zeilen werden zu Objekten mit Kaestchen,
// querySelectorAll beantwortet die Abfragen der Seite daraus.
let zeilen = [];
seite.setzeQsa(sel => sel === '#iassign-classmates label[data-name]' ? zeilen
  : sel === '.iassign-cm-cb:checked' ? zeilen.map(z => z.cb).filter(c => c.checked) : []);
// nachOeffnen: wie "Alle" direkt nach dem Oeffnen steht - die Seite muss es selbst zuruecksetzen
// (die Attrappe sieht dabei noch keine Zeilen, im Browser sind es die frisch gerenderten).
let nachOeffnen = null;
const oeffne = slotId => {
  zeilen = [];
  lauf(`openInputAssignModal(${slotId})`);
  nachOeffnen = { checked: kasten().checked, halb: kasten().indeterminate };
  zeilen = [...html('iassign-classmates').matchAll(
    /<label data-name="([^"]+)"[^>]*>\s*<input type="checkbox" value="(\d+)" class="iassign-cm-cb" onchange="([^"]*)">/g)]
    .map(m => { const z = { dataset: { name: m[1] }, hidden: false, onchange: m[3], cb: { value: m[2], checked: false } };
      z.querySelector = () => z.cb; return z; });
  // Wie im Browser: frisch gerendert, also nichts angehakt - die Zahl kommt aus den Zeilen.
  lauf(`personenAlleStand('iassign-classmates')`);
};
const kasten = () => seite.element('iassign-classmates-alle');
const text = () => seite.element('iassign-classmates-alle-text').textContent;
const an = () => zeilen.filter(z => z.cb.checked).map(z => z.dataset.name).join(',');

// ── M) Markup ────────────────────────────────────────────────────────────────
pruefe('M1 "Alle auswählen" sitzt zwischen Suchfeld und Liste und wirkt auf genau diese Liste',
  /id="iassign-suche"[\s\S]*?<label class="personen-alle" id="iassign-classmates-alle-zeile" hidden>\s*<input type="checkbox" id="iassign-classmates-alle" aria-controls="iassign-classmates"\s*onchange="personenAlleWaehlen\('iassign-classmates', this.checked\)">\s*<span id="iassign-classmates-alle-text">Alle auswählen<\/span><\/label>[\s\S]*?id="iassign-classmates" /.test(quelle));
pruefe('M2 versteckt heisst versteckt (die Zeile ist sonst display:flex)', quelle.includes('.personen-alle[hidden]{display:none !important;}'));

// ── A) alle an, alle ab, halb ────────────────────────────────────────────────
await kalender();
oeffne(s1);
pruefe('A1 sechs Personen zur Wahl (die passive pia nicht), jede meldet ihren Haken an "Alle"',
  zeilen.map(z => z.dataset.name).join() === 'ana,ben,cem,dia,eva,fin'
  && zeilen.every(z => z.onchange === `personenAlleStand('iassign-classmates')`), zeilen.map(z => [z.dataset.name, z.onchange]));
pruefe('A2 "Alle auswählen (6)" ist zu sehen, ohne Haken', seite.element('iassign-classmates-alle-zeile').hidden === false
  && text() === 'Alle auswählen (6)' && kasten().checked === false && kasten().indeterminate === false && kasten().disabled === false, text());
lauf(`personenAlleWaehlen('iassign-classmates', true)`);
pruefe('A3 angehakt: alle sechs gewaehlt', an() === 'ana,ben,cem,dia,eva,fin' && kasten().checked === true && kasten().indeterminate === false, an());
zeilen[1].cb.checked = false;
lauf(zeilen[1].onchange);
pruefe('A4 ben einzeln abgewaehlt: "Alle" steht auf halb', kasten().checked === false && kasten().indeterminate === true, [kasten().checked, kasten().indeterminate]);
zeilen[1].cb.checked = true;
lauf(zeilen[1].onchange);
pruefe('A5 wieder dazu: "Alle" ist wieder ganz an', kasten().checked === true && kasten().indeterminate === false);
lauf(`personenAlleWaehlen('iassign-classmates', false)`);
pruefe('A6 abgehakt: niemand mehr gewaehlt', an() === '' && kasten().checked === false && kasten().indeterminate === false, an());

// ── S) mit Suche: nur wen man sieht ──────────────────────────────────────────
lauf(`personenFiltern('iassign-classmates', 'e')`);
pruefe('S1 Suche "e": ben, cem, eva - der Text sagt "angezeigten"',
  zeilen.filter(z => !z.hidden).map(z => z.dataset.name).join() === 'ben,cem,eva' && text() === 'Alle angezeigten auswählen (3)', text());
lauf(`personenAlleWaehlen('iassign-classmates', true)`);
pruefe('S2 angehakt: nur die drei Treffer, die anderen bleiben frei', an() === 'ben,cem,eva' && kasten().checked === true, an());
lauf(`personenFiltern('iassign-classmates', '')`);
pruefe('S3 Suche geleert: drei von sechs - "Alle" halb, Text wieder ohne "angezeigten"',
  kasten().checked === false && kasten().indeterminate === true && text() === 'Alle auswählen (6)', [text(), kasten().indeterminate]);
lauf(`personenAlleWaehlen('iassign-classmates', false); personenFiltern('iassign-classmates', 'zz')`);
pruefe('S4 kein Treffer: "Alle" ist aus und ohne Zahl', kasten().disabled === true && kasten().checked === false && text() === 'Alle auswählen', text());
lauf(`personenFiltern('iassign-classmates', '')`);
pruefe('S5 wieder alle da: "Alle" geht wieder', kasten().disabled === false && text() === 'Alle auswählen (6)', text());

// ── E) alle einladen ─────────────────────────────────────────────────────────
lauf(`personenAlleWaehlen('iassign-classmates', true)`);
pruefe('E0 das Thema steht schon da (am Termin ausgeschrieben)', seite.element('iassign-thema').value === 'Brüche üben', seite.element('iassign-thema').value);
await lauf('submitInputAssign()'); await ruhe();
pruefe('E1 alle eingeladen - ausser fin, die zur selben Zeit schon einen Termin hat',
  (await teilnahmen(s1)).join() === 'ana,ben,cem,dia,eva', await teilnahmen(s1));
pruefe('E2 fin kommt als Konflikt zurueck', meldungen.length === 1 && meldungen[0].includes('fin') && meldungen[0].includes('Terminkonflikt'), meldungen);
const st = await eins(`SELECT ti.status, ti.herkunft FROM talking_invitations ti JOIN talking_sessions ts ON ts.id = ti.session_id
  WHERE ts.slot_id=$1 AND ti.listener_id=$2`, [s1, P.ana]);
pruefe('E3 wie bisher: zugewiesen und dabei', st.status === 'angenommen' && st.herkunft === 'zugewiesen', st);

// ── W) wieder oeffnen ────────────────────────────────────────────────────────
await kalender();
oeffne(s1);
pruefe('W1 nur noch fin zur Wahl: "Alle auswählen" ist versteckt (ihr eigener Haken reicht)',
  zeilen.map(z => z.dataset.name).join() === 'fin' && seite.element('iassign-classmates-alle-zeile').hidden === true, zeilen.map(z => z.dataset.name));
pruefe('W1b der Haken von eben (alle eingeladen) ist beim Oeffnen schon weg', nachOeffnen.checked === false && nachOeffnen.halb === false, nachOeffnen);
oeffne(s2);
pruefe('W2 anderes Fachbuero: "Alle" frisch - ohne Haken vom letzten Mal', seite.element('iassign-classmates-alle-zeile').hidden === false
  && kasten().checked === false && kasten().indeterminate === false && text() === 'Alle auswählen (6)', [text(), kasten().checked]);
pruefe('W3 die Suche ist leer und "Niemand gefunden." aus', seite.element('iassign-suche').value === ''
  && seite.element('iassign-classmates-keiner').hidden === true);

console.log(`\n${ok} Pruefungen ok`);
process.exit(0);
