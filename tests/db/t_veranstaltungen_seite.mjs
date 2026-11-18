// Veranstaltungen auf der Seite (Nutzerwunsch 2026-11-18) - Seite und Server ZUSAMMEN (pglite):
//  - Admin-Woche: ganztaegige in eigener Zeile, die uebrigen als Kachel in ihren Bloecken;
//    Felder der ganzen Gruppe bieten kein Anlegen, jedes Feld "📌 Veranstaltung eintragen …",
//  - Formular: vorbelegt aus dem Feld, Pruefschritt mit Kollisionen ("Trotzdem speichern", freie
//    loeschen), aendern, loeschen, Eingabefehler; Liste in Mein Kalender; Monat und Tag,
//  - Anlegen in gesperrter Zeit: Meldung bzw. ausgelassene Tage einer Reihe,
//  - Schueler:innen: Kachel, Sperre ("✕ In dieser Zeit bist du bei …"), Kalender ohne Bearbeiten.
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
  `INSERT INTO users (username, password_hash, klasse, role, created_at, default_subject_id) VALUES ($1,'x','M3M4',$2, NOW() - INTERVAL '2 years', $3) RETURNING id`,
  [name, rolle, rolle === 'admin' ? F.mathe : null])).id;
const LB = await neu('lb', 'admin');
const P = {};
for (const n of ['ada', 'bo', 'cleo', 'dan']) P[n] = await neu(n);
const A = { userId: LB, role: 'admin', klasse: 'M3M4' };

const seite = ladeSeite();
let wer = { userId: LB, username: 'lb', role: 'admin', klasse: 'M3M4', superAdmin: false, defaultSubjectId: F.mathe };
let offen = 0;
const serverFetch = srv.fetchFuer(() => ({ userId: wer.userId, role: wer.role, klasse: wer.klasse }));
seite.kontext.fetch = async (...a) => { offen++; try { return await serverFetch(...a); } finally { offen--; } };
const meldungen = [], fragen = [];
seite.kontext.alert = t => meldungen.push(String(t));
seite.kontext.confirm = t => { fragen.push(String(t)); return true; };
const ruhe = async () => { do { await new Promise(r => setTimeout(r, 5)); } while (offen > 0); await new Promise(r => setTimeout(r, 5)); };
const lauf = (code, werte) => seite.lauf(code, werte);
const html = id => seite.element(id).innerHTML;
const wert = id => seite.element(id).value;
lauf(`globalThis.__offen = []; { const om = openModal, cm = closeModal;
  openModal = (id) => { __offen.push('auf:' + id); return om(id); }; closeModal = (id) => { __offen.push('zu:' + id); return cm(id); }; }`);
await lauf(`me = __werte.me; activeSubject = 'mathe'; loadSubjectsMeta()`, { me: wer }); await ruhe();

// Naechste Woche Mo-Fr.
const T = lauf(`(() => { const m = lwMonday(); m.setDate(m.getDate() + 7);
  return [0, 1, 2, 3, 4].map(i => { const d = new Date(m); d.setDate(m.getDate() + i); return lwDateStr(d); }); })()`);
const neueVst = async body => (await srv.rufe('post', '/api/admin/veranstaltungen', { session: A, body })).body.id;
const ilepsId = await neueVst({ titel: 'ILePs', datumVon: T[0], alle: true });
const laienId = await neueVst({ titel: 'Laienreanimation', datumVon: T[3], von: '10:45', bis: '12:15', alle: false, personen: [P.ada, P.bo] });
const forumId = await neueVst({ titel: 'Forumstheater', datumVon: T[4], von: '08:45', bis: '10:15', alle: true });
// Nur die erste Haelfte des 1. Blocks - die zweite schliesst direkt an (Grenzfall).
const halbId = await neueVst({ titel: 'Elternabend-Probe', datumVon: T[1], von: '08:45', bis: '09:30', alle: true });
const slot = async (datum, uhr, typ = 'input') => (await eins(
  `INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
   VALUES ('M3M4',$1,$2,'R1','2627_1',$3,$4,45,$5,'') RETURNING id`, [datum, uhr, LB, typ, F.mathe])).id;
const fbDo = await slot(T[3], '11:30');                       // freies FaBue in der Laienreanimation
const fbMiFrei = await slot(T[2], '10:45');                   // Mittwoch 2. Block: frei ...
const fbMiGeb = await slot(T[2], '11:30');                    // ... und gebucht von dan
await eins(`INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,'Dan') RETURNING id`, [fbMiGeb, P.dan]);

const woche = async () => { await lauf(`_awWoche = 1; loadCalendar()`); await ruhe(); return html('cal-adminweek'); };

// ── W) Admin-Woche ───────────────────────────────────────────────────────────
let h = await woche();
const ganz = h.slice(h.indexOf('📌 Veranstaltung<span>ganztägig</span>'), h.indexOf('1. Block (1/2)'));
pruefe('W1 ganztaegige Zeile: ILePs am Montag, antippbar', ganz.includes(`onclick="openVeranstaltung(${ilepsId})"`)
  && ganz.includes('📌 ILePs') && ganz.includes('ganzer Tag · ganze Gruppe') && !ganz.includes('Laienreanimation'), ganz.slice(0, 600));
const zellen = [...h.matchAll(/<div class="lw-cell[^>]*>/g)].map(m => m.index);
const zelle = (bi, di) => { const i = 5 + bi * 5 + di; return h.slice(zellen[i], zellen[i + 1] || h.length); };  // erste 5 = ganztaegige Zeile
pruefe('W2 Laienreanimation steht Do im 2. Block (beide Haelften), mit den Namen', [2, 3].every(bi => zelle(bi, 3).includes('📌 Laienreanimation')
  && zelle(bi, 3).includes('10:45–12:15 · ada, bo')) && !zelle(1, 3).includes('Laienreanimation') && !zelle(4, 3).includes('Laienreanimation'), zelle(2, 3).slice(0, 400));
pruefe('W3 Forumstheater Fr im 1. Block', [0, 1].every(bi => zelle(bi, 4).includes('📌 Forumstheater')) && !zelle(2, 4).includes('Forumstheater'));
pruefe('W4 Montag (ILePs, ganze Gruppe): kein ＋ in den Feldern; Do 2. Block (nur einzelne) schon',
  [0, 1, 2, 3, 4].every(bi => !zelle(bi, 0).includes('aw-feld-frei')) && zelle(2, 3).includes('aw-feld-frei'), zelle(0, 0).slice(0, 200));
pruefe('W5 Legende erklaert 📌', h.includes('📌 Veranstaltung – ganze Gruppe: dort wird nichts angelegt'));

const klick = (datum, bi) => lauf(`awFeldKlick({ type: 'click', clientX: 10, clientY: 10, target: { closest: () => null }, preventDefault() {} }, __werte.d, ${bi})`, { d: datum });
klick(T[0], 1);
let m = html('aw-schnell');
pruefe('W6 Menue im ILePs-Feld: Hinweis, kein Anlegen, aber "📌 Veranstaltung eintragen …"',
  m.includes('📌 ILePs (ganze Gruppe) – hier wird nichts angelegt.') && !m.includes('awSchnellAnlegen(')
  && m.includes('onclick="awSchnellVeranstaltung()">📌 Veranstaltung eintragen …</button>'), m);
klick(T[4], 1);
pruefe('W7 Fr 1. Block (2/2) ebenso gesperrt', html('aw-schnell').includes('📌 Forumstheater (ganze Gruppe)'), html('aw-schnell'));
klick(T[3], 2);
pruefe('W8 Do 2. Block (Laienreanimation nur einzelne): Anlegen geht', html('aw-schnell').includes('＋ Mathe-FaBü · 10:45–11:30'), html('aw-schnell'));
pruefe('W9 Grenzfall: Di 1. Block (1/2) gesperrt, (2/2) direkt danach nicht', zelle(0, 1).includes('📌 Elternabend-Probe')
  && !zelle(1, 1).includes('Elternabend-Probe') && !zelle(0, 1).includes('aw-feld-frei') && zelle(1, 1).includes('aw-feld-frei'), zelle(1, 1).slice(0, 300));
klick(T[1], 1);
pruefe('W9b ... und dort laesst sich anlegen', html('aw-schnell').includes('＋ Mathe-FaBü · 09:30–10:15'), html('aw-schnell'));

// ── F) Formular aus dem Feld ─────────────────────────────────────────────────
klick(T[2], 2);
lauf(`__offen.length = 0; awSchnellVeranstaltung()`);
pruefe('F1 aus dem Feld Mi 2. Block (1/2): Tag und Block vorbelegt, ganze Gruppe, Menue zu',
  lauf('__offen.join()') === 'auf:modal-veranstaltung' && seite.element('aw-schnell').hidden === true
  && wert('vst-von-tag') === T[2] && wert('vst-bis-tag') === T[2] && wert('vst-zeit') === 'bloecke'
  && wert('vst-block-von') === '2' && wert('vst-block-bis') === '2' && seite.element('vst-alle').checked
  && seite.element('vst-bloecke').style.display === 'flex' && seite.element('vst-personen-box').style.display === 'none'
  && seite.element('vst-loeschen').style.display === 'none' && seite.element('vst-kopf').textContent === '📌 Veranstaltung eintragen',
  ['vst-von-tag', 'vst-bis-tag', 'vst-zeit', 'vst-block-von', 'vst-block-bis'].map(wert));
await lauf('vstSpeichern()'); await ruhe();
pruefe('F2 ohne Titel: Hinweis', seite.element('vst-error').textContent === 'Bitte angeben, was stattfindet.');
seite.element('vst-titel').value = 'Sporttag';
seite.element('vst-block-bis').value = '3';
await lauf('vstSpeichern()'); await ruhe();
const k = html('vst-kollisionen');
pruefe('F3 Pruefschritt: freier und gebuchter Termin im 2. Block, Haken "freie loeschen" gesetzt, Knopf "Trotzdem speichern"',
  k.includes('1 freier Termin:') && k.includes('10:45 · Mathe-FaBü') && k.includes('<input type="checkbox" id="vst-frei-loeschen" checked>')
  && k.includes('11:30 · Mathe-FaBü – dan') && seite.element('vst-speichern').textContent === 'Trotzdem speichern'
  && !(await eins(`SELECT 1 FROM veranstaltungen WHERE titel='Sporttag'`)), k);
seite.element('vst-titel').value = 'Sporttag!';
lauf('vstGeaendert()');
pruefe('F4 nach einer Aenderung: Liste weg, wieder "Speichern"', html('vst-kollisionen') === '' && seite.element('vst-speichern').textContent === 'Speichern');
await lauf('vstSpeichern()'); await ruhe();
seite.element('vst-frei-loeschen').checked = true;
lauf('__offen.length = 0');
await lauf('vstSpeichern()'); await ruhe();
const sport = await eins(`SELECT id, titel, von, bis, alle FROM veranstaltungen WHERE titel='Sporttag!'`);
pruefe('F5 gespeichert (10:45-12:15, ganze Gruppe), freier Termin geloescht, gebuchter bleibt, Fenster zu',
  sport && sport.von === '10:45' && sport.bis === '12:15' && sport.alle === true
  && !(await eins(`SELECT 1 FROM talking_slots WHERE id=$1`, [fbMiFrei])) && !!(await eins(`SELECT 1 FROM talking_slots WHERE id=$1`, [fbMiGeb]))
  && lauf('__offen.join()') === 'zu:modal-veranstaltung', [sport, lauf('__offen.join()')]);
pruefe('F6 die Woche zeigt ihn gleich', html('cal-adminweek').includes('📌 Sporttag!'));

// Nur ein Teil der Gruppe, ohne Kollisionen: speichert sofort.
lauf(`openVeranstaltungNeu({ datumVon: __werte.d })`, { d: T[1] });
seite.element('vst-titel').value = 'Schulkonzert';
seite.element('vst-einzelne').checked = true; seite.element('vst-alle').checked = false;
lauf('vstWerUmschalten()');
pruefe('F7 "Nur ein Teil": Liste mit Suche und allen Schueler:innen', seite.element('vst-personen-box').style.display === ''
  && ['ada', 'bo', 'cleo', 'dan'].every(n => html('vst-personen').includes(`> ${n}`)), html('vst-personen').slice(0, 300));
await lauf('vstSpeichern()'); await ruhe();
pruefe('F8 niemand gewaehlt: Hinweis', seite.element('vst-error').textContent === 'Bitte wählen, wer dabei ist – oder „Ganze Gruppe“.');
seite.setzeQsa(sel => sel === '.vst-p-cb' ? [{ checked: true, value: String(P.cleo) }, { checked: false, value: String(P.dan) }] : []);
await lauf('vstSpeichern()'); await ruhe();
seite.setzeQsa(() => []);
const konzert = await eins(`SELECT id, von, alle FROM veranstaltungen WHERE titel='Schulkonzert'`);
pruefe('F9 gespeichert ohne Pruefliste: ganzer Tag, nur cleo', konzert && konzert.von === null && konzert.alle === false
  && JSON.stringify((await db.query(`SELECT user_id FROM veranstaltung_personen WHERE veranstaltung_id=$1`, [konzert.id])).rows.map(r => r.user_id)) === JSON.stringify([P.cleo]), konzert);

// Bearbeiten und loeschen
lauf(`openVeranstaltung(${laienId})`);
pruefe('F10 bearbeiten: vorbelegt, ada und bo angehakt, Loeschen sichtbar', seite.element('vst-kopf').textContent === '📌 Veranstaltung bearbeiten'
  && wert('vst-titel') === 'Laienreanimation' && wert('vst-zeit') === 'bloecke' && wert('vst-block-von') === '2' && wert('vst-block-bis') === '3'
  && seite.element('vst-einzelne').checked && html('vst-personen').includes(`value="${P.ada}" class="vst-p-cb" checked`)
  && html('vst-personen').includes(`value="${P.bo}" class="vst-p-cb" checked`) && !html('vst-personen').includes(`value="${P.cleo}" class="vst-p-cb" checked`)
  && seite.element('vst-loeschen').style.display === '', html('vst-personen').slice(0, 400));
lauf(`openVeranstaltung(${forumId})`);
await lauf('vstLoeschen()'); await ruhe();
pruefe('F11 loeschen mit Rueckfrage: weg', fragen.at(-1) === '„Forumstheater“ löschen? Die Zeit ist danach wieder frei.'
  && !(await eins(`SELECT 1 FROM veranstaltungen WHERE id=$1`, [forumId])) && !html('cal-adminweek').includes('Forumstheater'));

// ── L) Liste, Kalender, Anlegen ──────────────────────────────────────────────
lauf('openVeranstaltungen()');
const liste = html('vstl-inhalt');
pruefe('L1 Liste in Mein Kalender: alle anstehenden mit ✎', ['ILePs', 'Laienreanimation', 'Sporttag!', 'Schulkonzert'].every(t => liste.includes('📌 ' + t))
  && liste.includes(`openVeranstaltung(${ilepsId})`) && liste.includes('ada, bo'), liste);
pruefe('L2 der Knopf steht in Mein Kalender', lies('public/index.html').includes(`<button class="btn-act btn-outline" onclick="openVeranstaltungen()">📌 Veranstaltungen</button>`));
await lauf(`calYear = new Date(__werte.d + 'T00:00:00').getFullYear(); calMonth = new Date(__werte.d + 'T00:00:00').getMonth(); calSelected = __werte.d; renderCalendar(); renderCalDetail();`, { d: T[0] });
pruefe('L3 Monat: ILePs am Tag', html('cal-grid').includes('<div class="cal-ev cal-ev-vst" title="ILePs · ganzer Tag">📌 ILePs</div>'), html('cal-grid').slice(0, 200));
pruefe('L4 Tag: ILePs mit ✎', html('cal-detail').includes('📌 <strong>ILePs</strong>') && html('cal-detail').includes(`onclick="openVeranstaltung(${ilepsId})"`), html('cal-detail'));
// FaBue am ILePs-Tag ueber das Fenster: Meldung im Fenster.
await lauf(`openInputSlotModal(__werte.d)`, { d: T[0] }); await ruhe();
seite.element('islot-uhrzeit').value = '09:00';
await lauf('submitInputSlot()'); await ruhe();
pruefe('L5 FaBue am ILePs-Tag anlegen: Meldung im Fenster', /ILePs“ für die ganze Gruppe – da wird nichts angelegt/.test(seite.element('islot-error').textContent),
  seite.element('islot-error').textContent);
seite.element('islot-recurring').checked = true;
seite.element('islot-weekday').value = String(new Date(T[0] + 'T00:00:00').getDay());
seite.element('islot-von').value = T[0];
seite.element('islot-bis').value = lauf(`(() => { const d = new Date(__werte.d + 'T00:00:00'); d.setDate(d.getDate() + 7); return lwDateStr(d); })()`, { d: T[0] });
await lauf('submitInputSlot()'); await ruhe();
pruefe('L6 Reihe ueber den ILePs-Tag: angelegt ohne ihn, Meldung nennt ihn', meldungen.at(-1) === `Nicht angelegt, weil dort eine Veranstaltung für die ganze Gruppe ist:\n· ${lauf(`lwFmtDay(__werte.d)`, { d: T[0] })}: ILePs`, meldungen.at(-1));

// ── S) Schueler:innen ────────────────────────────────────────────────────────
const schuelerWoche = async name => {
  wer = { userId: P[name], username: name, role: 'student', klasse: 'M3M4' };
  await lauf(`me = __werte.me; _mwWoche = 1; _mwPicked = null; loadMyWeek()`, { me: wer }); await ruhe();
  return html('home-myweek');
};
h = await schuelerWoche('ada');
pruefe('S1 ada: ILePs in der ganztaegigen Zeile, Laienreanimation im Do-Block - nicht antippbar',
  h.includes('📌 ILePs') && h.includes('📌 Laienreanimation') && h.includes('10:45–12:15 · du bist dabei') && !h.includes('openVeranstaltung(')
  && !h.includes('Schulkonzert'), h.slice(0, 400));
lauf(`mwSelect(${fbDo})`);
pruefe('S2 ada: das FaBue in der Laienreanimation ist gesperrt - mit Grund', lauf(`mwState(_mwSlots.find(s => s.id === ${fbDo}))`) === 'conflict'
  && html('mw-actionbar').includes('✕ In dieser Zeit bist du bei „Laienreanimation“.'), html('mw-actionbar'));
pruefe('S3 Legende nennt 📌', h.includes('📌 Veranstaltung – in der Zeit bist du verhindert'));
h = await schuelerWoche('cleo');
pruefe('S4 cleo: keine Laienreanimation, FaBue frei; dafuer ihr Schulkonzert', !h.includes('Laienreanimation') && h.includes('📌 Schulkonzert')
  && lauf(`mwState(_mwSlots.find(s => s.id === ${fbDo}))`) === 'free', h.slice(0, 300));
await lauf(`(async () => { calData = await (await fetch('/api/calendar')).json(); calSelected = __werte.d; renderCalDetail(); })()`, { d: T[0] }); await ruhe();
pruefe('S5 Kalender-Tag der Schueler:in: ILePs ohne ✎', html('cal-detail').includes('📌 <strong>ILePs</strong>') && !html('cal-detail').includes('openVeranstaltung('), html('cal-detail'));

console.log(`\n${ok} Pruefungen ok`);
process.exit(0);
