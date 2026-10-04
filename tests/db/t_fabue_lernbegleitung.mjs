// Fachbuero aus Sicht der Lernbegleitung (2026-10-04) - Seite und Server zusammen:
// - auch nach dem Eintragen der Anwesenheit (und nach dem Termin) Personen hinzufuegen,
// - Personen herausnehmen, auch die buchende Person (z.B. krank - der Termin findet statt),
// - gruen und "noch Plätze frei", solange man noch mitmachen anfragen kann.
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
const alle = async (sql, p) => (await db.query(sql, p || [])).rows;
const F = {};
for (const r of await alle(`SELECT id, key FROM subjects`)) F[r.key] = r.id;
const neu = async (name, rolle = 'student') => (await eins(
  `INSERT INTO users (username, password_hash, klasse, role, aktiv) VALUES ($1,'x','M3M4',$2,true) RETURNING id`, [name, rolle])).id;
const LB = await neu('lb_fabue', 'admin');
const P = {};
for (const n of ['dan', 'eli', 'fay', 'gil', 'hal']) P[n] = await neu(n);
const tag = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
let stunde = 7;
const slot = async (datum, typ = 'input') => (await eins(
  `INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
   VALUES ('M3M4',$1,$2,'R1','2627_1',$3,$4,45,$5,'') RETURNING id`,
  [datum, String(stunde++).padStart(2, '0') + ':00', LB, typ, F.mathe])).id;
const A = { userId: LB, role: 'admin', klasse: 'M3M4' };
const S = uid => ({ userId: uid, role: 'student', klasse: 'M3M4' });
const sitzung = async slotId => eins(`SELECT * FROM talking_sessions WHERE slot_id=$1`, [slotId]);
const teilnahmen = async sessionId => (await alle(
  `SELECT u.username FROM talking_invitations ti JOIN users u ON u.id = ti.listener_id WHERE ti.session_id=$1 ORDER BY u.username`,
  [sessionId])).map(z => z.username);

// ── Seite, verbunden mit dem Server ──────────────────────────────────────────
const seite = ladeSeite();
let wer = null, offen = 0;
const serverFetch = srv.fetchFuer(() => ({ userId: wer.userId, role: wer.role, klasse: wer.klasse }));
seite.kontext.fetch = async (...a) => { offen++; try { return await serverFetch(...a); } finally { offen--; } };
const meldungen = [];
seite.kontext.alert = t => meldungen.push(String(t));
let kaestchen = [];
seite.setzeQsa(sel => {
  const nurAn = sel.endsWith(':checked');
  const klasse = sel.replace(/:checked$/, '').replace(/^\./, '');
  return kaestchen.filter(k => k.klasse === klasse && (!nurAn || k.checked));
});
const lauf = (code, werte) => seite.lauf(code, werte);
const ruhe = async () => { do { await new Promise(r => setTimeout(r, 5)); } while (offen > 0); await new Promise(r => setTimeout(r, 5)); };
const html = id => seite.element(id).innerHTML;
const als = async name => {
  wer = name === 'lb' ? { userId: LB, username: 'lb_fabue', role: 'admin', klasse: 'M3M4', superAdmin: false }
    : { userId: P[name], username: name, role: 'student', klasse: 'M3M4' };
  await lauf(`me = __werte.me; subjectsMeta = []; loadSubjectsMeta()`, { me: wer });
};
const kalender = async () => {
  await lauf(`(async () => { calData = await (await fetch('/api/calendar')).json();
    calClassmates = await (await fetch('/api/classmates')).json(); })()`);
};
// Die Leiste steht sonst in der gerenderten Wochenansicht (die zeigt nur die laufende Woche).
const leiste = slotId => {
  lauf(`document.getElementById('cal-adminweek').innerHTML = '<div id="aw-actionbar"></div>'; _awPicked = ${slotId}; awRenderBar();`);
  return html('aw-actionbar');
};

// ── 1) gebuchtes Fachbuero, Anwesenheit schon eingetragen ────────────────────
const s1 = await slot(tag(0));
let r = await srv.rufe('post', '/api/talking-sessions', { session: S(P.dan), body: { slotId: s1, thema: 'Brueche', inviteeIds: [P.eli] } });
pruefe('B0 dan bucht das Fachbuero, eli kommt mit', r.code === 200, r.body);
const sess1 = r.body.sessionId;
await srv.rufe('post', '/api/admin/talking-sessions/:id/confirm-presented', { session: A, params: { id: sess1 }, body: { status: 'erledigt', pokale: 0 } });
const eliId = (await eins(`SELECT id FROM talking_invitations WHERE session_id=$1 AND listener_id=$2`, [sess1, P.eli])).id;
await srv.rufe('post', '/api/admin/talking-invitations/:id/confirm-attended', { session: A, params: { id: eliId }, body: { status: 'erledigt', pokale: 0 } });

await als('lb');
await kalender();
let bar = leiste(s1);
pruefe('E1 nach "war da" bietet die Leiste weiter "+ weitere einladen"', bar.includes(`openInputAssignModal(${s1})`) && bar.includes('+ weitere einladen'), bar);
pruefe('E2 und an der buchenden Person ein × zum Herausnehmen', bar.includes(`calRemoveBooker(${sess1})`), bar);

lauf(`openInputAssignModal(${s1})`);
kaestchen = [...html('iassign-classmates').matchAll(/<input type="checkbox" value="(\d+)" class="([^"]+)"/g)]
  .map(m => ({ value: m[1], klasse: m[2], checked: false }));
const angeboten = kaestchen.map(k => +k.value);
pruefe('E3 das Einladen-Fenster bietet weder die buchende Person noch Eingetragene an',
  !angeboten.includes(P.dan) && !angeboten.includes(P.eli) && angeboten.includes(P.fay), angeboten);
kaestchen.find(k => +k.value === P.fay).checked = true;
await lauf('submitInputAssign()'); await ruhe();
pruefe('E4 fay ist nachgetragen - obwohl die Anwesenheit schon eingetragen war',
  (await teilnahmen(sess1)).join() === 'eli,fay', await teilnahmen(sess1));

// ── 2) die buchende Person herausnehmen ──────────────────────────────────────
await kalender();
await lauf(`calRemoveBooker(${sess1})`); await ruhe();
const nach = await sitzung(s1);
pruefe('R1 dan ist heraus: keine buchende Person mehr, ihr "war da" ist zurueckgesetzt',
  nach && nach.presenter_id === null && nach.presented_status === 'ausstehend', nach);
pruefe('R2 der Termin bleibt - mit Thema und den anderen Teilnahmen',
  nach.thema === 'Brueche' && (await teilnahmen(sess1)).join() === 'eli,fay', await teilnahmen(sess1));
await kalender();
bar = leiste(s1);
pruefe('R3 die Leiste zeigt keine buchende Person mehr, die anderen bleiben', !bar.includes('hat gebucht') && bar.includes('eli') && bar.includes('fay'), bar);

// Fachbuero, an dem nur die buchende Person haengt: danach ist der Termin wieder frei.
const s2 = await slot(tag(4));
r = await srv.rufe('post', '/api/talking-sessions', { session: S(P.gil), body: { slotId: s2, thema: 'Allein', inviteeIds: [] } });
const sess2 = r.body.sessionId;
r = await srv.rufe('delete', '/api/admin/talking-sessions/:id/presenter', { session: A, params: { id: sess2 } });
pruefe('R4 nur die buchende Person war eingetragen: der Termin wird wieder frei',
  r.code === 200 && r.body.frei === true && !(await sitzung(s2)), r.body);

// Bei einem Talk wird nicht herausgenommen, sondern ausgetauscht.
const s3 = await slot(tag(5), 'talk');
r = await srv.rufe('post', '/api/talking-sessions', { session: S(P.hal), body: { slotId: s3, thema: 'Talk', inviteeIds: [P.eli, P.fay] } });
const r400 = await srv.rufe('delete', '/api/admin/talking-sessions/:id/presenter', { session: A, params: { id: r.body.sessionId } });
pruefe('R5 bei einem Talk -> 400 mit Hinweis aufs Austauschen', r400.code === 400 && /austauschen/.test(r400.body.error), r400.body);

// Die buchende Person wird beim Zuweisen nicht zusaetzlich als Teilnahme eingetragen.
const s4 = await slot(tag(6));
r = await srv.rufe('post', '/api/talking-sessions', { session: S(P.fay), body: { slotId: s4, thema: 'Doppelt?', inviteeIds: [] } });
await srv.rufe('post', '/api/admin/talking-sessions/:id/assign', { session: A, params: { id: r.body.sessionId }, body: { studentIds: [P.fay, P.gil] } });
pruefe('R6 Zuweisen mit der buchenden Person: sie steht nicht doppelt drin',
  (await teilnahmen(r.body.sessionId)).join() === 'gil', await teilnahmen(r.body.sessionId));

// ── 3) vergangenes Fachbuero: nachtragen ─────────────────────────────────────
const s5 = await slot(tag(-2));
r = await srv.rufe('post', '/api/admin/talking-sessions', { session: A, body: { slotId: s5, thema: 'Gestern', studentIds: [P.eli] } });
await kalender();
bar = leiste(s5);
pruefe('N1 am vergangenen Fachbuero heisst der Knopf "+ nachtragen"', bar.includes('+ nachtragen') && bar.includes(`openInputAssignModal(${s5})`), bar);

// ── 4) gruen / noch Plaetze frei ─────────────────────────────────────────────
const s6 = await slot(tag(7));
r = await srv.rufe('post', '/api/talking-sessions', { session: S(P.dan), body: { slotId: s6, thema: 'Prozente', inviteeIds: [] } });
await als('hal');
await kalender();
let chip = lauf(`mwChip(calData.slots.find(s => s.id === ${s6}))`);
pruefe('G1 fremd gebuchtes, offenes Fachbuero: fuer Schueler:innen gruen und "noch Plätze frei"',
  chip.includes('ist-frei') && chip.includes('noch Plätze frei'), chip.slice(0, 500));
// Derselbe Termin mit "keine weiteren Anmeldungen" (die Kachel selbst, unabhaengig davon,
// ob der Kalender ihn danach noch zeigt).
chip = lauf(`mwChip(Object.assign({}, calData.slots.find(s => s.id === ${s6}), { geschlossen: true }))`);
pruefe('G2 keine weiteren Anmeldungen: grau, kein "noch Plätze frei"',
  chip.includes('ist-vergeben') && !chip.includes('noch Plätze frei') && chip.includes('keine Anmeldung mehr'), chip.slice(0, 400));
await als('lb');
await kalender();
chip = lauf(`awChip(calData.slots.find(s => s.id === ${s1}))`);
pruefe('G3 in der Woche der Lernbegleitung: offenes, gebuchtes Fachbuero gruen mit "noch Plätze frei"',
  chip.includes('ist-frei') && chip.includes('noch Plätze frei'), chip.slice(0, 500));

// ── 5) oeffentliche Woche und Tagesseite (ohne Namen) ────────────────────────
const woche = await (await serverFetch('/api/public/week')).json();
const ws = woche.slots || [];
pruefe('O1 die oeffentliche Woche liefert "geschlossen"',
  ws.length > 0 && ws.every(s => 'geschlossen' in s), ws[0]);
pruefe('O2 und weiter keine Namen', !/dan|eli|fay|gil|hal/.test(JSON.stringify(woche)), JSON.stringify(woche).slice(0, 300));
const tagSeite = ladeSeite({ html: lies('public/tag.html') });
const morgen = tag(1);
const tchip = z => tagSeite.lauf('chip(__werte.s)', { s: Object.assign({ typ: 'input', datum: morgen, uhrzeit: '10:00', dauer: 45,
  subjectName: 'Mathe', subjectColor: '#2563eb', booked: true, geschlossen: false }, z) });
pruefe('O3 Tagesseite: gebuchtes, offenes Fachbuero gruen mit "noch Plätze frei"',
  tchip({}).includes('ist-frei') && tchip({}).includes('noch Plätze frei'), tchip({}));
pruefe('O4 Tagesseite: geschlossen -> "voll" und grau',
  tchip({ geschlossen: true }).includes('ist-vergeben') && tchip({ geschlossen: true }).includes('>voll<'), tchip({ geschlossen: true }));
pruefe('O5 Tagesseite: gebuchter Talk -> "vergeben"', tchip({ typ: 'talk' }).includes('>vergeben<'), tchip({ typ: 'talk' }));

// ── 6) ohne Zusagen: eingetragen = teilgenommen (2026-10-04) ─────────────────
const zeile = async (sessionId, name) => eins(`SELECT * FROM talking_invitations WHERE session_id=$1 AND listener_id=$2`, [sessionId, P[name]]);
// 6a) mitgebracht und mitgemacht: sofort dabei; selbst austragen bis zum Termin
const m1 = await slot(tag(9));
r = await srv.rufe('post', '/api/talking-sessions', { session: S(P.dan), body: { slotId: m1, thema: 'Gleichungen', inviteeIds: [P.eli] } });
const msess = r.body.sessionId;
pruefe('Z1 mitgebracht = dabei, ohne Annehmen', (await zeile(msess, 'eli')).status === 'angenommen', await zeile(msess, 'eli'));
await als('hal');
await kalender();
await lauf(`calRequestJoin(${m1})`); await ruhe();
const halZ = await zeile(msess, 'hal');
pruefe('Z2 "Mitmachen": hal ist sofort dabei (angenommen, selbst), keine Meldung "Anfrage gestellt"',
  halZ && halZ.status === 'angenommen' && halZ.herkunft === 'selbst' && !meldungen.some(m => /Anfrage/.test(m)), [halZ, meldungen]);
await kalender();
lauf(`calSelected = '${tag(9)}'; renderCalDetail();`);
pruefe('Z3 im Kalender: "Du machst mit" und "Nicht mehr mitmachen"',
  html('cal-detail').includes('Du machst mit') && html('cal-detail').includes(`calNichtMehrMitmachen(${halZ.id})`), html('cal-detail'));
await lauf(`calNichtMehrMitmachen(${halZ.id})`); await ruhe();
pruefe('Z4 ausgetragen: die Zeile ist weg', !(await zeile(msess, 'hal')));
const m2 = await slot(tag(10));
await srv.rufe('post', '/api/admin/talking-sessions', { session: A, body: { slotId: m2, thema: 'Eingeteilt', studentIds: [P.gil] } });
const gilZ = await zeile((await sitzung(m2)).id, 'gil');
let rw = await srv.rufe('post', '/api/talking-invitations/:id/withdraw', { session: S(P.gil), params: { id: gilZ.id } });
pruefe('Z5 eine Zuweisung der Lernbegleitung traegt man nicht selbst aus -> 409', rw.code === 409 && !!(await zeile((await sitzung(m2)).id, 'gil')), rw.body);
const m3 = await slot(tag(-3));
const m3s = (await eins(`INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,'Gestern') RETURNING id`, [m3, P.dan])).id;
const eliGestern = (await eins(`INSERT INTO talking_invitations (session_id, listener_id, status) VALUES ($1,$2,'angenommen') RETURNING id`, [m3s, P.eli])).id;
rw = await srv.rufe('post', '/api/talking-invitations/:id/withdraw', { session: S(P.eli), params: { id: eliGestern } });
pruefe('Z6 nach dem Termin traegt man sich nicht mehr selbst aus -> 409', rw.code === 409 && !!(await zeile(m3s, 'eli')), rw.body);

// 6b) Halbjahr: eingetragen = teilgenommen; altes "gefehlt" zaehlt weiter nicht; Offenes/Absagen nicht
const v = await slot(tag(-4));
const vs = (await eins(`INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,'Vergangen') RETURNING id`, [v, P.fay])).id;
await db.query(`INSERT INTO talking_invitations (session_id, listener_id, status, attended_status) VALUES
  ($1,$2,'angenommen','ausstehend'), ($1,$3,'angenommen','nicht_erledigt'), ($1,$4,'eingeladen','ausstehend'), ($1,$5,'abgelehnt','ausstehend')`,
  [vs, P.gil, P.hal, P.dan, P.eli]);
// Die Lernberatung gibt es schon (Grundausstattung aus initDB) - "nur zugewiesen".
const LBR = (await eins(`SELECT id FROM subjects WHERE key='lernberatung' AND nur_zugewiesen`)).id;
const lbSlot = (await eins(`INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
  VALUES ('M3M4',$1,'14:00','R2','2627_1',$2,'input',30,$3,'Beratung') RETURNING id`, [tag(-4), LB, LBR])).id;
const lbs = (await eins(`INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,NULL,'Beratung') RETURNING id`, [lbSlot])).id;
await db.query(`INSERT INTO talking_invitations (session_id, listener_id, status, herkunft) VALUES ($1,$2,'angenommen','zugewiesen')`, [lbs, P.gil]);
const hjB = (await srv.rufe('get', '/api/admin/halbjahr-uebersicht', { session: A })).body;
const hjFach = (name, fach) => ((hjB.students.find(s => s.username === name).byHalbjahr['2627_1'] || {}).bySubject || {})[fach] || {};
const fb = (name, thema, fach = 'mathe') => (hjFach(name, fach).inputDetails || []).filter(d => d.thema === thema);
pruefe('Z7 die buchende Person: teilgenommen, ohne dass jemand etwas bestaetigt hat',
  fb('fay', 'Vergangen').length === 1 && fb('fay', 'Vergangen')[0].status === 'erledigt', fb('fay', 'Vergangen'));
pruefe('Z8 eingetragen, nichts bestaetigt: teilgenommen (das Tool zaehlt "erledigt" als FB-Besuch)',
  fb('gil', 'Vergangen').length === 1 && fb('gil', 'Vergangen')[0].status === 'erledigt', fb('gil', 'Vergangen'));
pruefe('Z9 ein altes "gefehlt" bleibt gefehlt', fb('hal', 'Vergangen')[0] && fb('hal', 'Vergangen')[0].status === 'nicht_erledigt', fb('hal', 'Vergangen'));
pruefe('Z10 offene Einladung und Absage: keine Teilnahme, nicht in der Liste',
  fb('dan', 'Vergangen').length === 0 && fb('eli', 'Vergangen').length === 0, [fb('dan', 'Vergangen'), fb('eli', 'Vergangen')]);
pruefe('Z10b beim Fachbuero gibt es kein "noch offen" mehr', hjFach('gil', 'mathe').inputOpen === 0, hjFach('gil', 'mathe'));
pruefe('Z11 auch die Lernberatung: eingeteilt = teilgenommen, ohne Bestaetigung (kein "noch offen")',
  fb('gil', 'Beratung', 'lernberatung')[0] && fb('gil', 'Beratung', 'lernberatung')[0].status === 'erledigt'
  && hjFach('gil', 'lernberatung').inputOpen === 0 && hjFach('gil', 'lernberatung').inputParticipated === 1, hjFach('gil', 'lernberatung'));
const mineGil = (await srv.rufe('get', '/api/talking-sessions/mine', { session: S(P.gil), query: { subject: 'mathe' } })).body;
const mineDan = (await srv.rufe('get', '/api/talking-sessions/mine', { session: S(P.dan), query: { subject: 'mathe' } })).body;
pruefe('Z12 Meine Talks: das vergangene Fachbuero zaehlt als teilgenommen, die offene Einladung steht nicht drin',
  mineGil.fabue.some(f => f.thema === 'Vergangen' && f.status === 'erledigt') && !mineDan.fabue.some(f => f.thema === 'Vergangen'),
  [mineGil.fabue, mineDan.fabue]);

// 6c) Wochenleiste: beim Fachbuero nichts mehr zu bestaetigen - bei der Lernberatung schon
await als('lb');
await kalender();
bar = leiste(v);
pruefe('Z13 Fachbuero: kein "War da" mehr; "Wer eingetragen ist, hat teilgenommen", ✗ fuer unentschuldigtes Fehlen',
  !bar.includes('title="War da"') && bar.includes('Wer eingetragen ist, hat teilgenommen')
  && bar.includes('✓ teilgenommen') && bar.includes('✗ unentschuldigt gefehlt') && bar.includes('title="Hat unentschuldigt gefehlt"')
  && bar.includes('title="Fehlen zurücknehmen"'), bar);
bar = leiste(lbSlot);
pruefe('Z14 Lernberatung: genauso - kein "War da", aber "Hat unentschuldigt gefehlt"',
  !bar.includes('title="War da"') && bar.includes('title="Hat unentschuldigt gefehlt"') && bar.includes('✓ teilgenommen'), bar);

// 6c2) unentschuldigt gefehlt: vermerken, zuruecknehmen - auch bei der buchenden Person; erst ab dem Termintag
const gilV = await zeile(vs, 'gil');
await lauf(`awAnwesenheit(${gilV.id}, 'nicht_erledigt')`); await ruhe();
let hjC = (await srv.rufe('get', '/api/admin/halbjahr-uebersicht', { session: A })).body;
const fbC = (o, name, thema) => (((o.students.find(x => x.username === name).byHalbjahr['2627_1'] || {}).bySubject || {}).mathe || {}).inputDetails
  .filter(d => d.thema === thema);
pruefe('Z14b "hat unentschuldigt gefehlt" ist vermerkt und zaehlt als gefehlt, nicht als Teilnahme',
  (await zeile(vs, 'gil')).attended_status === 'nicht_erledigt' && fbC(hjC, 'gil', 'Vergangen')[0].status === 'nicht_erledigt', fbC(hjC, 'gil', 'Vergangen'));
await lauf(`awAnwesenheit(${gilV.id}, 'ausstehend')`); await ruhe();
hjC = (await srv.rufe('get', '/api/admin/halbjahr-uebersicht', { session: A })).body;
pruefe('Z14c zurueckgenommen (↩): zaehlt wieder als teilgenommen', fbC(hjC, 'gil', 'Vergangen')[0].status === 'erledigt', fbC(hjC, 'gil', 'Vergangen'));
await lauf(`awVortrag(${vs}, 'nicht_erledigt')`); await ruhe();
hjC = (await srv.rufe('get', '/api/admin/halbjahr-uebersicht', { session: A })).body;
await kalender();
bar = leiste(v);
pruefe('Z14d auch die buchende Person: unentschuldigt gefehlt vermerkbar und sichtbar',
  fbC(hjC, 'fay', 'Vergangen')[0].status === 'nicht_erledigt' && bar.includes(`awVortrag(${vs}, 'ausstehend')`), bar);
await lauf(`awVortrag(${vs}, 'ausstehend')`); await ruhe();
await kalender();
bar = leiste(m1);
pruefe('Z14e vor dem Termintag gibt es den Knopf noch nicht', !bar.includes('title="Hat unentschuldigt gefehlt"')
  && bar.includes('unentschuldigtes Fehlen vermerkst du ab dem Termintag'), bar);

// 6d) Bestand: beim Start werden offene Anfragen/Einladungen zu KOMMENDEN Fachbueros Teilnahmen
const k = await slot(tag(12));
const ks = (await eins(`INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,'Kommend') RETURNING id`, [k, P.dan])).id;
await db.query(`INSERT INTO talking_invitations (session_id, listener_id, status) VALUES ($1,$2,'angefragt'), ($1,$3,'eingeladen'), ($1,$4,'abgelehnt')`,
  [ks, P.eli, P.fay, P.gil]);
const vg = await slot(tag(-6));
const vgs = (await eins(`INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,'Frueher') RETURNING id`, [vg, P.dan])).id;
await db.query(`INSERT INTO talking_invitations (session_id, listener_id, status) VALUES ($1,$2,'angefragt')`, [vgs, P.hal]);
const lbk = (await eins(`INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
  VALUES ('M3M4',$1,'15:00','R2','2627_1',$2,'input',30,$3,'Kuenftig') RETURNING id`, [tag(12), LB, LBR])).id;
const lbks = (await eins(`INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,NULL,'Kuenftig') RETURNING id`, [lbk])).id;
await db.query(`INSERT INTO talking_invitations (session_id, listener_id, status) VALUES ($1,$2,'eingeladen')`, [lbks, P.eli]);
const talkSitzung = (await sitzung(s3)).id;
const talkVorher = (await zeile(talkSitzung, 'eli')).status;
await ladeServer(lies('server.js'), db);   // Neustart: initDB laeuft wie auf dem Server
pruefe('Z15 offene Anfrage und Einladung zum kommenden Fachbuero sind jetzt Teilnahmen',
  (await zeile(ks, 'eli')).status === 'angenommen' && (await zeile(ks, 'fay')).status === 'angenommen');
pruefe('Z16 eine Absage bleibt eine Absage', (await zeile(ks, 'gil')).status === 'abgelehnt');
pruefe('Z17 auch eine offene Anfrage zu einem VERGANGENEN Fachbuero zaehlt jetzt als Teilnahme',
  (await zeile(vgs, 'hal')).status === 'angenommen');
{
  const hjN = (await srv.rufe('get', '/api/admin/halbjahr-uebersicht', { session: A })).body;
  pruefe('Z17b in der Halbjahr-Uebersicht: die fruehere offene Einladung (dan) zaehlt als teilgenommen, die Absage (eli) nicht',
    fbC(hjN, 'dan', 'Vergangen').length === 1 && fbC(hjN, 'dan', 'Vergangen')[0].status === 'erledigt'
    && fbC(hjN, 'eli', 'Vergangen').length === 0, [fbC(hjN, 'dan', 'Vergangen'), fbC(hjN, 'eli', 'Vergangen')]);
}
pruefe('Z18 Lernberatung ebenso - Talks bleiben unberuehrt',
  (await zeile(lbks, 'eli')).status === 'angenommen' && (await zeile(talkSitzung, 'eli')).status === talkVorher && talkVorher === 'eingeladen',
  [await zeile(lbks, 'eli'), talkVorher]);

console.log('\n' + ok + ' Pruefungen bestanden.');
process.exit(0);
