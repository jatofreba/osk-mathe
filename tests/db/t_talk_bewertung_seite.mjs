// Talks bewerten im Talks-Reiter der Lernbegleitung (Nutzerwunsch 2026-10-14) - Seite und Server
// ZUSAMMEN (seite_im_test + server_im_test, pglite): "✍️ Noch zu bewerten" ganz oben, erst den
// Talk waehlen, dann je Person ein Klick; Terminkarten mit einer Zeile je Person; im Fenster
// springt der Status mit der Flamme auf "hat stattgefunden"; die Halbjahr-Uebersicht zaehlt den Talk.
// Alle Termine liegen relativ zu heute.
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
  `INSERT INTO users (username, password_hash, klasse, role, created_at) VALUES ($1,'x','M3M4',$2, NOW() - INTERVAL '2 years') RETURNING id`,
  [name, rolle])).id;
const LB = await neu('lb_bewertet', 'admin');
const P = {};
for (const n of ['rita', 'sven', 'ulla', 'vera', 'wim', 'xaver']) P[n] = await neu(n);

const tagIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tag = n => { const d = new Date(); d.setDate(d.getDate() + n); return tagIso(d); };
const hjVon = iso => {
  const [y, m] = iso.split('-').map(Number), start = m >= 8 ? y : y - 1;
  return String(start).slice(-2) + String(start + 1).slice(-2) + '_' + ((m >= 8 || m === 1) ? 1 : 2);
};
const slot = async (datum, uhr) => (await eins(`INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
  VALUES ('M3M4',$1,$2,'R1',$3,$4,'talk',45,$5,'') RETURNING id`, [datum, uhr, hjVon(datum), LB, F.mathe])).id;
const buchung = async (datum, uhr, presenter, thema) => (await eins(
  `INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,$3) RETURNING id`, [await slot(datum, uhr), presenter, thema])).id;
const einl = async (sid, uid, rolle = 'zuhoeren', status = 'angenommen') => (await eins(
  `INSERT INTO talking_invitations (session_id, listener_id, status, rolle) VALUES ($1,$2,$3,$4) RETURNING id`, [sid, uid, status, rolle])).id;

// T1 gestern: rita bucht, sven traegt mit vor (hat schon ein Emoji), ulla hoert zu, vera hat nie
// geantwortet, wim hat abgesagt - alle unbewertet.
const T1 = await buchung(tag(-1), '09:00', P.rita, 'Pythagoras');
const svenE = await einl(T1, P.sven, 'vortrag');
await db.query(`UPDATE talking_invitations SET quality_emoji='🤩' WHERE id=$1`, [svenE]);
const ullaE = await einl(T1, P.ulla);
const veraE = await einl(T1, P.vera, 'zuhoeren', 'eingeladen');
const wimE = await einl(T1, P.wim, 'zuhoeren', 'abgelehnt');
// T2 vor drei Tagen: xaver schon bewertet, ulla noch nicht -> 1 offen
const T2 = await buchung(tag(-3), '11:30', P.xaver, 'Brüche');
await db.query(`UPDATE talking_sessions SET presented_status='erledigt', pokale=3 WHERE id=$1`, [T2]);
const ullaE2 = await einl(T2, P.ulla);
// T3 morgen (noch nicht dran), T4 vorgestern (fertig bewertet)
const T3 = await buchung(tag(1), '10:00', P.ulla, 'Zukunft');
await einl(T3, P.rita);
const T4 = await buchung(tag(-2), '08:00', P.sven, 'Fertig');
await db.query(`UPDATE talking_sessions SET presented_status='erledigt', pokale=2 WHERE id=$1`, [T4]);
const ritaE4 = await einl(T4, P.rita);
await db.query(`UPDATE talking_invitations SET attended_status='erledigt', pokale=1 WHERE id=$1`, [ritaE4]);
// T5 vor 200 Tagen (anderes Halbjahr), fertig bewertet - gehoert nicht unter "Bewertet in diesem Halbjahr"
const T5 = await buchung(tag(-200), '08:00', P.xaver, 'Altjahr');
await db.query(`UPDATE talking_sessions SET presented_status='erledigt', pokale=1 WHERE id=$1`, [T5]);

// ── Seite, verbunden mit dem Server ──────────────────────────────────────────
const seite = ladeSeite();
const wer = { userId: LB, username: 'lb_bewertet', role: 'admin', klasse: 'M3M4' };
let offen = 0;
const serverFetch = srv.fetchFuer(() => ({ userId: wer.userId, role: wer.role, klasse: wer.klasse }));
seite.kontext.fetch = async (...a) => { offen++; try { return await serverFetch(...a); } finally { offen--; } };
const meldungen = [];
seite.kontext.alert = t => meldungen.push(String(t));
const ruhe = async () => { do { await new Promise(r => setTimeout(r, 5)); } while (offen > 0); await new Promise(r => setTimeout(r, 5)); };
const lauf = (code, werte) => seite.lauf(code, werte);
const html = id => seite.element(id).innerHTML;
await lauf(`me = __werte.me; activeSubject = 'mathe'; subjectsMeta = []; loadSubjectsMeta()`, { me: wer });
await ruhe();
await lauf('loadTalkingAdmin()'); await ruhe();

// Nur "Noch zu bewerten" - darunter steht (zugeklappt) "✅ Bewertet in diesem Halbjahr".
const sektion = () => {
  const h = html('talking-admin');
  const ende = h.indexOf('✅ Bewertet in diesem Halbjahr') !== -1 ? h.indexOf('✅ Bewertet in diesem Halbjahr') : h.indexOf('📅 Termine verwalten');
  return h.slice(h.indexOf('✍️ Noch zu bewerten'), ende);
};
const bewertetTeil = () => {
  const h = html('talking-admin');
  const a = h.indexOf('<details class="lzk-ue-bewertet"');
  return a === -1 ? '' : h.slice(a, h.indexOf('📅 Termine verwalten'));
};
const zaehler = () => (sektion().match(/Noch zu bewerten <span class="pill">(\d+)<\/span>/) || [])[1];
const knoepfe = (typ, id) => (sektion().match(new RegExp(`talkZbBewerten\\('${typ}', ${id}, `, 'g')) || []).length;
const zeile = async (tabelle, id) => eins(`SELECT ${tabelle === 's' ? 'presented_status' : 'attended_status'} AS st, pokale, quality_emoji AS e
  FROM ${tabelle === 's' ? 'talking_sessions' : 'talking_invitations'} WHERE id=$1`, [id]);
const klick = async (typ, id, n) => { await lauf(`talkZbBewerten('${typ}', ${id}, ${n})`); await ruhe(); };

// ── O) oben: "Noch zu bewerten" ──────────────────────────────────────────────
let h = html('talking-admin');
pruefe('O1 "✍️ Noch zu bewerten" steht ganz oben, gleich vor den Terminen',
  h.indexOf('✍️ Noch zu bewerten') !== -1 && h.indexOf('✍️ Noch zu bewerten') < h.indexOf('📅 Termine verwalten')
  && h.trimStart().startsWith('<h3 class="lzk-ue-kopf">✍️ Noch zu bewerten'), h.slice(0, 600));
pruefe('O1b die Soll-Uebersicht ist raus (steht in der Halbjahr-Uebersicht)',
  !h.includes('Wer hat sein Soll erledigt') && !h.includes('Übersicht vergangener Halbjahre') && !h.includes('tov-'), h.slice(0, 600));
let s = sektion();
pruefe('O2 zwei Talks offen, aelteste zuerst - der kuenftige und der fertig bewertete fehlen',
  zaehler() === '2' && (s.match(/class="tzb-talk/g) || []).length === 2 && s.indexOf('Brüche') < s.indexOf('Pythagoras')
  && !s.includes('Zukunft') && !s.includes('Fertig'), s);
pruefe('O3 an jedem Talk steht, wie viele noch offen sind', s.includes('3 offen') && s.includes('1 offen'), s);
pruefe('O4 erst nach der Auswahl erscheinen die Personen', !s.includes('tzb-personen'), s);

// ── W) Talk waehlen, dann je Person ein Klick ────────────────────────────────
lauf(`talkZbWaehlen(${T1})`);
s = sektion();
pruefe('W1 der gewaehlte Talk ist aufgeklappt', s.includes('aria-expanded="true"') && s.includes('tzb-personen'), s);
pruefe('W2 je Person eigene Knoepfe: rita und sven je ✗ + 4 Flammen, ulla ✗ + 2',
  knoepfe('presented', T1) === 5 && knoepfe('mitvortrag', svenE) === 5 && knoepfe('attended', ullaE) === 3
  && s.includes('aria-label="rita: hat stattgefunden – 4 Flammen"') && !s.includes('aria-label="ulla: hat stattgefunden – 3 Flammen"'), s);
// Seit 2026-10-14 (Wunsch des Users): wer nie geantwortet hat, laesst sich hier direkt bewerten -
// vorher stand nur "unten an der Terminkarte bewerten".
pruefe('W3 vera (nie geantwortet) hat eigene Knoepfe, mit "keine Antwort" - wim (abgesagt) gar nicht',
  knoepfe('attended', veraE) === 3 && s.includes('👂 vera') && s.includes('· keine Antwort') && !s.includes('wim')
  && !s.includes('Ohne Antwort eingeladen'), s);
await klick('attended', veraE, 1);
let z = await zeile('i', veraE);
const veraEinladung = await eins(`SELECT status FROM talking_invitations WHERE id=$1`, [veraE]);
pruefe('W3b vera direkt bewertet: hat stattgefunden, 1 Flamme - ihre Einladung bleibt, wie sie war',
  z.st === 'erledigt' && z.pokale === 1 && veraEinladung.status === 'eingeladen', { z, veraEinladung });
s = sektion();
pruefe('W3c danach ohne "keine Antwort" - und "offen" zaehlt sie nicht (weiter 3 offen)',
  !s.includes('· keine Antwort') && s.includes('3 offen'), s);
await klick('attended', veraE, 1);
z = await zeile('i', veraE);
pruefe('W3d nochmal tippen: wieder unbewertet, wieder "keine Antwort"',
  z.st === 'ausstehend' && z.pokale === 0 && sektion().includes('· keine Antwort'), z);
await klick('attended', ullaE, 2);
z = await zeile('i', ullaE);
pruefe('W4 ein Klick auf 🔥🔥 bei ulla: hat stattgefunden, 2 Flammen', z.st === 'erledigt' && z.pokale === 2, z);
s = sektion();
pruefe('W5 der Knopf ist danach gedrueckt, der Talk zaehlt "2 offen", die Auswahl bleibt',
  s.includes('aria-label="ulla: hat stattgefunden – 2 Flammen" aria-pressed="true"') && s.includes('2 offen') && s.includes('tzb-personen'), s);
await klick('attended', ullaE, 2);
z = await zeile('i', ullaE);
pruefe('W6 derselbe Klick nochmal setzt zurueck', z.st === 'ausstehend' && z.pokale === 0, z);
await klick('presented', T1, -1);
z = await zeile('s', T1);
pruefe('W7 ✗ bei rita: nicht gehalten', z.st === 'nicht_erledigt' && z.pokale === 0, z);
await klick('mitvortrag', svenE, 3);
z = await zeile('i', svenE);
pruefe('W8 sven einzeln: 3 Flammen - sein Emoji bleibt stehen', z.st === 'erledigt' && z.pokale === 3 && z.e === '🤩', z);
await klick('attended', ullaE, 1);
await klick('presented', T1, 4);
z = await zeile('s', T1);
pruefe('W9 rita von ✗ auf 4 Flammen umgestellt', z.st === 'erledigt' && z.pokale === 4, z);
s = sektion();
pruefe('W10 alle bewertet: der Talk bleibt stehen, solange er gewaehlt ist - der Zaehler sinkt',
  zaehler() === '1' && s.includes('✓ alle bewertet') && s.includes('Pythagoras'), s);
lauf(`talkZbWaehlen(${T1})`);
s = sektion();
pruefe('W11 abgewaehlt: der fertige Talk ist weg', !s.includes('Pythagoras') && s.includes('Brüche') && !s.includes('tzb-personen'), s);
pruefe('W12 keine Fehlermeldung unterwegs', meldungen.length === 0, meldungen);

// ── B) "✅ Bewertet in diesem Halbjahr" (wie bei den LZK) ─────────────────────
// Wunsch des Users: ein gerade fertig bewerteter Talk "rutschte weg". Am 1.2./1.8. liegen gestern
// und vorgestern im alten Halbjahr - dann gibt es nichts zu pruefen.
if (hjVon(tag(-2)) === hjVon(tag(0))) {
  let b = bewertetTeil();
  pruefe('B1 fertig bewertet stehen darunter, neueste zuerst - unbewertete und alte Halbjahre nicht',
    b.includes('Pythagoras') && b.includes('Fertig') && b.indexOf('Pythagoras') < b.indexOf('Fertig')
    && !b.includes('Brüche') && !b.includes('Altjahr') && b.includes('Bewertet in diesem Halbjahr <span class="pill">2</span>'), b);
  pruefe('B2 zugeklappt wie bei den LZK, ohne aufgeklappten Talk - die Zeilen merken sich, woher sie kommen',
    !b.startsWith('<details class="lzk-ue-bewertet" open') && !b.includes('tzb-personen')
    && b.includes(`talkZbWaehlen(${T4}, 'bewertet')`) && sektion().includes(`talkZbWaehlen(${T2}, 'offen')`), b.slice(0, 600));
  lauf(`talkZbWaehlen(${T1}, 'bewertet')`);
  b = bewertetTeil();
  pruefe('B3 antippen: die Liste ist offen, der Talk aufgeklappt - mit denselben Knoepfen',
    b.startsWith('<details class="lzk-ue-bewertet" open') && b.includes('tzb-personen')
    && b.includes(`talkZbBewerten('presented', ${T1}, 3)`) && !sektion().includes('Pythagoras'), b);
  await klick('attended', ullaE, 1);        // ullas Flamme zuruecknehmen -> T1 wieder offen
  b = bewertetTeil();
  pruefe('B4 eine Bewertung zurueckgenommen: der Talk bleibt, wo er gewaehlt wurde ("1 offen"), oben zaehlt er mit',
    b.includes('Pythagoras') && b.includes('1 offen') && b.includes('tzb-personen') && !sektion().includes('Pythagoras')
    && zaehler() === '2', b);
  await klick('attended', ullaE, 1);        // und wieder vergeben
  z = await zeile('i', ullaE);
  pruefe('B5 wieder vergeben: 1 Flamme, "✓ alle bewertet", oben wieder 1 offener Talk',
    z.st === 'erledigt' && z.pokale === 1 && bewertetTeil().includes('✓ alle bewertet') && zaehler() === '1', z);
  lauf('talkBewertetUmschalten(false)');
  pruefe('B6 zuklappen waehlt den Talk ab', lauf('_talkZbAuswahl') === null);
  lauf('renderTalkingAdmin()');
  b = bewertetTeil();
  pruefe('B7 neu gezeichnet: zu und ohne aufgeklappten Talk', !b.startsWith('<details class="lzk-ue-bewertet" open') && !b.includes('tzb-personen'), b.slice(0, 200));
  lauf('talkBewertetUmschalten(true); renderTalkingAdmin()');
  pruefe('B8 aufgeklappt bleibt aufgeklappt, auch nach dem Neuzeichnen', bewertetTeil().startsWith('<details class="lzk-ue-bewertet" open'));
  lauf('talkBewertetUmschalten(false); renderTalkingAdmin()');
} else {
  console.log('--  B uebersprungen: gestern lag noch im alten Halbjahr');
}

// ── K) Terminkarten: je Person eine Zeile ────────────────────────────────────
h = html('talking-admin');
const karte = thema => {
  const termine = h.slice(h.indexOf('📅 Termine verwalten'));
  const a = termine.indexOf(`„${thema}“`);
  const b = termine.indexOf('class="stat-card"', a);
  return termine.slice(a, b === -1 ? undefined : b);
};
let k = karte('Pythagoras');
const zeileVon = (kk, name) => { const a = kk.indexOf(` ${name}</span>`); return a === -1 ? '' : kk.slice(a, kk.indexOf('</button>', a)); };
pruefe('K1 jede Person hat ihre eigene Zeile mit ihrer Bewertung',
  zeileVon(k, 'rita').includes('✓ ') && zeileVon(k, 'sven').includes('✓ ') && zeileVon(k, 'ulla').includes('✓ ')
  && zeileVon(k, 'vera').includes('⏳ noch keine Antwort') && zeileVon(k, 'wim').includes('✗ abgesagt'), k);
pruefe('K2 Vortragende mit 🎤, Zuhoerende mit 👂', k.includes('🎤 rita</span>') && k.includes('🎤 sven</span>')
  && k.includes('👂 ulla</span>') && k.includes('👂 vera</span>'), k);
pruefe('K3 jede Zeile oeffnet das Fenster fuer genau diese Person (Name im Aufruf)',
  k.includes(`openTalkingRateModal('attended', ${veraE}, 2, 0, null, 'ausstehend', &quot;vera&quot;)`)
  && k.includes(`openTalkingRateModal('mitvortrag', ${svenE}, 4, 3, '🤩', 'erledigt', &quot;sven&quot;)`), k);
pruefe('K4 der erste Knopf steht nicht mehr neben "rita & sven" (bewertete nur rita)',
  !h.includes('<strong>rita & sven</strong>') && !h.includes('Vortrag bewerten</span>'), k);
k = karte('Zukunft');
pruefe('K5 ein Talk von morgen: noch nichts zu bewerten, nur wer dabei ist',
  zeileVon(k, 'ulla').includes('hält den Talk') && zeileVon(k, 'rita').includes('✓ zugesagt') && !k.includes('⏳ bewerten'), k);
k = karte('Brüche');
pruefe('K6 ab dem Termintag: "⏳ bewerten" an der offenen Person', zeileVon(k, 'ulla').includes('⏳ bewerten'), k);

// ── F) das Fenster: Status springt mit der Flamme ────────────────────────────
lauf(`openTalkingRateModal('attended', ${veraE}, 2, 0, null, 'ausstehend', "vera")`);
pruefe('F1 der Titel nennt die Person', seite.element('trate-modal-title').textContent === '👂 Teilnahme bewerten – vera',
  seite.element('trate-modal-title').textContent);
lauf('selectTalkingRatePokal(2)');
pruefe('F2 eine Flamme setzt "hat stattgefunden"', seite.element('trate-modal-status').value === 'erledigt', seite.element('trate-modal-status').value);
seite.element('trate-modal-status').value = 'nicht_erledigt';
lauf('talkRateStatusGeaendert()');
pruefe('F3 "nicht teilgenommen" nimmt die Flammen weg', lauf('_talkingRateModal.pokale') === 0);
lauf('selectTalkingRatePokal(1)');
await lauf('saveTalkingRateModal()'); await ruhe();
z = await zeile('i', veraE);
pruefe('F4 gespeichert: vera hat teilgenommen, 1 Flamme', z.st === 'erledigt' && z.pokale === 1, z);

// ── U) Halbjahr-Uebersicht: auch eine Flamme mit liegengebliebenem Status zaehlt ──
lauf(`openTalkingRateModal('attended', ${ullaE2}, 2, 0, null, 'ausstehend', "ulla")`);
lauf('selectTalkingRatePokal(2)');
seite.element('trate-modal-status').value = 'ausstehend';   // wie frueher: Status nicht umgestellt
await lauf('saveTalkingRateModal()'); await ruhe();
z = await zeile('i', ullaE2);
pruefe('U1 der Server macht daraus "hat stattgefunden"', z.st === 'erledigt' && z.pokale === 2, z);
const hjT2 = hjVon(tag(-3));
const hjUe = await (await serverFetch('/api/admin/halbjahr-uebersicht')).json();
const ullaHj = ((hjUe.students.find(x => x.username === 'ulla') || {}).byHalbjahr || {})[hjT2];
const ullaMathe = ullaHj && ullaHj.bySubject && ullaHj.bySubject.mathe;
pruefe('U2 Halbjahr-Uebersicht: ullas Zuhoeren bei T2 zaehlt mit seinen 2 Flammen',
  ullaMathe && ullaMathe.talkDetails.some(d => d.role === 'zugehört' && d.thema === 'Brüche' && d.pokale === 2), ullaHj);
pruefe('U3 nichts mehr zu bewerten', zaehler() === '0' && sektion().includes('Nichts zu bewerten.'), sektion());

console.log('\n' + ok + ' Pruefungen bestanden.');
