// Wunschliste und Personensuche auf der Seite (Nutzerwunsch 2026-11-04) - Seite und Server
// ZUSAMMEN (seite_im_test + server_im_test, pglite):
//  - Lernbegleitung: Wuensche nach Fach - normale Admins zuerst nur ihr Standard-Fach,
//    Super-Admins alle; umschaltbar wie bei den Talks (mit Zahl der offenen je Fach)
//  - Schueler:innen: am eigenen Wunsch "✓ Dein Wunsch" statt "ich auch"-Schalter
//  - Suchfeld ueber den Personenlisten der Termine (FaBue einladen, buchen, Talk-Auswahl,
//    Talk-Beteiligte) und in der Tandem-Uebersicht
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
const neu = async (name, rolle = 'student') => (await eins(
  `INSERT INTO users (username, password_hash, klasse, role) VALUES ($1,'x','M3M4',$2) RETURNING id`, [name, rolle])).id;
const LB = await neu('lb', 'admin');
const P = {};
for (const n of ['ana', 'ben', 'cem', 'dia']) P[n] = await neu(n);
const wunsch = async (wer, titel, fach) => (await srv.rufe('post', '/api/wuensche',
  { session: { userId: wer, role: 'student', klasse: 'M3M4' }, body: { titel, subjectId: fach } })).body.id;
const w1 = await wunsch(P.ana, 'Brüche', F.mathe);
const w2 = await wunsch(P.ben, 'Prozente', F.mathe);
const w3 = await wunsch(P.cem, 'Tenses', F.englisch);

// ── Seite, verbunden mit dem Server ──────────────────────────────────────────
const seite = ladeSeite();
let wer = { userId: LB, username: 'lb', role: 'admin', klasse: 'M3M4', superAdmin: false, defaultSubjectId: F.englisch };
let offen = 0;
const serverFetch = srv.fetchFuer(() => ({ userId: wer.userId, role: wer.role, klasse: wer.klasse }));
seite.kontext.fetch = async (...a) => { offen++; try { return await serverFetch(...a); } finally { offen--; } };
const ruhe = async () => { do { await new Promise(r => setTimeout(r, 5)); } while (offen > 0); await new Promise(r => setTimeout(r, 5)); };
const lauf = (code, werte) => seite.lauf(code, werte);
const html = id => seite.element(id).innerHTML;
const alsLb = async (zusatz) => {
  wer = { userId: LB, username: 'lb', role: 'admin', klasse: 'M3M4', superAdmin: false, defaultSubjectId: F.englisch, ...zusatz };
  await lauf(`me = __werte.me; _wuFach = null; loadSubjectsMeta(); loadWuensche()`, { me: wer });
  await ruhe();
  return html('cal-wuensche');
};
const knopf = (h, text) => (h.match(new RegExp(`<button type="button" class="subject-btn( active)?" aria-pressed="(true|false)"[^>]*>${text}</button>`)) || [])[2];

// ── F) Fach-Ansicht der Lernbegleitung ───────────────────────────────────────
let h = await alsLb();
pruefe('F1 normale Lernbegleitung (Englisch): zuerst nur die Englisch-Wuensche',
  h.includes('Tenses') && !h.includes('Brüche') && !h.includes('Prozente') && h.includes('1 offen in Englisch'), h);
pruefe('F2 Fach-Knoepfe wie bei den Talks, mit Zahl der offenen - Englisch gedrueckt',
  knopf(h, 'Englisch · 1') === 'true' && knopf(h, 'Mathe · 2') === 'false' && knopf(h, 'Deutsch · 0') === 'false'
  && knopf(h, 'Alle · 3') === 'false' && h.includes('aria-label="Wünsche nach Fach"'), h);
pruefe('F3 die Lernberatung (nur fuer Zugeordnete) bekommt keinen Knopf', !h.includes('Lernberatung ·'), h);
lauf(`wunschFachWaehlen('${F.mathe}')`);
h = html('cal-wuensche');
pruefe('F4 auf Mathe umgeschaltet', h.includes('Brüche') && h.includes('Prozente') && !h.includes('Tenses')
  && knopf(h, 'Mathe · 2') === 'true' && h.includes('2 offen in Mathe'), h);
await lauf('loadWuensche()'); await ruhe();
pruefe('F5 die Wahl bleibt beim Neuladen der Wuensche', knopf(html('cal-wuensche'), 'Mathe · 2') === 'true', html('cal-wuensche'));
lauf(`wunschFachWaehlen('')`);
h = html('cal-wuensche');
pruefe('F6 "Alle": alle drei', ['Brüche', 'Prozente', 'Tenses'].every(t => h.includes(t)) && knopf(h, 'Alle · 3') === 'true'
  && h.includes('3 offen · nach'), h);
lauf(`wunschFachWaehlen('${F.deutsch}')`);
pruefe('F7 Fach ohne Wuensche: eigener Hinweis', html('cal-wuensche').includes('Gerade keine offenen Wünsche in Deutsch.'), html('cal-wuensche'));
h = await alsLb({ superAdmin: true });
pruefe('F8 Super-Admin: zuerst alle', knopf(h, 'Alle · 3') === 'true' && h.includes('Brüche') && h.includes('Tenses'), h);
h = await alsLb({ defaultSubjectId: null });
pruefe('F9 ohne Standard-Fach: zuerst alle', knopf(h, 'Alle · 3') === 'true', h);
h = await alsLb({ defaultSubjectId: F.lernberatung });
pruefe('F10 Standard-Fach Lernberatung (keine Wuensche moeglich): zuerst alle', knopf(h, 'Alle · 3') === 'true', h);
await db.query(`UPDATE wunsch SET status='abgelehnt', notiz='schon dran' WHERE id=$1`, [w2]);
h = await alsLb();
lauf(`wunschFachWaehlen('${F.mathe}')`);
h = html('cal-wuensche');
pruefe('F11 auch "Schon bearbeitet" folgt dem Fach', h.includes('Schon bearbeitet:') && h.includes('Prozente') && knopf(h, 'Mathe · 1') === 'true', h);
lauf(`wunschFachWaehlen('${F.englisch}')`);
pruefe('F12 ... im anderen Fach steht es nicht', !html('cal-wuensche').includes('Prozente') && !html('cal-wuensche').includes('Schon bearbeitet:'), html('cal-wuensche'));
await db.query(`UPDATE wunsch SET status='offen', notiz='' WHERE id=$1`, [w2]);

// ── S) Schueler:innen: eigener Wunsch ────────────────────────────────────────
wer = { userId: P.ana, username: 'ana', role: 'student', klasse: 'M3M4' };
await lauf(`me = __werte.me; loadWuensche()`, { me: wer }); await ruhe();
h = html('home-wuensche');
const zeileVon = (h, titel) => { const a = h.lastIndexOf('<div class="wu-zeile">', h.indexOf(titel)); return h.slice(a, h.indexOf('<div class="wu-zeile">', a + 5) > 0 ? h.indexOf('<div class="wu-zeile">', a + 5) : undefined); };
pruefe('S1 am eigenen Wunsch: "✓ Dein Wunsch", kein Schalter - zurueckziehen bleibt',
  zeileVon(h, 'Brüche').includes('✓ Dein Wunsch') && !zeileVon(h, 'Brüche').includes(`wunschInteresse(${w1})`)
  && zeileVon(h, 'Brüche').includes(`wunschLoeschen(${w1})`), zeileVon(h, 'Brüche'));
pruefe('S2 an fremden Wuenschen wie bisher "+ Ich auch"',
  zeileVon(h, 'Prozente').includes(`wunschInteresse(${w2})`) && zeileVon(h, 'Prozente').includes('+ Ich auch')
  && !zeileVon(h, 'Prozente').includes('Dein Wunsch'), zeileVon(h, 'Prozente'));

// ── T) Tandem-Uebersicht: Suche ──────────────────────────────────────────────
wer = { userId: LB, username: 'lb', role: 'admin', klasse: 'M3M4', superAdmin: false, defaultSubjectId: F.mathe };
lauf(`me = __werte.me`, { me: wer });
const schueler = ['ana', 'ben', 'cem', 'dia'].map((n, i) => ({ id: P[n], username: n, kurs: 'E', aktiv: true, created_at: `2026-09-0${i + 1}` }));
lauf(`allStudents = __werte.s`, { s: schueler });
const reihen = () => [...html('klasse-tbl').matchAll(/<tr data-name="([^"]+)"/g)].map(m => m[1]).sort().join(',');
pruefe('T0 das Suchfeld steht ueber der Tabelle', lies('public/index.html').includes('id="klasse-suche"'));
lauf('renderKlasseTable()');
pruefe('T1 ohne Suche: alle', reihen() === 'ana,ben,cem,dia', html('klasse-tbl'));
seite.element('klasse-suche').value = 'A';
lauf('renderKlasseTable()');
pruefe('T2 "A" (Gross/klein egal): ana und dia', reihen() === 'ana,dia', html('klasse-tbl'));
seite.element('klasse-suche').value = '  be ';
lauf('renderKlasseTable()');
pruefe('T3 Leerzeichen zaehlen nicht: ben', reihen() === 'ben', html('klasse-tbl'));
seite.element('klasse-suche').value = 'zz';
lauf('renderKlasseTable()');
pruefe('T4 kein Treffer: Hinweis statt leerer Tabelle', html('klasse-tbl').includes('Niemand gefunden für „zz“') && reihen() === '', html('klasse-tbl'));
seite.element('klasse-suche').value = '';

// ── P) Personenlisten der Termine ────────────────────────────────────────────
const quelle = lies('public/index.html');
pruefe('P0 versteckte Zeilen bleiben versteckt, obwohl sie display:flex im style tragen',
  quelle.includes('label[data-name][hidden]{display:none !important;}'));
const leute = schueler.map(s => ({ id: s.id, username: s.username }));
lauf(`calClassmates = __werte.l; calData = __werte.kal`, { l: leute, kal: { slots: [
  { id: 900, typ: 'input', subjectId: F.mathe, datum: '2099-01-05', uhrzeit: '10:00', dauer: 45, ort: 'R1', booked: true,
    session_id: 90, presenterUsername: 'ana', invitees: [{ username: 'ben', status: 'angenommen' }] },
  { id: 901, typ: 'input', subjectId: F.mathe, datum: '2099-01-06', uhrzeit: '10:00', dauer: 45, ort: 'R1', booked: false },
  { id: 902, typ: 'talk', subjectId: F.mathe, datum: '2099-01-07', uhrzeit: '10:00', dauer: 45, booked: true, session_id: 92,
    presenterUsername: 'ana', coPresenters: [], invitees: [{ id: 7, username: 'cem', status: 'angenommen', attendedStatus: 'ausstehend' }] },
] } });

// FaBue: Schueler:innen einladen
seite.element('iassign-suche').value = 'alt';
lauf('openInputAssignModal(900)');
h = html('iassign-classmates');
pruefe('P1 FaBü einladen: Suchfeld leer beim Oeffnen, Zeilen tragen den Namen fuer die Suche',
  seite.element('iassign-suche').value === '' && seite.element('iassign-classmates-keiner').hidden === true
  && h.includes('data-name="cem"') && h.includes('data-name="dia"') && !h.includes('data-name="ana"') && !h.includes('data-name="ben"'), h);
pruefe('P2 das Suchfeld filtert genau diese Liste',
  /id="iassign-suche"[^>]*aria-controls="iassign-classmates"[^>]*oninput="personenFiltern\('iassign-classmates', this.value\)"/.test(quelle));

// personenFiltern mit nachgebauten Zeilen (die Attrappe kennt kein echtes DOM)
const zeilen = ['ana', 'ben', 'cem', 'dia'].map(n => ({ dataset: { name: n }, hidden: false, cb: { checked: false } }));
zeilen.forEach(z => { z.querySelector = () => z.cb; });
seite.setzeQsa(sel => sel === '#iassign-classmates label[data-name]' ? zeilen : []);
const sichtbar = () => zeilen.filter(z => !z.hidden).map(z => z.dataset.name).join(',');
lauf(`personenFiltern('iassign-classmates', 'BE')`);
pruefe('P3 "BE": nur ben', sichtbar() === 'ben' && seite.element('iassign-classmates-keiner').hidden === true, sichtbar());
zeilen[2].cb.checked = true;
lauf(`personenFiltern('iassign-classmates', 'be')`);
pruefe('P4 wer schon einen Haken hat (cem), bleibt sichtbar', sichtbar() === 'ben,cem', sichtbar());
zeilen[2].cb.checked = false;
lauf(`personenFiltern('iassign-classmates', 'zz')`);
pruefe('P5 kein Treffer: alle aus, "Niemand gefunden." an', sichtbar() === '' && seite.element('iassign-classmates-keiner').hidden === false, sichtbar());
lauf(`personenFiltern('iassign-classmates', '')`);
pruefe('P6 leer: alle wieder da, Hinweis aus', sichtbar() === 'ana,ben,cem,dia' && seite.element('iassign-classmates-keiner').hidden === true, sichtbar());
seite.setzeQsa(() => []);

// FaBue buchen (Schueler:innen bringen jemanden mit)
seite.element('calbook-suche').value = 'alt';
lauf('openCalBookModal(901)');
pruefe('P7 FaBü buchen: Suchfeld leer, Zeilen mit Namen',
  seite.element('calbook-suche').value === '' && html('calbook-classmates').includes('data-name="ben"')
  && /id="calbook-suche"[^>]*oninput="personenFiltern\('calbook-classmates', this.value\)"/.test(quelle), html('calbook-classmates'));

// Talk-Auswahl (wer vortraegt, wer zuhoert): ein Suchfeld fuer beide Listen
h = lauf(`talkAuswahlHtml('tbook', __werte.l, { minV: 1, maxV: 2, minZ: 2, maxZ: 5 })`, { l: leute });
pruefe('P8 Talk-Auswahl: ein Suchfeld ueber beiden Listen, Zeilen mit Namen',
  h.startsWith('<div id="tbook-personen">') && (h.match(/personen-suche/g) || []).length === 1
  && h.includes(`personenFiltern('tbook-personen', this.value)`) && h.includes('id="tbook-personen-keiner"')
  && (h.match(/data-name="ana"/g) || []).length === 2, h);
h = lauf(`talkAuswahlHtml('tinvite', [], { minV: 1, maxV: 1, minZ: 2, maxZ: 5 }, { mit: 0, zu: 0 })`);
pruefe('P9 ohne Personen kein Suchfeld', !h.includes('personen-suche'), h);
h = lauf(`talkAuswahlHtml('tinvite', __werte.l, { minV: 1, maxV: 1, minZ: 2, maxZ: 2 }, { mit: 0, zu: 2 })`, { l: leute });
pruefe('P10 wenn nichts mehr passt, auch kein Suchfeld', !h.includes('personen-suche') && h.includes('mehr passen nicht'), h);

// Talk: Beteiligte bearbeiten (Auswahlliste)
seite.element('tbet-suche').value = 'alt';
lauf(`openTalkBeteiligte(92, 'kalender')`);
const optionen = () => [...html('tbet-person').matchAll(/<option value="(\d*)">([^<]*)<\/option>/g)].map(m => m[2]);
pruefe('P11 Beteiligte: beim Oeffnen leer, alle ausser der buchenden Person',
  seite.element('tbet-suche').value === '' && optionen().join('|') === '– Person wählen –|ben|cem (hört zu)|dia', optionen());
seite.element('tbet-suche').value = 'E';
lauf('talkBeteiligteOptionen()');
pruefe('P12 "E": ben und cem', optionen().join('|') === '– Person wählen –|ben|cem (hört zu)' && seite.element('tbet-person').value === '', optionen());
seite.element('tbet-person').value = String(P.ben);
seite.element('tbet-suche').value = 'e';
lauf('talkBeteiligteOptionen()');
pruefe('P12b wer schon gewaehlt ist und noch passt, bleibt gewaehlt',
  optionen().join('|') === '– Person wählen –|ben|cem (hört zu)' && seite.element('tbet-person').value === String(P.ben),
  [optionen(), seite.element('tbet-person').value]);
seite.element('tbet-person').value = String(P.ben);
seite.element('tbet-suche').value = 'c';
lauf('talkBeteiligteOptionen()');
pruefe('P13 genau ein Treffer: gleich gewaehlt (ein Klick auf die Rolle genuegt)',
  optionen().join('|') === 'cem (hört zu)' && seite.element('tbet-person').value === String(P.cem), optionen());
seite.element('tbet-suche').value = 'zz';
lauf('talkBeteiligteOptionen()');
pruefe('P14 kein Treffer: "– niemand gefunden –", nichts gewaehlt',
  optionen().join('|') === '– niemand gefunden –' && seite.element('tbet-person').value === '', optionen());
seite.element('tbet-suche').value = '';
seite.element('tbet-person').value = String(P.ben);
lauf('talkBeteiligteRender()');
pruefe('P14b neu gezeichnet (Oeffnen, nach einer Aktion): wieder "– Person wählen –" wie vorher',
  seite.element('tbet-person').value === '' && optionen()[0] === '– Person wählen –', [optionen(), seite.element('tbet-person').value]);
pruefe('P15 das Suchfeld sitzt ueber der Auswahlliste',
  /id="tbet-suche"[^>]*oninput="talkBeteiligteOptionen\(\)">\s*<select class="form-input" id="tbet-person">/.test(quelle));

console.log(`\n${ok} Pruefungen ok`);
process.exit(0);
