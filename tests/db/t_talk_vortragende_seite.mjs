// Talks mit mehreren Vortragenden - Seite und Server ZUSAMMEN: die echte public/index.html in der
// Sandbox (seite_im_test.js) schickt ihre Anfragen an die echte server.js (server_im_test.js,
// pglite). So laufen die Wege, die Schueler:innen und Lernbegleitung wirklich klicken: buchen mit
// zweiter vortragender Person, annehmen, bewerten, Grenzen einstellen, nachladen, absagen.
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
const neu = async (name, rolle = 'student') => (await eins(
  `INSERT INTO users (username, password_hash, klasse, role, aktiv) VALUES ($1,'x','M3M4',$2,true) RETURNING id`, [name, rolle])).id;
const LB = await neu('lb_seite', 'admin');
const P = {};
for (const n of ['dan', 'gil', 'eli', 'fay', 'hal', 'ida']) P[n] = await neu(n);
const tag = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const slot = async (datum, fach = 'mathe', typ = 'talk') => (await eins(
  `INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
   VALUES ('M3M4',$1,'10:45','R1','2627_1',$2,$3,45,$4,'') RETURNING id`, [datum, LB, typ, F[fach]])).id;
const einladungVon = async (sessionId, name) => eins(
  `SELECT * FROM talking_invitations WHERE session_id=$1 AND listener_id=$2`, [sessionId, P[name]]);

// ── Seite, verbunden mit dem Server ──────────────────────────────────────────
const seite = ladeSeite();
let wer = null;
let offen = 0;
const serverFetch = srv.fetchFuer(() => ({ userId: wer.userId, role: wer.role, klasse: wer.klasse }));
seite.kontext.fetch = async (...a) => { offen++; try { return await serverFetch(...a); } finally { offen--; } };
const meldungen = [];
seite.kontext.alert = t => meldungen.push(String(t));
// Kaestchen der gerade offenen Auswahl; querySelectorAll('.x-cb') / ('.x-cb:checked') liefert sie.
let kaestchen = [];
seite.setzeQsa(sel => {
  const nurAn = sel.endsWith(':checked');
  const klasse = sel.replace(/:checked$/, '').replace(/^\./, '');
  return kaestchen.filter(k => k.klasse === klasse && (!nurAn || k.checked));
});
const lauf = (code, werte) => seite.lauf(code, werte);
// Wartet, bis alle Anfragen der Seite beantwortet und verarbeitet sind (auch nicht abgewartete).
const ruhe = async () => { do { await new Promise(r => setTimeout(r, 5)); } while (offen > 0); await new Promise(r => setTimeout(r, 5)); };
const html = id => seite.element(id).innerHTML;
const als = async name => {
  wer = name === 'lb' ? { userId: LB, username: 'lb_seite', role: 'admin', klasse: 'M3M4' }
    : { userId: P[name], username: name, role: 'student', klasse: 'M3M4' };
  await lauf(`me = __werte.me; activeSubject = 'mathe'; subjectsMeta = []; loadSubjectsMeta()`, { me: wer });
};
const liesKaestchen = id => {
  kaestchen = [...html(id).matchAll(/<input type="checkbox" value="(\d+)" class="([^"]+)"(?: onchange="([^"]*)")?/g)]
    .map(m => ({ value: m[1], klasse: m[2], onchange: m[3] || '', checked: false, disabled: false }));
  return kaestchen;
};
const kasten = (klasse, name) => kaestchen.find(k => k.klasse === klasse && k.value === String(P[name]));
const sichtbar = id => { const e = seite.element(id); return !!e && e.style.display !== 'none'; };
const klick = (klasse, name) => {
  const k = kasten(klasse, name);
  if (!k || k.disabled) throw new Error('nicht anklickbar: ' + klasse + ' ' + name);
  // Die Liste "mit wem" kann hinter "Ich möchte nicht alleine vortragen" zugeklappt sein.
  const box = klasse.replace('-mit-cb', '-mit-box');
  if (box !== klasse && seite.element(box) && !sichtbar(box)) throw new Error('Liste ist zu: ' + klasse);
  k.checked = !k.checked;
  if (k.onchange) lauf(k.onchange.replace(/&#39;|&quot;/g, "'"));
};
// Ein einzelnes Kaestchen mit id (z.B. "Ich möchte nicht alleine vortragen") setzen - samt onchange.
const schalte = (id, an) => {
  const el = seite.element(id);
  if (!el) throw new Error('kein Element ' + id);
  el.checked = an;
  const quelle = Object.values(seite.elemente).map(e => e.innerHTML).find(h => h.includes('id="' + id + '"'));
  const ab = quelle.indexOf('onchange="', quelle.indexOf('id="' + id + '"')) + 'onchange="'.length;
  lauf(quelle.slice(ab, quelle.indexOf('"', ab)).replace('this.checked', String(an)));
};
const kalender = async (datum) => {
  await lauf(`(async () => { calData = await (await fetch('/api/calendar')).json();
    calClassmates = await (await fetch('/api/classmates')).json(); calSelected = __werte.d; renderCalDetail(); renderCalInvites(); })()`, { d: datum });
};

// ── A) buchen mit zweiter vortragender Person (Talks-Reiter) ──────────────────
const t1 = tag(5);
const s1 = await slot(t1);
await als('dan');
await lauf('loadTalkingStudent()'); await ruhe();
lauf('openBookSessionModal()');
liesKaestchen('tbook-classmates');
pruefe('A1 beim Anmelden erst die Frage "Ich möchte nicht alleine vortragen" - die Liste dazu ist noch zu; darunter wer zuhoert (2-5)',
  html('tbook-classmates').includes('Ich möchte nicht alleine vortragen') && !seite.element('tbook-nicht-allein').checked
  && !sichtbar('tbook-mit-box') && html('tbook-classmates').includes('(2–5)')
  && kaestchen.filter(k => k.klasse === 'tbook-mit-cb').length === 5 && kaestchen.filter(k => k.klasse === 'tbook-zu-cb').length === 5,
  html('tbook-classmates'));
schalte('tbook-nicht-allein', true);
pruefe('A1b mit dem Haken erscheint "Mit wem trägst du vor? (höchstens 1)"', sichtbar('tbook-mit-box')
  && html('tbook-classmates').includes('Mit wem trägst du vor? <span style="font-weight:500;">(höchstens 1)</span>'), html('tbook-classmates'));
klick('tbook-mit-cb', 'gil');
pruefe('A2 wer mit vortraegt, ist bei den Zuhoerenden gesperrt - und mehr Mit-Vortragende gehen nicht',
  kasten('tbook-zu-cb', 'gil').disabled && kasten('tbook-mit-cb', 'eli').disabled && !kasten('tbook-zu-cb', 'eli').disabled);
schalte('tbook-nicht-allein', false);
pruefe('A2b Haken wieder raus: Liste zu, gil nicht mehr gewaehlt und kann wieder zuhoeren',
  !sichtbar('tbook-mit-box') && !kasten('tbook-mit-cb', 'gil').checked && !kasten('tbook-zu-cb', 'gil').disabled);
schalte('tbook-nicht-allein', true);
klick('tbook-zu-cb', 'eli'); klick('tbook-zu-cb', 'fay');
seite.element('tbook-slot').value = String(s1);
seite.element('tbook-thema').value = 'Pythagoras';
await lauf('submitBookSession()'); await ruhe();
pruefe('A2c Haken gesetzt, aber niemand gewaehlt: nachfragen statt allein buchen',
  /Wähle, mit wem du vorträgst/.test(meldungen.pop() || '') && !(await eins(`SELECT 1 FROM talking_sessions WHERE slot_id=$1`, [s1])));
klick('tbook-mit-cb', 'gil');
klick('tbook-zu-cb', 'fay');
await lauf('submitBookSession()'); await ruhe();
pruefe('A3 nur eine Zuhoerende: die Seite sagt es, bevor etwas gebucht wird',
  /mindestens 2 Personen zum Zuhören/.test(meldungen.pop() || '') && !(await eins(`SELECT 1 FROM talking_sessions WHERE slot_id=$1`, [s1])));
klick('tbook-zu-cb', 'fay');
await lauf('submitBookSession()'); await ruhe();
const sess1 = (await eins(`SELECT id FROM talking_sessions WHERE slot_id=$1`, [s1])).id;
const gilE = await einladungVon(sess1, 'gil'), eliE = await einladungVon(sess1, 'eli');
pruefe('A4 gebucht: gil traegt mit vor (noch ohne Zusage), eli und fay hoeren zu',
  gilE.rolle === 'vortrag' && gilE.status === 'eingeladen' && eliE.rolle === 'zuhoeren' && (await einladungVon(sess1, 'fay')).rolle === 'zuhoeren');
pruefe('A5 danach im Talks-Reiter: Mit-Vortrag "gil ⏳" mit ✕ zum Ausladen, gil nicht bei den Zuschauer:innen',
  html('talking-student').includes('Mit-Vortrag:') && html('talking-student').includes('🎤 gil ⏳')
  && html('talking-student').includes(`uninviteFromSession(${gilE.id})`)
  && !/pill pill-blue">gil /.test(html('talking-student')), html('talking-student'));

// ── B) die zweite Person antwortet ───────────────────────────────────────────
await als('gil');
await lauf('loadTalkingStudent()'); await ruhe();
pruefe('B1 gil sieht oben die Anfrage von dan - mit Annehmen/Ablehnen',
  html('talking-student').includes('Gemeinsam vortragen – bitte antworten (1)')
  && html('talking-student').includes('<strong>dan</strong> möchte mit dir vortragen')
  && html('talking-student').includes(`respondTalkingInvitation(${gilE.id}, true)`), html('talking-student'));
await kalender(t1);
pruefe('B2 im Kalender: "dan & Du ⏳" mit Annehmen/Ablehnen',
  html('cal-detail').includes('<strong>dan & Du <span title="noch keine Antwort">⏳</span>')
  && html('cal-detail').includes(`calRespondInvite(${gilE.id}, true)`), html('cal-detail'));
pruefe('B3 im Einladungs-Kasten: "dan moechte mit dir zusammen vortragen"',
  html('cal-invites').includes('<strong>dan</strong> möchte mit dir zusammen vortragen'), html('cal-invites'));
await lauf(`respondTalkingInvitation(${gilE.id}, true)`); await ruhe();
pruefe('B4 angenommen: der Talk steht bei gil unter den eigenen Vortraegen - gebucht von dan, ohne Verwalten',
  html('talking-student').includes('Gebucht von:') && html('talking-student').includes('Pythagoras')
  && !html('talking-student').includes('bitte antworten') && !html('talking-student').includes(`openInviteMoreModal(${sess1})`)
  && !html('talking-student').includes(`uninviteFromSession(${eliE.id})`), html('talking-student'));
await kalender(t1);
pruefe('B5 im Kalender: "dan & Du" und "🎤 Du traegst mit vor"',
  html('cal-detail').includes('<strong>dan & Du</strong>') && html('cal-detail').includes('🎤 Du trägst mit vor'), html('cal-detail'));

// ── C) aus Sicht der Zuhoerenden ─────────────────────────────────────────────
await als('eli');
await kalender(t1);
pruefe('C1 eli sieht beide Vortragenden: "dan & gil"', html('cal-detail').includes('<strong>dan & gil</strong>'), html('cal-detail'));
pruefe('C2 und eine ganz normale Einladung zum Zuhoeren', html('cal-invites').includes('<strong>dan</strong> · Pythagoras')
  && !html('cal-invites').includes('zusammen vortragen'), html('cal-invites'));
await lauf('loadTalkingStudent()'); await ruhe();
pruefe('C3 im Talks-Reiter bei den Einladungen: "Von: dan & gil"', html('talking-student').includes('dan & gil'), html('talking-student'));

// ── D) die Lernbegleitung bewertet ───────────────────────────────────────────
await als('lb');
await lauf('loadTalkingAdmin()'); await ruhe();
pruefe('D1 Terminkarte: "dan & gil" und eine eigene Pille, um gils Vortrag zu bewerten',
  html('talking-admin').includes('<strong>dan & gil</strong>')
  && html('talking-admin').includes(`openTalkingRateModal('mitvortrag', ${gilE.id}, 3,`)
  && html('talking-admin').includes('🎤 gil · ⏳ Vortrag bewerten'), html('talking-admin'));
lauf(`openTalkingRateModal('mitvortrag', ${gilE.id}, 3, 0, null, 'ausstehend')`);
pruefe('D2 das Bewerten-Fenster ist das fuer einen Vortrag (bis 3 Flammen)',
  seite.element('trate-modal-title').textContent === '🎤 Vortrag bewerten'
  && seite.element('trate-modal-status-no').textContent === '✗ Nicht gehalten' && html('trate-modal-pokale').includes('3 🔥'));
seite.element('trate-modal-status').value = 'erledigt';
lauf('selectTalkingRatePokal(3)');
await lauf('saveTalkingRateModal()'); await ruhe();
const gilNach = await einladungVon(sess1, 'gil');
pruefe('D3 gespeichert an gils Einladung: erledigt, 3 Flammen', gilNach.attended_status === 'erledigt' && gilNach.pokale === 3, gilNach);
pruefe('D4 die Karte zeigt die Bewertung', html('talking-admin').includes('🎤 gil · ✓'), html('talking-admin'));
const soll = JSON.parse(lauf('JSON.stringify(computeTalkingOverview(talkingAdminSlots))'));
const zeilen = soll.byHalbjahr['2627_1'];
pruefe('D5 Soll-Uebersicht: gils Mit-Vortrag zaehlt als gehalten, nicht als zugehoert',
  zeilen.gil.presentDone === 1 && zeilen.gil.listenDone + zeilen.gil.listenPending === 0 && zeilen.dan.presentPending === 1, soll);
const hj = await (await serverFetch('/api/admin/halbjahr-uebersicht')).json();
const hjGil = lauf(`hjSelected = '2627_1'; hjDetailHtml(__werte.s, 'mathe')`, { s: hj.students.find(s => s.username === 'gil') });
pruefe('D6 Halbjahr-Uebersicht: "gehalten mit dan"', hjGil.includes('gehalten mit dan'), hjGil);

// ── E) Grenzen einstellen, nachladen, absagen ────────────────────────────────
lauf('openSubjectSettingsModal()');
const feld = id => seite.element(id);
const hjJetzt = lauf('currentHalbjahrGuess()');
pruefe('E1 Fach-Einstellungen zeigen die Grenzen je Talk (Standard 1/2/2/5)',
  [feld('ssettings-minv').value, feld('ssettings-maxv').value, feld('ssettings-minz').value, feld('ssettings-maxz').value].join() === '1,2,2,5');
pruefe('E1b "Gilt für" steht auf dem laufenden Halbjahr (als "aktuell" markiert)',
  hjJetzt && feld('ssettings-hj').value === hjJetzt && html('ssettings-hj').includes(`Halbjahr ${hjJetzt} (aktuell)`)
  && feld('ssettings-hj-hint').textContent.includes(`gilt das nur für ${hjJetzt}`), [feld('ssettings-hj').value, html('ssettings-hj')]);
const standardVorher = await eins(`SELECT pflicht_praesentieren AS pp, pflicht_zuhoeren AS pz, optional_praesentieren AS op, optional_zuhoeren AS oz
                                   FROM subjects WHERE key='mathe'`);
feld('ssettings-maxv').value = '3';
feld('ssettings-minz').value = '6';
await lauf('submitSubjectSettings()'); await ruhe();
pruefe('E2 min ueber max: Hinweis, nichts gespeichert', /Zuhörende/.test(feld('ssettings-error').textContent)
  && (await eins(`SELECT talk_max_vortragende AS v FROM subjects WHERE key='mathe'`)).v === 2, feld('ssettings-error').textContent);
feld('ssettings-minz').value = '2';
await lauf('submitSubjectSettings()'); await ruhe();
const mathe = await eins(`SELECT * FROM subjects WHERE key='mathe'`);
pruefe('E3 gespeichert - fuer das ganze Fach; obwohl das Halbjahr vorbelegt war, entsteht ohne geaenderte Zahlen keine Halbjahr-Vorgabe',
  mathe.talk_max_vortragende === 3 && mathe.talk_min_zuhoerende === 2 && mathe.talk_max_zuhoerende === 5
  && !(await eins(`SELECT 1 FROM subject_halbjahr_targets WHERE subject_id=$1`, [F.mathe]))
  && mathe.pflicht_praesentieren === standardVorher.pp && mathe.optional_zuhoeren === standardVorher.oz, mathe);
lauf('openSubjectSettingsModal()');
const ppNeu = standardVorher.pp + 1;
feld('ssettings-pp').value = String(ppNeu);
await lauf('submitSubjectSettings()'); await ruhe();
const vorgabe = await eins(`SELECT * FROM subject_halbjahr_targets WHERE subject_id=$1`, [F.mathe]);
pruefe('E3b geaenderte Zahlen gelten nur fuer das laufende Halbjahr, der Fach-Standard bleibt',
  vorgabe && vorgabe.halbjahr === hjJetzt && vorgabe.pflicht_praesentieren === ppNeu
  && (await eins(`SELECT pflicht_praesentieren AS pp FROM subjects WHERE key='mathe'`)).pp === standardVorher.pp, vorgabe);
await lauf(`subjectsMeta = []; loadSubjectsMeta()`);
lauf('openSubjectSettingsModal()');
pruefe('E3c beim naechsten Oeffnen: laufendes Halbjahr "abweichend", mit der eigenen Zahl und "Standard verwenden"',
  feld('ssettings-pp').value == ppNeu && html('ssettings-hj').includes(`Halbjahr ${hjJetzt} (aktuell) ·  abweichend`)
  && feld('ssettings-reset').style.display === '', [feld('ssettings-pp').value, html('ssettings-hj')]);

await als('dan');
await lauf('loadTalkingStudent()'); await ruhe();
lauf(`openInviteMoreModal(${sess1})`);
liesKaestchen('tinvite-classmates');
const mitWerte = kaestchen.filter(k => k.klasse === 'tinvite-mit-cb').map(k => +k.value).sort();
pruefe('E4 weitere einladen: nur wer noch nicht dabei ist; Mit-Vortrag noch hoechstens 1, Zuhoeren noch hoechstens 3',
  mitWerte.join() === [P.hal, P.ida].sort().join() && html('tinvite-classmates').includes('noch höchstens 1')
  && html('tinvite-classmates').includes('noch höchstens 3'), html('tinvite-classmates'));
pruefe('E4b es traegt schon jemand mit vor - dann ohne die Frage "nicht alleine", die Liste steht gleich da',
  !html('tinvite-classmates').includes('nicht alleine') && !seite.element('tinvite-mit-box'), html('tinvite-classmates'));
klick('tinvite-mit-cb', 'hal');
await lauf('submitInviteMore()'); await ruhe();
const halE = await einladungVon(sess1, 'hal');
pruefe('E5 hal ist als Vortragende eingeladen', halE && halE.rolle === 'vortrag' && halE.status === 'eingeladen', halE);
await als('hal');
await lauf(`respondTalkingInvitation(${halE.id}, false)`); await ruhe();
await als('dan');
await lauf('loadTalkingStudent()'); await ruhe();
pruefe('E6 dan sieht die Absage ("🎤 hal ✗") und kann die Zeile ausladen',
  html('talking-student').includes('🎤 hal ✗') && html('talking-student').includes(`uninviteFromSession(${halE.id})`), html('talking-student'));
lauf(`openInviteMoreModal(${sess1})`);
liesKaestchen('tinvite-classmates');
pruefe('E7 und wird nicht gleich noch einmal gefragt (erst ausladen)', !kaestchen.some(k => k.value === String(P.hal)));
await lauf(`uninviteFromSession(${halE.id})`); await ruhe();
pruefe('E8 ausgeladen: die Zeile ist weg', !(await einladungVon(sess1, 'hal')));

// ── K) im Kalender buchen: Fach verlangt zwei Vortragende, Fachbuero wie bisher ──
await srv.rufe('post', '/api/admin/subjects/:id', { session: { userId: LB, role: 'admin', klasse: 'M3M4' }, params: { id: F.englisch },
  body: { minVortragende: 2, maxVortragende: 2, minZuhoerende: 1, maxZuhoerende: 3 } });
const t2 = tag(6);
const s2 = await slot(t2, 'englisch');
await als('eli');
await kalender(t2);
lauf(`openCalBookModal(${s2})`);
liesKaestchen('calbook-talk-auswahl');
pruefe('K1 Englisch: "mind. 1, hoechstens 1" beim Mit-Vortrag, "1-3" beim Zuhoeren; die Fachbuero-Liste ist aus',
  html('calbook-talk-auswahl').includes('mind. 1, höchstens 1') && html('calbook-talk-auswahl').includes('(1–3)')
  && seite.element('calbook-cm-gruppe').style.display === 'none' && html('calbook-classmates') === '', html('calbook-talk-auswahl'));
pruefe('K1b allein geht hier nicht - also keine Frage "nicht alleine", die Liste steht gleich da',
  !html('calbook-talk-auswahl').includes('nicht alleine') && !seite.element('calbook-mit-box'), html('calbook-talk-auswahl'));
seite.element('calbook-thema').value = 'My town';
klick('calbook-zu-cb', 'fay');
await lauf('submitCalBook()'); await ruhe();
pruefe('K2 allein geht es in Englisch nicht - Hinweis im Fenster, nichts gebucht',
  /mindestens 2 Personen gemeinsam/.test(seite.element('calbook-error').textContent) && !(await eins(`SELECT 1 FROM talking_sessions WHERE slot_id=$1`, [s2])));
klick('calbook-mit-cb', 'ida');
await lauf('submitCalBook()'); await ruhe();
const sess2 = await eins(`SELECT id FROM talking_sessions WHERE slot_id=$1`, [s2]);
pruefe('K3 zu zweit gebucht: ida traegt mit vor, fay hoert zu', sess2 && (await einladungVon(sess2.id, 'ida')).rolle === 'vortrag'
  && (await einladungVon(sess2.id, 'fay')).rolle === 'zuhoeren');
// anderer Tag - zur Zeit des Englisch-Talks ist eli schon belegt (Zeitkonflikt)
const t3 = tag(8);
const s3 = await slot(t3, 'mathe', 'input');
await kalender(t3);
lauf(`openCalBookModal(${s3})`);
liesKaestchen('calbook-classmates');
pruefe('K4 Fachbuero: wie bisher die eine Liste "mitbringen", keine Talk-Auswahl',
  seite.element('calbook-cm-gruppe').style.display === '' && html('calbook-talk-auswahl') === ''
  && kaestchen.length === 5 && kaestchen.every(k => k.klasse === 'calbook-cm-cb'));
seite.element('calbook-thema').value = 'Fragen';
klick('calbook-cm-cb', 'dan');
await lauf('submitCalBook()'); await ruhe();
const sess3 = await eins(`SELECT id FROM talking_sessions WHERE slot_id=$1`, [s3]);
pruefe('K5 Fachbuero gebucht, dan kommt mit', sess3 && (await einladungVon(sess3.id, 'dan')).rolle === 'zuhoeren',
  seite.element('calbook-error').textContent);

// ── W) Wochenansicht der Lernbegleitung ──────────────────────────────────────
await als('lb');
await kalender(t2);
const chip = lauf(`awChip(calData.slots.find(s => s.id === ${s2}))`);
pruefe('W1 Wochen-Chip: ida steht bei den Vortragenden (noch ohne Antwort)', chip.includes('ida') && chip.includes('trägt mit vor - noch keine Antwort'), chip);
const leute = JSON.parse(lauf(`JSON.stringify(plPersonen(calData.slots.find(s => s.id === ${s2})))`));
pruefe('W2 Plenum: ida als Vortragende', leute.some(l => l.name === 'ida' && l.haupt), leute);

console.log('\n' + ok + ' Pruefungen bestanden.');
process.exit(0);
