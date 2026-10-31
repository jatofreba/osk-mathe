// Terminplanung (Nutzerwunsch 2026-10-31): hoechstens 8 Wochen im Voraus - fuer alle, auch
// Super-Admins; eine Reihe wird bis zum Stichtag angelegt - und die Terminverwaltung: Liste der
// anstehenden Termine (Super-Admins: alle des Tandems, sonst die eigenen) und Sammel-Stornieren/
// -Loeschen mit allen Schutzregeln. Laeuft gegen die ECHTE server.js (ganz geladen, pglite).
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { ladeServer } = require('../lib/server_im_test.js');
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
const neu = async (name, rolle = 'student', klasse = 'M3M4') =>
  (await eins(`INSERT INTO users (username, password_hash, klasse, role) VALUES ($1,'x',$2,$3) RETURNING id`, [name, klasse, rolle])).id;
const LB1 = await neu('lb_super', 'admin');
await db.query(`UPDATE users SET super_admin=true WHERE id=$1`, [LB1]);
const LB2 = await neu('lb_normal', 'admin');
const LB9 = await neu('lb_fremd', 'admin', 'M1M2');
const P = {};
for (const n of ['ana', 'ben', 'cem']) P[n] = await neu(n);
const A1 = { userId: LB1, role: 'admin', klasse: 'M3M4' };
const A2 = { userId: LB2, role: 'admin', klasse: 'M3M4' };

const tagIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tag = n => { const h = new Date(); return tagIso(new Date(h.getFullYear(), h.getMonth(), h.getDate() + n)); };
const ST = tag(56);                                   // Stichtag: 8 Wochen ab heute
const deTag = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const anlegen = (sess, body) => srv.rufe('post', '/api/admin/talking-slots',
  { session: sess, body: { typ: 'input', uhrzeit: '10:00', dauer: 45, ort: 'R1', subjectId: F.mathe, ...body } });
const verschieben = (sess, id, body) => srv.rufe('post', '/api/admin/talking-slots/:id/reschedule',
  { session: sess, params: { id }, body: { uhrzeit: '10:00', dauer: 45, ort: 'R1', halbjahr: '', ...body } });
const slotDatum = async id => (await eins(`SELECT to_char(datum,'YYYY-MM-DD') AS d, ort FROM talking_slots WHERE id=$1`, [id]));

// ── F) 8-Wochen-Frist ────────────────────────────────────────────────────────
let r = await anlegen(A2, { datum: ST });
pruefe('F1 genau am Stichtag geht', r.code === 200 && r.body.count === 1 && r.body.gekuerzt === 0, r.body);
r = await anlegen(A2, { datum: tag(57) });
pruefe('F2 einen Tag danach: abgelehnt, mit Stichtag in der Meldung',
  r.code === 400 && r.body.error.includes('8 Wochen') && r.body.error.includes('bis zum ' + deTag(ST)) && r.body.stichtag === ST, r.body);
const heuteWt = new Date().getDay();
r = await anlegen(A2, { uhrzeit: '12:00', recurring: { weekday: String(heuteWt), von: tag(0), bis: tag(77) } });
pruefe('F3 Reihe ueber den Stichtag: bis dorthin angelegt (9), der Rest gemeldet (3)',
  r.code === 200 && r.body.count === 9 && r.body.gekuerzt === 3 && r.body.stichtag === ST && r.body.ids.length === 9, r.body);
const reihe = await alle(`SELECT to_char(datum,'YYYY-MM-DD') AS d FROM talking_slots WHERE id = ANY($1::int[]) ORDER BY datum`, [r.body.ids]);
pruefe('F4 die Reihe liegt auf dem richtigen Wochentag und endet am Stichtag',
  reihe.every(z => new Date(z.d + 'T00:00:00').getDay() === heuteWt) && reihe[0].d === tag(0) && reihe[reihe.length - 1].d === ST, reihe);
r = await anlegen(A2, { recurring: { weekday: String(heuteWt), von: tag(60), bis: tag(90) } });
pruefe('F5 Reihe ganz hinter dem Stichtag: nichts angelegt, Meldung', r.code === 400 && r.body.error.includes(deTag(ST)), r.body);
const reiheId = (await eins(`SELECT id FROM talking_slots WHERE admin_id=$1 AND uhrzeit='12:00' ORDER BY datum LIMIT 1`, [LB2])).id;
r = await verschieben(A2, reiheId, { datum: tag(10) });
pruefe('F6 verschieben innerhalb der Frist geht', r.code === 200 && (await slotDatum(reiheId)).d === tag(10), r.body);
r = await verschieben(A2, reiheId, { datum: tag(57) });
pruefe('F7 hinter den Stichtag verschieben: abgelehnt', r.code === 400 && r.body.error.includes(deTag(ST)) && (await slotDatum(reiheId)).d === tag(10), r.body);
const weit = (await eins(`INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
  VALUES ('M3M4',$1,'09:00','R1','',$2,'input',45,$3,'') RETURNING id`, [tag(70), LB2, F.mathe])).id;
r = await verschieben(A2, weit, { datum: tag(70), uhrzeit: '09:00', ort: 'R9' });
pruefe('F8 ein schon weiter entfernter Termin bleibt bearbeitbar, solange sein Datum bleibt',
  r.code === 200 && (await slotDatum(weit)).ort === 'R9', r.body);
r = await verschieben(A2, weit, { datum: tag(71), uhrzeit: '09:00' });
pruefe('F9 ... aber nicht noch weiter weg', r.code === 400 && (await slotDatum(weit)).d === tag(70), r.body);
r = await anlegen(A1, { datum: tag(57) });
pruefe('F10 die Frist gilt auch fuer Super-Admins', r.code === 400, r.body);
r = await anlegen(A1, { typ: 'talk', halbjahr: '2627_1', datum: tag(14) });
pruefe('F11 Talks laufen ueber dieselbe Regel (innerhalb: geht)', r.code === 200, r.body);

// ── L) Liste der anstehenden Termine ─────────────────────────────────────────
const slot = async (admin, datum, typ = 'input', klasse = 'M3M4', fach = F.mathe) => (await eins(
  `INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
   VALUES ($1,$2,'08:00','R2',$3,$4,$5,45,$6,'Ausgeschrieben') RETURNING id`, [klasse, datum, typ === 'talk' ? '2627_1' : '', admin, typ, fach])).id;
const sess = async (slotId, presenter, thema = 'Gebucht') => (await eins(
  `INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,$3) RETURNING id`, [slotId, presenter, thema])).id;
const einl = (sid, uid, status = 'angenommen') => db.query(
  `INSERT INTO talking_invitations (session_id, listener_id, status) VALUES ($1,$2,$3)`, [sid, uid, status]);

const frei1 = await slot(LB1, tag(3));
const fabue2 = await slot(LB2, tag(4), 'input', 'M3M4', F.englisch);
const fabueSess = await sess(fabue2, null, '');
await einl(fabueSess, P.ana); await einl(fabueSess, P.ben, 'abgelehnt');
const talk2 = await slot(LB2, tag(5), 'talk');
const talkSess = await sess(talk2, P.cem, 'Kreise');
await einl(talkSess, P.ana);
const vorbei2 = await slot(LB2, tag(-3));
const heute2 = await slot(LB2, tag(0), 'talk');
const heuteSess = await sess(heute2, P.ben, 'Heute schon');
await db.query(`UPDATE talking_sessions SET presented_status='erledigt', pokale=2 WHERE id=$1`, [heuteSess]);
const frei2 = await slot(LB2, tag(6));
const fremd9 = await slot(LB9, tag(3), 'input', 'M1M2');

const liste = async sess => (await srv.rufe('get', '/api/admin/termine', { session: sess })).body;
let L2 = await liste(A2);
const ids2 = L2.termine.map(t => t.id);
pruefe('L1 normale Lernbegleitung: nur die eigenen anstehenden - keine fremden, keine vergangenen, kein anderes Tandem',
  L2.superAdmin === false && [fabue2, talk2, heute2, frei2].every(id => ids2.includes(id))
  && ![frei1, vorbei2, fremd9].some(id => ids2.includes(id)) && L2.termine.every(t => t.adminId === LB2), L2.termine.map(t => [t.id, t.adminName, t.datum]));
const zeileF = L2.termine.find(t => t.id === fabue2), zeileT = L2.termine.find(t => t.id === talk2);
pruefe('L2 je Termin, wer dabei ist (ohne Absagen) und das Thema',
  JSON.stringify(zeileF.beteiligte) === '["ana"]' && zeileF.buchend === null && zeileF.thema === 'Ausgeschrieben'
  && zeileT.buchend === 'cem' && JSON.stringify(zeileT.beteiligte) === '["ana"]' && zeileT.thema === 'Kreise', [zeileF, zeileT]);
pruefe('L3 heute schon Bewertetes ist markiert, Freies hat keine Buchung',
  L2.termine.find(t => t.id === heute2).bewertet === true && zeileT.bewertet === false && L2.termine.find(t => t.id === frei2).sessionId === null);
pruefe('L4 sortiert nach Datum', L2.termine.every((t, i, a) => !i || a[i - 1].datum <= t.datum), L2.termine.map(t => t.datum));
const L1 = await liste(A1);
pruefe('L5 Super-Admin: alle anstehenden des Tandems, mit Lernbegleitung',
  L1.superAdmin === true && [frei1, fabue2, talk2, frei2].every(id => L1.termine.some(t => t.id === id))
  && !L1.termine.some(t => t.id === fremd9 || t.id === vorbei2) && L1.termine.find(t => t.id === frei1).adminName === 'lb_super', L1.termine.length);

// ── S) Sammel-Stornieren/-Loeschen ───────────────────────────────────────────
const sammel = (sess, body) => srv.rufe('post', '/api/admin/termine/sammel', { session: sess, body });
const gibt = async id => !!(await eins(`SELECT id FROM talking_slots WHERE id=$1`, [id]));
const gebucht = async id => !!(await eins(`SELECT id FROM talking_sessions WHERE slot_id=$1`, [id]));
r = await sammel(A2, { ids: [frei2, frei1, vorbei2, heute2, fremd9], aktion: 'loeschen' });
const grund = id => (r.body.uebersprungen.find(x => x.id === id) || {}).grund;
pruefe('S1 gemischt: der eigene freie geht, der Rest bleibt - je mit Grund',
  r.code === 200 && JSON.stringify(r.body.erledigt) === JSON.stringify([frei2]) && !(await gibt(frei2))
  && grund(frei1) === 'Termin einer anderen Lernbegleitung' && grund(vorbei2) === 'schon vorbei'
  && grund(heute2) === 'schon etwas eingetragen' && grund(fremd9) === 'nicht gefunden'
  && await gibt(frei1) && await gibt(vorbei2) && await gibt(heute2) && await gibt(fremd9), r.body);
r = await sammel(A2, { ids: [fabue2], aktion: 'loeschen' });
pruefe('S2 gebucht ohne Zustimmung: bleibt stehen ("gebucht")',
  (r.body.uebersprungen[0] || {}).grund === 'gebucht' && r.body.erledigt.length === 0 && await gebucht(fabue2), r.body);
r = await sammel(A2, { ids: [talk2], aktion: 'stornieren' });
const einlRest = await eins(`SELECT count(*)::int AS n FROM talking_invitations WHERE session_id=$1`, [talkSess]);
pruefe('S3 stornieren: Buchung samt Einladungen weg, der Termin bleibt frei stehen',
  JSON.stringify(r.body.erledigt) === JSON.stringify([talk2]) && await gibt(talk2) && !(await gebucht(talk2)) && einlRest.n === 0, r.body);
r = await sammel(A2, { ids: [talk2], aktion: 'stornieren' });
pruefe('S4 einen freien stornieren: "nicht gebucht"', r.body.uebersprungen[0].grund === 'nicht gebucht', r.body);
r = await sammel(A2, { ids: [fabue2], aktion: 'loeschen', gebuchteAuch: true });
const fabueEinl = await eins(`SELECT count(*)::int AS n FROM talking_invitations WHERE session_id=$1`, [fabueSess]);
pruefe('S5 mit Zustimmung: gebuchter Termin abgesagt und geloescht (Buchung, Einladungen, Termin)',
  JSON.stringify(r.body.erledigt) === JSON.stringify([fabue2]) && !(await gibt(fabue2)) && fabueEinl.n === 0, r.body);
r = await sammel(A1, { ids: [talk2, frei1], aktion: 'loeschen' });
pruefe('S6 Super-Admin loescht auch Termine anderer Lernbegleitungen', r.body.erledigt.length === 2 && !(await gibt(talk2)) && !(await gibt(frei1)), r.body);
r = await sammel(A1, { ids: [heute2], aktion: 'loeschen', gebuchteAuch: true });
pruefe('S7 Eingetragenes bleibt auch fuer Super-Admins und mit Zustimmung stehen',
  r.body.uebersprungen[0].grund === 'schon etwas eingetragen' && await gibt(heute2) && await gebucht(heute2), r.body);
r = await sammel(A2, { ids: [], aktion: 'loeschen' });
const r2 = await sammel(A2, { ids: [vorbei2], aktion: 'quatsch' });
pruefe('S8 ohne Termine oder mit unbekannter Aktion: 400', r.code === 400 && r2.code === 400, [r.body, r2.body]);

console.log('\n' + ok + ' Pruefungen bestanden.');
