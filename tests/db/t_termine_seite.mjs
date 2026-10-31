// Terminplanung auf der Seite (Nutzerwunsch 2026-10-31) - Seite und Server ZUSAMMEN
// (seite_im_test + server_im_test, pglite): "☰ Termine verwalten" in Mein Kalender (Liste,
// Filter, alle auswaehlen, Rueckfrage mit Zahl der Betroffenen, Stornieren/Loeschen) und die
// 8-Wochen-Frist in den Terminfenstern (Datumsfelder, Hinweis, Meldung bei gekuerzter Reihe).
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
const LB1 = await neu('lb_super', 'admin');
await db.query(`UPDATE users SET super_admin=true WHERE id=$1`, [LB1]);
const LB2 = await neu('lb_normal', 'admin');
const P = {};
for (const n of ['ana', 'ben', 'cem']) P[n] = await neu(n);

const tagIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tag = n => { const h = new Date(); return tagIso(new Date(h.getFullYear(), h.getMonth(), h.getDate() + n)); };
const ST = tag(56);
const slot = async (admin, datum, typ, fach, thema = '') => (await eins(
  `INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
   VALUES ('M3M4',$1,'09:00','R1',$2,$3,$4,45,$5,$6) RETURNING id`, [datum, typ === 'talk' ? '2627_1' : '', admin, typ, fach, thema])).id;
const sess = async (slotId, presenter, thema = '') => (await eins(
  `INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,$3) RETURNING id`, [slotId, presenter, thema])).id;
const einl = (sid, uid) => db.query(`INSERT INTO talking_invitations (session_id, listener_id, status) VALUES ($1,$2,'angenommen')`, [sid, uid]);

const frei1 = await slot(LB1, tag(2), 'input', F.mathe, 'Brüche üben');
const fabue2 = await slot(LB2, tag(3), 'input', F.englisch);
const fs2 = await sess(fabue2, null); await einl(fs2, P.ana); await einl(fs2, P.ben);
const talkFrei2 = await slot(LB2, tag(4), 'talk', F.mathe);
const talk1 = await slot(LB1, tag(5), 'talk', F.mathe);
await sess(talk1, P.cem, 'Pythagoras');
const heute2 = await slot(LB2, tag(0), 'talk', F.mathe);
const hs = await sess(heute2, P.ben, 'Heute');
await db.query(`UPDATE talking_sessions SET presented_status='erledigt', pokale=3 WHERE id=$1`, [hs]);

// ── Seite, verbunden mit dem Server ──────────────────────────────────────────
const seite = ladeSeite();
let wer = { userId: LB1, username: 'lb_super', role: 'admin', klasse: 'M3M4', superAdmin: true };
let offen = 0;
const serverFetch = srv.fetchFuer(() => ({ userId: wer.userId, role: wer.role, klasse: wer.klasse }));
seite.kontext.fetch = async (...a) => { offen++; try { return await serverFetch(...a); } finally { offen--; } };
const meldungen = [];
seite.kontext.alert = t => meldungen.push(String(t));
const ruhe = async () => { do { await new Promise(r => setTimeout(r, 5)); } while (offen > 0); await new Promise(r => setTimeout(r, 5)); };
const lauf = (code, werte) => seite.lauf(code, werte);
const html = id => seite.element(id).innerHTML;
await lauf(`me = __werte.me; subjectsMeta = []; loadSubjectsMeta()`, { me: wer });
await ruhe();
const gibt = async id => !!(await eins(`SELECT id FROM talking_slots WHERE id=$1`, [id]));
const gebucht = async id => !!(await eins(`SELECT id FROM talking_sessions WHERE slot_id=$1`, [id]));
const zeilen = () => (html('tv-inhalt').match(/class="tv-zeile/g) || []).length;

// ── K) Knopf ─────────────────────────────────────────────────────────────────
const quelle = lies('public/index.html');
const knoepfe = quelle.slice(quelle.indexOf('id="cal-admin-actions"'), quelle.indexOf('</div>', quelle.indexOf('id="cal-admin-actions"')));
pruefe('K1 in Mein Kalender steht "☰ Termine verwalten" neben "+ FaBü-Termin"',
  knoepfe.includes('openTermineVerwalten()') && knoepfe.includes('☰ Termine verwalten') && knoepfe.includes('+ FaBü-Termin'), knoepfe);

// ── V) Verwaltung als Super-Admin ────────────────────────────────────────────
await lauf('openTermineVerwalten()'); await ruhe();
let h = html('tv-inhalt');
pruefe('V1 alle anstehenden des Tandems, mit Lernbegleitung und Filter danach',
  zeilen() === 5 && seite.element('tv-titel').textContent.includes('alle anstehenden des Tandems')
  && h.includes('Alle Lernbegleitungen') && h.includes('lb_normal') && h.includes('lb_super'), h);
pruefe('V2 je Zeile Art, Fach, Thema und Belegung',
  h.includes('„Brüche üben“') && h.includes('gebucht: cem') && h.includes('2 dabei') && h.includes('FaBü · Englisch')
  && (h.match(/pill pill-green">frei/g) || []).length === 2, h);
pruefe('V3 heute schon Bewertetes laesst sich nicht auswaehlen', /disabled onchange="tvWaehlen\(\d+, this.checked\)"/.test(h) && h.includes('schon eingetragen'), h);
lauf(`tvFilter('admin', '${LB2}')`);
pruefe('V4 Filter Lernbegleitung: nur lb_normal (3 Termine)', zeilen() === 3 && !html('tv-inhalt').includes('„Brüche üben“'), html('tv-inhalt'));
lauf(`tvFilter('nurFrei', true)`);
pruefe('V5 dazu "nur freie": 1 Termin', zeilen() === 1, html('tv-inhalt'));
lauf(`tvFilter('admin', ''); tvFilter('nurFrei', false)`);
lauf('tvAlleWaehlen(true)');
h = html('tv-inhalt');
pruefe('V6 alle sichtbaren auswaehlen: 4 (der bewertete nicht) - Leiste mit beiden Aktionen',
  lauf('_tv.auswahl.size') === 4 && h.includes('4 ausgewählt:') && h.includes('Buchungen stornieren') && h.includes('>Löschen<'), h);
lauf(`tvFilter('admin', '${LB2}')`);
pruefe('V6b ein Filter nimmt Ausgeblendetes aus der Auswahl - nichts wird unbemerkt mitgeloescht',
  lauf('_tv.auswahl.size') === 2 && html('tv-inhalt').includes('2 ausgewählt:'), html('tv-inhalt'));
lauf(`tvFilter('admin', ''); tvAlleWaehlen(true)`);
lauf(`tvFrage('loeschen')`);
h = html('tv-inhalt');
pruefe('V7 Loeschen fragt erst nach - mit Zahl der Gebuchten und der Betroffenen',
  h.includes('Von 4 ausgewählten Terminen sind 2 gebucht – 3 Personen sind dabei.')
  && h.includes('Alle 4 löschen – Gebuchte werden abgesagt') && h.includes('Nur die 2 freien löschen'), h);
await lauf(`tvAusfuehren('loeschen', false)`); await ruhe();
pruefe('V8 "Nur die freien": die zwei freien sind weg, die gebuchten bleiben - und bleiben ausgewaehlt',
  !(await gibt(frei1)) && !(await gibt(talkFrei2)) && await gibt(fabue2) && await gibt(talk1)
  && lauf('_tv.auswahl.size') === 2 && html('tv-inhalt').includes('✓ 2 Termine gelöscht.')
  && !html('tv-inhalt').includes('stehen:'), html('tv-inhalt'));
lauf(`tvFrage('stornieren')`);
pruefe('V9 Stornieren fragt nach: 2 Buchungen, 3 Personen verlieren ihren Platz',
  html('tv-inhalt').includes('2 Buchungen stornieren – 3 Personen verlieren ihren Platz.'), html('tv-inhalt'));
await lauf(`tvAusfuehren('stornieren', false)`); await ruhe();
pruefe('V10 storniert: Buchungen weg, die Termine stehen frei',
  await gibt(fabue2) && await gibt(talk1) && !(await gebucht(fabue2)) && !(await gebucht(talk1))
  && html('tv-inhalt').includes('✓ 2 Termine storniert (bleiben frei stehen).'), html('tv-inhalt'));
lauf('tvAlleWaehlen(false)');
lauf(`tvWaehlen(${talk1}, true)`); lauf(`tvFrage('loeschen')`);
pruefe('V11 ein freier Termin: einfache Rueckfrage', html('tv-inhalt').includes('1 Termin löschen?') && !html('tv-inhalt').includes('Nur die'), html('tv-inhalt'));
await lauf(`tvAusfuehren('loeschen', true)`); await ruhe();
pruefe('V12 geloescht, und die Liste ist neu geladen', !(await gibt(talk1)) && zeilen() === 2 && meldungen.length === 0, html('tv-inhalt'));

// ── R) nichts springt (Wunsch des Users 2026-10-31) ──────────────────────────
// Nach jedem Haekchen wird neu gezeichnet - die neue Liste muss da weiterstehen, wo die alte war.
// Die Attrappe liefert beim ersten Aufruf die alte Liste (gerollt), beim zweiten die neue.
{
  const ziel = seite.element('tv-inhalt');
  const altL = { scrollTop: 240 }, neuL = { scrollTop: 0 };
  let aufrufe = 0;
  ziel.querySelector = sel => (sel === '.tv-liste' ? (aufrufe++ === 0 ? altL : neuL) : null);
  lauf(`tvWaehlen(${fabue2}, true)`);
  pruefe('R1 ein Haekchen setzen: die Liste bleibt, wo sie war - kein Sprung nach oben', neuL.scrollTop === 240 && aufrufe === 2, { aufrufe, neuL });
  ziel.querySelector = () => null;
  pruefe('R2 die Bedienelemente haben feste Kennungen (damit der Fokus bleibt)',
    html('tv-inhalt').includes(`id="tv-cb-${fabue2}"`) && html('tv-inhalt').includes('id="tv-f-art"') && html('tv-inhalt').includes('id="tv-alle"'), html('tv-inhalt'));
  lauf('tvAlleWaehlen(false)');
}

// ── N) als normale Lernbegleitung ────────────────────────────────────────────
const nochmal = await slot(LB1, tag(7), 'input', F.mathe, 'Von lb_super');
wer = { userId: LB2, username: 'lb_normal', role: 'admin', klasse: 'M3M4', superAdmin: false };
await lauf(`me = __werte.me; openTermineVerwalten()`, { me: wer }); await ruhe();
h = html('tv-inhalt');
pruefe('N1 normale Lernbegleitung: nur die eigenen, ohne Filter nach Lernbegleitung',
  seite.element('tv-titel').textContent.includes('deine anstehenden') && !h.includes('Alle Lernbegleitungen')
  && !h.includes('Von lb_super') && zeilen() === 2, h);
lauf(`tvWaehlen(${fabue2}, true)`); lauf(`tvFrage('loeschen')`);
await lauf(`tvAusfuehren('loeschen', true)`); await ruhe();
pruefe('N2 eigenen Termin geloescht', !(await gibt(fabue2)) && await gibt(nochmal), html('tv-inhalt'));

// ── F) Frist in den Terminfenstern ───────────────────────────────────────────
wer = { userId: LB1, username: 'lb_super', role: 'admin', klasse: 'M3M4', superAdmin: true };
await lauf(`me = __werte.me; openInputSlotModal()`, { me: wer }); await ruhe();
const stText = new Date(ST + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
pruefe('F1 Fachbuero-Fenster: Datumsfelder bieten nur Tage bis zum Stichtag, darunter der Hinweis',
  ['islot-datum', 'islot-von', 'islot-bis'].every(id => seite.element(id).max === ST)
  && seite.element('islot-frist').textContent === `Planbar bis ${stText} – höchstens 8 Wochen im Voraus.`, seite.element('islot-frist').textContent);
lauf(`openTalkingSlotModal()`);
pruefe('F2 Talk-Fenster ebenso', ['tslot-datum', 'tslot-von', 'tslot-bis'].every(id => seite.element(id).max === ST)
  && seite.element('tslot-frist').textContent.includes(stText));
const heuteWt = new Date().getDay();
seite.element('islot-recurring').checked = true;
seite.element('islot-weekday').value = String(heuteWt);
seite.element('islot-von').value = tag(0);
seite.element('islot-bis').value = tag(77);
seite.element('islot-subject').value = String(F.mathe);
seite.element('islot-teacher').value = String(LB1);
seite.element('islot-uhrzeit').value = '13:00';
await lauf('submitInputSlot()'); await ruhe();
pruefe('F3 Reihe ueber den Stichtag: angelegt bis dorthin, mit Meldung, was fehlt',
  meldungen.length === 1 && meldungen[0].startsWith(`9 Termine bis zum ${stText} angelegt.`)
  && meldungen[0].includes('3 weitere lägen hinter der 8-Wochen-Frist'), meldungen);
const n13 = await eins(`SELECT count(*)::int AS n, max(to_char(datum,'YYYY-MM-DD')) AS bis FROM talking_slots WHERE uhrzeit='13:00'`);
pruefe('F4 ... und wirklich 9 Termine bis zum Stichtag', n13.n === 9 && n13.bis === ST, n13);
const weit = (await eins(`INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
  VALUES ('M3M4',$1,'09:00','R1','2627_1',$2,'talk',45,$3,'') RETURNING id`, [tag(70), LB1, F.mathe])).id;
await lauf('loadTalkingAdmin()'); await ruhe();
lauf(`openTalkingSlotEditModal(${weit})`);
pruefe('F5 Verschieben eines schon weiter entfernten Termins: sein Datum bleibt waehlbar',
  seite.element('tsedit-datum').max === seite.element('tsedit-datum').value && seite.element('tsedit-datum').value > ST,
  [seite.element('tsedit-datum').max, seite.element('tsedit-datum').value]);

console.log('\n' + ok + ' Pruefungen bestanden.');
