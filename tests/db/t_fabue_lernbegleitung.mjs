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
pruefe('O1 die oeffentliche Woche liefert "geschlossen" und "rundeOffen"',
  ws.length > 0 && ws.every(s => 'geschlossen' in s && 'rundeOffen' in s), ws[0]);
pruefe('O2 und weiter keine Namen', !/dan|eli|fay|gil|hal/.test(JSON.stringify(woche)), JSON.stringify(woche).slice(0, 300));
const tagSeite = ladeSeite({ html: lies('public/tag.html') });
const morgen = tag(1);
const tchip = z => tagSeite.lauf('chip(__werte.s)', { s: Object.assign({ typ: 'input', datum: morgen, uhrzeit: '10:00', dauer: 45,
  subjectName: 'Mathe', subjectColor: '#2563eb', booked: true, geschlossen: false, rundeOffen: true }, z) });
pruefe('O3 Tagesseite: gebuchtes, offenes Fachbuero gruen mit "noch Plätze frei"',
  tchip({}).includes('ist-frei') && tchip({}).includes('noch Plätze frei'), tchip({}));
pruefe('O4 Tagesseite: geschlossen -> "voll" und grau',
  tchip({ geschlossen: true }).includes('ist-vergeben') && tchip({ geschlossen: true }).includes('>voll<'), tchip({ geschlossen: true }));
pruefe('O5 Tagesseite: gebuchter Talk -> "vergeben"', tchip({ typ: 'talk' }).includes('>vergeben<'), tchip({ typ: 'talk' }));

console.log('\n' + ok + ' Pruefungen bestanden.');
process.exit(0);
