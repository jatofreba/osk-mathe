// Veranstaltungen (Nutzerwunsch 2026-11-18) - Server gegen echtes Postgres (pglite):
//  - eintragen/aendern/loeschen mit Pruefung der Eingaben, fuer die ganze Gruppe oder einzelne,
//  - /api/calendar: Lernbegleitungen alle mit Betroffenen, Schueler:innen nur ihre ohne Namen,
//  - Betroffene koennen in der Zeit nichts buchen/zusagen/mitmachen und nicht eingeteilt werden
//    (Meldung nennt die Veranstaltung), Unbetroffene schon,
//  - "ganze Gruppe": dort wird nichts angelegt (Reihe laesst Tage aus), nicht hinein verschoben,
//  - beim Eintragen: was in der Zeit schon liegt (pruefen), freie Termine gleich loeschen,
//  - Fehlerweg der Transaktion.
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { ladeServer } = require('../lib/server_im_test.js');
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
const neu = async (name, rolle = 'student', klasse = 'M3M4') => (await eins(
  `INSERT INTO users (username, password_hash, klasse, role, created_at) VALUES ($1,'x',$2,$3, NOW() - INTERVAL '2 years') RETURNING id`,
  [name, klasse, rolle])).id;
const LB = await neu('lb', 'admin');
const LB2 = await neu('lb2', 'admin');
const P = {};
for (const n of ['ada', 'bo', 'cleo', 'dan']) P[n] = await neu(n);
P.fremd = await neu('fremd', 'student', 'KLEIN');
const A = { userId: LB, role: 'admin', klasse: 'M3M4' };
const S = n => ({ userId: P[n], role: 'student', klasse: 'M3M4' });

const tagIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tag = n => { const d = new Date(); d.setDate(d.getDate() + n); return tagIso(d); };
const D1 = tag(5), D2 = tag(6), D3 = tag(7);
const slot = async (datum, uhr, typ = 'input', dauer = 45) => (await eins(
  `INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
   VALUES ('M3M4',$1,$2,'R1','2627_1',$3,$4,$5,$6,'') RETURNING id`, [datum, uhr, LB, typ, dauer, F.mathe])).id;
const vst = (body, id, wer = A) => id
  ? srv.rufe('put', '/api/admin/veranstaltungen/:id', { session: wer, params: { id }, body })
  : srv.rufe('post', '/api/admin/veranstaltungen', { session: wer, body });
const kal = async wer => (await srv.rufe('get', '/api/calendar', { session: wer })).body.veranstaltungen;

// ── E) Eingaben ──────────────────────────────────────────────────────────────
for (const [was, body, text] of [
  ['ohne Titel', { titel: ' ', datumVon: D1 }, 'Bitte einen Titel angeben.'],
  ['ohne Datum', { titel: 'X' }, 'Bitte ein Datum angeben.'],
  ['Ende vor Anfang', { titel: 'X', datumVon: D2, datumBis: D1 }, 'Das Ende liegt vor dem Anfang.'],
  ['mehr als zwei Monate', { titel: 'X', datumVon: tag(1), datumBis: tag(70) }, 'Höchstens zwei Monate am Stück.'],
  ['Zeit verkehrt', { titel: 'X', datumVon: D1, von: '12:15', bis: '10:45' }, 'Bitte eine gültige Zeit angeben (Ende nach Beginn).'],
  ['einzelne ohne Personen', { titel: 'X', datumVon: D1, alle: false, personen: [] }, 'Bitte wählen, wer dabei ist – oder „ganze Gruppe“.'],
]) {
  const r = await vst(body);
  pruefe(`E1 ${was}: 400`, r.code === 400 && r.body.error === text, r.body);
}
let r = await vst({ titel: 'X', datumVon: D1, alle: false, personen: [P.ada, P.fremd] });
pruefe('E2 Person aus anderem Tandem: abgelehnt', r.code === 400 && r.body.error === 'Ungültige Person', r.body);
pruefe('E3 nichts davon wurde gespeichert', +(await eins(`SELECT count(*) AS n FROM veranstaltungen`)).n === 0);

// ── A) anlegen und sehen ─────────────────────────────────────────────────────
// ILePs: D1 ganztaegig, ganze Gruppe. Laienreanimation: D2 2. Block, ada + bo.
r = await vst({ titel: '  ILePs ', datumVon: D1, alle: true });
const ilepsId = r.body.id;
pruefe('A1 ganze Gruppe, ganzer Tag', r.code === 200 && ilepsId > 0, r.body);
r = await vst({ titel: 'Laienreanimation', datumVon: D2, datumBis: D2, von: '10:45', bis: '12:15', alle: false, personen: [P.ada, P.bo, P.ada] });
const laienId = r.body.id;
pruefe('A2 einzelne, ein Block (doppelte Person nur einmal)', r.code === 200
  && +(await eins(`SELECT count(*) AS n FROM veranstaltung_personen WHERE veranstaltung_id=$1`, [laienId])).n === 2, r.body);
let v = await kal(A);
pruefe('A3 Lernbegleitung sieht beide - mit Betroffenen', v.length === 2 && v[0].titel === 'ILePs' && v[0].alle === true
  && v[0].von === null && v[1].von === '10:45' && v[1].bis === '12:15'
  && JSON.stringify(v[1].personen.map(p => p.username)) === '["ada","bo"]', v);
v = await kal(S('ada'));
pruefe('A4 ada sieht beide, ohne die Namen der anderen', v.length === 2 && v.every(x => !('personen' in x)), v);
v = await kal(S('cleo'));
pruefe('A5 cleo sieht nur ILePs', v.length === 1 && v[0].titel === 'ILePs', v);
v = await kal({ userId: P.fremd, role: 'student', klasse: 'KLEIN' });
pruefe('A6 anderes Tandem sieht nichts', v.length === 0, v);

// ── K) Betroffene koennen nicht ──────────────────────────────────────────────
const fb2 = await slot(D2, '11:30');          // FaBue im 2. Block an D2 - in der Laienreanimation
r = await srv.rufe('post', '/api/talking-sessions', { session: S('ada'), body: { slotId: fb2, thema: 'Brüche' } });
pruefe('K1 ada bucht in der Laienreanimation: 409 mit Namen der Veranstaltung',
  r.code === 409 && r.body.error === '📌 In dieser Zeit bist du bei „Laienreanimation“.', r.body);
r = await srv.rufe('post', '/api/talking-sessions', { session: S('cleo'), body: { slotId: fb2, thema: 'Brüche' } });
pruefe('K2 cleo (nicht dabei) bucht: geht', r.code === 200, r.body);
r = await srv.rufe('post', '/api/talking-slots/:id/request', { session: S('bo'), params: { id: fb2 } });
pruefe('K3 bo will mitmachen: 409 mit Namen', r.code === 409 && r.body.error === '📌 In dieser Zeit bist du bei „Laienreanimation“.', r.body);
const sess = (await eins(`SELECT id FROM talking_sessions WHERE slot_id=$1`, [fb2])).id;
r = await srv.rufe('post', '/api/admin/talking-sessions/:id/assign', { session: A, params: { id: sess }, body: { studentIds: [P.ada, P.dan] } });
pruefe('K4 Lernbegleitung traegt ada und dan ein: dan dabei, ada mit Grund zurueck',
  r.code === 200 && r.body.assigned === 1 && r.body.conflicts.length === 1 && r.body.conflicts[0].username === 'ada'
  && r.body.conflicts[0].reason === '📌 in dieser Zeit bei „Laienreanimation“', r.body);
const talk2 = await slot(D2, '10:45', 'talk');
r = await srv.rufe('post', '/api/admin/talking-slots/:id/einteilen', { session: A, params: { id: talk2 }, body: { userId: P.bo, thema: 'X' } });
pruefe('K5 einteilen: 409 mit Namen', r.code === 409 && r.body.error === '📌 In dieser Zeit ist die Person bei „Laienreanimation“.', r.body);
const frueh = await slot(D2, '08:45');
r = await srv.rufe('post', '/api/talking-sessions', { session: S('ada'), body: { slotId: frueh, thema: 'Früh' } });
pruefe('K6 ausserhalb der Bloecke geht es fuer ada', r.code === 200, r.body);
// Einladung zusagen: cleo laedt bo zu einem Talk in der Laienreanimation ein (das darf sie), bo kann nicht zusagen.
const talk3 = await slot(D2, '11:30', 'talk');
const s3 = (await eins(`INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,'T') RETURNING id`, [talk3, P.dan])).id;
const boE = (await eins(`INSERT INTO talking_invitations (session_id, listener_id, status) VALUES ($1,$2,'eingeladen') RETURNING id`, [s3, P.bo])).id;
r = await srv.rufe('post', '/api/talking-invitations/:id/respond', { session: S('bo'), params: { id: boE }, body: { accept: true } });
pruefe('K7 bo sagt zu: 409 mit Namen, bleibt eingeladen', r.code === 409 && r.body.error === '📌 In dieser Zeit bist du bei „Laienreanimation“.'
  && (await eins(`SELECT status FROM talking_invitations WHERE id=$1`, [boE])).status === 'eingeladen', [r.code, r.body]);

// Ein Termin, der schon vor ILePs am Tag lag: fuer die ganze Gruppe nicht mehr buchbar.
const vorher = await slot(D1, '09:30');
r = await srv.rufe('post', '/api/talking-sessions', { session: S('dan'), body: { slotId: vorher, thema: 'X' } });
pruefe('K8 ganze Gruppe: alter Termin am ILePs-Tag ist fuer jede:n gesperrt', r.code === 409 && r.body.error === '📌 In dieser Zeit bist du bei „ILePs“.', r.body);
await db.query(`DELETE FROM talking_slots WHERE id=$1`, [vorher]);

// ── G) ganze Gruppe: nichts anlegen, nicht hinein verschieben ────────────────
const anlegen = body => srv.rufe('post', '/api/admin/talking-slots', { session: A, body: { typ: 'input', subjectId: F.mathe, dauer: 45, ...body } });
r = await anlegen({ datum: D1, uhrzeit: '09:30' });
pruefe('G1 FaBue am ILePs-Tag: 409, nichts angelegt', r.code === 409
  && r.body.error === `📌 Am ${D1.slice(8, 10)}.${D1.slice(5, 7)}. ist in dieser Zeit „ILePs“ für die ganze Gruppe – da wird nichts angelegt.`
  && !(await eins(`SELECT 1 FROM talking_slots WHERE datum=$1`, [D1])), r.body);
r = await anlegen({ datum: D2, uhrzeit: '11:30' });
pruefe('G2 in einer Veranstaltung nur fuer einzelne: anlegen geht', r.code === 200, r.body);
const wt = new Date(D1 + 'T00:00:00').getDay();
r = await anlegen({ uhrzeit: '13:30', recurring: { weekday: wt, von: tag(-1), bis: tag(20) } });
const reihe = (await db.query(`SELECT to_char(datum,'YYYY-MM-DD') AS d FROM talking_slots WHERE uhrzeit='13:30' ORDER BY datum`)).rows.map(x => x.d);
pruefe('G3 Reihe: der ILePs-Tag wird ausgelassen und gemeldet', r.code === 200 && !reihe.includes(D1) && r.body.count === reihe.length
  && JSON.stringify(r.body.gesperrt) === JSON.stringify([{ datum: D1, titel: 'ILePs' }]), [r.body, reihe]);
// Forumstheater D3 1. Block (08:45-10:15), ganze Gruppe.
r = await vst({ titel: 'Forumstheater', datumVon: D3, von: '08:45', bis: '10:15', alle: true });
const forumId = r.body.id;
r = await anlegen({ datum: D3, uhrzeit: '10:00' });
pruefe('G4 Termin, der in den Block hineinragt (10:00-10:45): 409', r.code === 409, r.body);
r = await anlegen({ datum: D3, uhrzeit: '10:15' });
pruefe('G5 direkt im Anschluss (10:15): geht', r.code === 200, r.body);
const danach = r.body.ids[0];
const verschieben = (id, body) => srv.rufe('post', '/api/admin/talking-slots/:id/reschedule', { session: A, params: { id }, body });
r = await verschieben(danach, { datum: D3, uhrzeit: '09:30', ort: 'R1', dauer: 45 });
pruefe('G6 in den Block verschieben: 409', r.code === 409 && /Forumstheater/.test(r.body.error)
  && (await eins(`SELECT uhrzeit FROM talking_slots WHERE id=$1`, [danach])).uhrzeit === '10:15', r.body);
// Ein Termin, der schon vor der Veranstaltung im Block lag, laesst sich weiter bearbeiten.
const alt = await slot(D3, '09:00');
r = await verschieben(alt, { datum: D3, uhrzeit: '09:00', ort: 'Neuer Raum', dauer: 45 });
pruefe('G7 alter Termin im Block: Ort aendern geht', r.code === 200 && (await eins(`SELECT ort FROM talking_slots WHERE id=$1`, [alt])).ort === 'Neuer Raum', r.body);

// ── P) beim Eintragen: was liegt schon da? ───────────────────────────────────
const D4 = tag(8);
const frei1 = await slot(D4, '10:45'), frei2 = await slot(D4, '11:30', 'talk');
const geb = await slot(D4, '11:30');
const gs = (await eins(`INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,'G') RETURNING id`, [geb, P.cleo])).id;
await db.query(`INSERT INTO talking_invitations (session_id, listener_id, status) VALUES ($1,$2,'angenommen'), ($1,$3,'abgelehnt')`, [gs, P.dan, P.ada]);
const ausserhalb = await slot(D4, '08:45');
const body4 = { titel: 'Sporttag', datumVon: D4, von: '10:45', bis: '12:15', alle: true };
r = await vst({ ...body4, pruefen: true });
pruefe('P1 pruefen: zwei freie, ein gebuchter (cleo, dan - ohne Absage), nichts gespeichert',
  r.code === 200 && JSON.stringify(r.body.kollisionen.frei.map(x => x.id)) === JSON.stringify([frei1, frei2])
  && r.body.kollisionen.gebucht.length === 1 && r.body.kollisionen.gebucht[0].id === geb
  && JSON.stringify(r.body.kollisionen.gebucht[0].personen) === '["cleo","dan"]'
  && !(await eins(`SELECT 1 FROM veranstaltungen WHERE titel='Sporttag'`)), r.body);
r = await vst({ ...body4, alle: false, personen: [P.dan, P.bo], pruefen: true });
pruefe('P2 nur fuer dan und bo: freie zaehlen nicht, beim gebuchten nur dan', r.code === 200 && r.body.kollisionen.frei.length === 0
  && JSON.stringify(r.body.kollisionen.gebucht.map(x => x.personen)) === '[["dan"]]', r.body);
r = await vst({ ...body4, freieLoeschen: true });
pruefe('P3 speichern mit "freie loeschen": beide freien weg, gebuchter und der ausserhalb bleiben',
  r.code === 200 && r.body.geloescht === 2 && !(await eins(`SELECT 1 FROM talking_slots WHERE id = ANY($1::int[])`, [[frei1, frei2]]))
  && !!(await eins(`SELECT 1 FROM talking_slots WHERE id=$1`, [geb])) && !!(await eins(`SELECT 1 FROM talking_slots WHERE id=$1`, [ausserhalb])), r.body);
const sportId = r.body.id;

// ── U) aendern und loeschen ──────────────────────────────────────────────────
r = await vst({ titel: 'Laienreanimation', datumVon: D2, von: '10:45', bis: '12:15', alle: false, personen: [P.cleo] }, laienId);
v = (await kal(A)).find(x => x.id === laienId);
pruefe('U1 aendern: jetzt nur cleo', r.code === 200 && JSON.stringify(v.personen.map(p => p.username)) === '["cleo"]', v);
// bos offene Einladung aus K7 (gleiche Zeit) belegt die Zeit ohnehin - die kommt weg.
await db.query(`DELETE FROM talking_invitations WHERE id=$1`, [boE]);
r = await srv.rufe('post', '/api/talking-slots/:id/request', { session: S('bo'), params: { id: fb2 } });
pruefe('U2 bo kann jetzt mitmachen', r.code === 200, r.body);
r = await vst({ titel: 'X', datumVon: D1 }, 99999);
pruefe('U3 unbekannte Veranstaltung: 404', r.code === 404, r.body);
r = await vst({ titel: 'Fremd', datumVon: D1 }, laienId, { userId: P.fremd, role: 'admin', klasse: 'KLEIN' });
pruefe('U4 anderes Tandem: 404, bleibt', r.code === 404 && (await eins(`SELECT titel FROM veranstaltungen WHERE id=$1`, [laienId])).titel === 'Laienreanimation', r.body);
r = await vst({ titel: 'ILePs (geändert von lb2)', datumVon: D1 }, ilepsId, { userId: LB2, role: 'admin', klasse: 'M3M4' });
pruefe('U5 jede Lernbegleitung des Tandems darf aendern', r.code === 200, r.body);
r = await srv.rufe('delete', '/api/admin/veranstaltungen/:id', { session: A, params: { id: forumId } });
pruefe('U6 loeschen: weg', r.code === 200 && !(await eins(`SELECT 1 FROM veranstaltungen WHERE id=$1`, [forumId])), r.body);
r = await anlegen({ datum: D3, uhrzeit: '09:00' });
pruefe('U7 danach laesst sich im Block wieder anlegen', r.code === 200, r.body);
r = await srv.rufe('delete', '/api/admin/veranstaltungen/:id', { session: { userId: P.fremd, role: 'admin', klasse: 'KLEIN' }, params: { id: sportId } });
pruefe('U8 loeschen aus anderem Tandem: 404', r.code === 404 && !!(await eins(`SELECT 1 FROM veranstaltungen WHERE id=$1`, [sportId])), r.body);
pruefe('U9 nur fuer Lernbegleitungen (requireAdmin)', ["app.post('/api/admin/veranstaltungen', requireAdmin,",
  "app.put('/api/admin/veranstaltungen/:id', requireAdmin,", "app.delete('/api/admin/veranstaltungen/:id', requireAdmin,"].every(x => lies('server.js').includes(x)));

// ── R) Fehlerweg ─────────────────────────────────────────────────────────────
{
  const echt = srv.pool.connect;
  const ablauf = [];
  srv.pool.connect = async () => {
    const c = await echt();
    return {
      query: async (sql, p) => {
        if (/^\s*ROLLBACK/i.test(sql)) { ablauf.push('rollback'); await c.query('ROLLBACK'); ablauf.push('rollback-ende'); throw new Error('Verbindung weg'); }
        return c.query(sql, p);
      },
      release() { ablauf.push('release'); c.release(); },
    };
  };
  let antwort = null, geworfen = null;
  try { antwort = await vst({ titel: 'X', datumVon: D1, alle: false, personen: [P.fremd] }); } catch (e) { geworfen = e; }
  srv.pool.connect = echt;
  pruefe('R1 scheitert das ROLLBACK, antwortet die Route', !geworfen && antwort && antwort.code >= 400, geworfen ? String(geworfen) : antwort);
  pruefe('R1b die Verbindung geht erst nach dem ROLLBACK zurueck', ablauf.indexOf('release') > ablauf.indexOf('rollback-ende'), ablauf);
}

console.log(`\n${ok} Pruefungen ok`);
process.exit(0);
