// Talk-Bewertung (Nutzerwunsch 2026-10-14): Flammen heissen "hat stattgefunden" - der Server
// stellt den Status selbst um, "ausstehend"/"nicht_erledigt" tragen keine Flammen, ein Emoji
// aendert sich nur, wenn es mitkommt. Und: schon vergebene Flammen auf "ausstehend" (frueher
// moeglich) werden beim Start zu "erledigt" - nichts geht verloren. Laeuft gegen die ECHTE
// server.js (ganz geladen, pglite); der zweite Start ist ein echter Neustart auf derselben DB.
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
let srv = await ladeServer(lies('server.js'), db);
const eins = async (sql, p) => (await db.query(sql, p || [])).rows[0];
const F = {};
for (const r of (await db.query(`SELECT id, key FROM subjects`)).rows) F[r.key] = r.id;
const neu = async (name, rolle = 'student') => (await eins(
  `INSERT INTO users (username, password_hash, klasse, role, created_at) VALUES ($1,'x','M3M4',$2,'2025-09-01') RETURNING id`,
  [name, rolle])).id;
const LB = await neu('lb_bew', 'admin');
const P = {};
for (const n of ['rita', 'sven', 'ulla', 'vera']) P[n] = await neu(n);
const A = { userId: LB, role: 'admin', klasse: 'M3M4' };

const slot = async datum => (await eins(`INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
  VALUES ('M3M4',$1,'09:00','R1','2627_1',$2,'talk',45,$3,'') RETURNING id`, [datum, LB, F.mathe])).id;
const buchung = async (slotId, presenter) => (await eins(
  `INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,'Kreise') RETURNING id`, [slotId, presenter])).id;
const einladung = async (sessionId, uid, rolle = 'zuhoeren', status = 'angenommen') => (await eins(
  `INSERT INTO talking_invitations (session_id, listener_id, status, rolle) VALUES ($1,$2,$3,$4) RETURNING id`,
  [sessionId, uid, status, rolle])).id;

const s1 = await buchung(await slot('2026-10-01'), P.rita);
const sven = await einladung(s1, P.sven, 'vortrag');
const ulla = await einladung(s1, P.ulla);

const vortrag = (body) => srv.rufe('post', '/api/admin/talking-sessions/:id/confirm-presented', { session: A, params: { id: s1 }, body });
const teilnahme = (id, body) => srv.rufe('post', '/api/admin/talking-invitations/:id/confirm-attended', { session: A, params: { id }, body });
const buchungJetzt = () => eins(`SELECT presented_status AS st, pokale, quality_emoji AS e FROM talking_sessions WHERE id=$1`, [s1]);
const einladungJetzt = id => eins(`SELECT attended_status AS st, pokale, quality_emoji AS e FROM talking_invitations WHERE id=$1`, [id]);

// ── R) Regel: Flamme = hat stattgefunden ──────────────────────────────────────
let r = await vortrag({ status: 'ausstehend', pokale: 2 });
let b = await buchungJetzt();
pruefe('R1 Flammen mit "ausstehend": wird "erledigt", die Flammen bleiben', r.code === 200 && b.st === 'erledigt' && b.pokale === 2, b);
await vortrag({ status: 'nicht_erledigt', pokale: 3 });
b = await buchungJetzt();
pruefe('R2 "nicht gehalten" traegt keine Flammen', b.st === 'nicht_erledigt' && b.pokale === 0, b);
await vortrag({ status: 'ausstehend', pokale: 0 });
b = await buchungJetzt();
pruefe('R3 ohne Flammen bleibt "ausstehend" (= zuruecksetzen)', b.st === 'ausstehend' && b.pokale === 0, b);
await vortrag({ status: 'erledigt', pokale: 0 });
b = await buchungJetzt();
pruefe('R4 "hat stattgefunden" ohne Flamme geht weiter', b.st === 'erledigt' && b.pokale === 0, b);
r = await vortrag({ status: 'quatsch', pokale: 1 });
pruefe('R5 unbekannter Status -> 400', r.code === 400, r);
await vortrag({ status: 'erledigt', pokale: 9 });
b = await buchungJetzt();
pruefe('R6 hoechstens 3 Flammen fuer einen Vortrag', b.pokale === 3, b);

// ── E) Emoji nur, wenn es mitkommt ────────────────────────────────────────────
await vortrag({ status: 'erledigt', pokale: 3, qualityEmoji: '🤩' });
await vortrag({ status: 'erledigt', pokale: 2 });
b = await buchungJetzt();
pruefe('E1 ein Klick ohne Emoji (Noch zu bewerten) laesst das Emoji stehen', b.pokale === 2 && b.e === '🤩', b);
await vortrag({ status: 'erledigt', pokale: 2, qualityEmoji: null });
b = await buchungJetzt();
pruefe('E2 das Fenster schickt "kein Emoji" ausdruecklich mit - dann ist es weg', b.e === null, b);
r = await vortrag({ status: 'erledigt', pokale: 2, qualityEmoji: '🦄' });
pruefe('E3 ein fremdes Emoji -> 400', r.code === 400, r);

// ── T) Einladungen: Zuhoeren bis 2, Mit-Vortrag bis 3, dieselbe Regel ─────────
await teilnahme(ulla, { status: 'ausstehend', pokale: 2, qualityEmoji: '👍' });
let e = await einladungJetzt(ulla);
pruefe('T1 Zuhoeren: Flammen mit "ausstehend" -> "erledigt"', e.st === 'erledigt' && e.pokale === 2 && e.e === '👍', e);
await teilnahme(ulla, { status: 'erledigt', pokale: 3 });
e = await einladungJetzt(ulla);
pruefe('T2 Zuhoeren hoechstens 2 Flammen - und das Emoji bleibt', e.pokale === 2 && e.e === '👍', e);
await teilnahme(sven, { status: 'ausstehend', pokale: 3 });
e = await einladungJetzt(sven);
pruefe('T3 Mit-Vortrag: 3 Flammen, "erledigt"', e.st === 'erledigt' && e.pokale === 3, e);
await teilnahme(ulla, { status: 'nicht_erledigt', pokale: 2 });
e = await einladungJetzt(ulla);
pruefe('T4 "nicht teilgenommen" traegt keine Flammen', e.st === 'nicht_erledigt' && e.pokale === 0, e);
await teilnahme(ulla, { status: 'nicht_erledigt', pokale: 0 });
e = await einladungJetzt(ulla);
pruefe('T5 die Wochenleiste (✗ ohne Emoji) laesst das Emoji stehen', e.e === '👍', e);

// ── Z) Zuhoeren ohne Antwort: wer als "hat stattgefunden" bewertet ist, bekommt die Flammen ──
// vera hoert zweimal zugesagt zu (je 1 Flamme) und ist zu s1 eingeladen, ohne je zu antworten.
for (const datum of ['2026-10-05', '2026-10-06']) {
  const sid = await buchung(await slot(datum), P.rita);
  await teilnahme(await einladung(sid, P.vera), { status: 'erledigt', pokale: 1 });
}
const veraOhne = await einladung(s1, P.vera, 'zuhoeren', 'eingeladen');
const ALS = uid => ({ userId: uid, role: 'student', klasse: 'M3M4' });
const flammenVon = async uid => (await srv.rufe('get', '/api/talking-sessions/mine', { session: ALS(uid), query: { subject: 'mathe' } })).body.trophies;
const rangVon = async (uid, name) => ((await srv.rufe('get', '/api/leaderboard', { session: ALS(uid), query: { halbjahr: '2627_1' } })).body.rows || [])
  .find(z => z.username === name);
let fl = await flammenVon(P.vera);
pruefe('Z0 vorher: 2 Flammen aus den zugesagten Terminen, Pflicht-Maximum 7', fl.earned === 2 && fl.max === 7, fl);
await teilnahme(veraOhne, { status: 'erledigt', pokale: 2 });
fl = await flammenVon(P.vera);
pruefe('Z1 ohne Antwort, aber als "hat stattgefunden" bewertet: die 2 Flammen zaehlen bei "Meine Flammen"',
  fl.earned === 4 && fl.max === 9, fl);
pruefe('Z2 ... und in der Rangliste', (await rangVon(P.vera, 'vera')).pokale === 4);
const veraSt = await eins(`SELECT status FROM talking_invitations WHERE id=$1`, [veraOhne]);
pruefe('Z3 die Einladung selbst bleibt unbeantwortet - umgeschrieben wird nichts', veraSt.status === 'eingeladen', veraSt);
await teilnahme(veraOhne, { status: 'nicht_erledigt', pokale: 0 });
fl = await flammenVon(P.vera);
pruefe('Z4 ✗ ohne Zusage: keine Flammen und kein Abzug - das Maximum ist wie vorher', fl.earned === 2 && fl.max === 7, fl);
await teilnahme(veraOhne, { status: 'ausstehend', pokale: 0 });

// ── N) Nachtrag im Bestand beim Start ─────────────────────────────────────────
// So sah es frueher aus: Flammen vergeben, Status nicht umgestellt.
const s2 = await buchung(await slot('2026-10-02'), P.sven);
const alt1 = await einladung(s2, P.rita);
const alt2 = await einladung(s2, P.ulla);
const alt3 = await einladung(s2, P.vera);
await db.query(`UPDATE talking_sessions SET presented_status='ausstehend', pokale=2, quality_emoji='🌟' WHERE id=$1`, [s2]);
await db.query(`UPDATE talking_invitations SET attended_status='ausstehend', pokale=1 WHERE id=$1`, [alt1]);
await db.query(`UPDATE talking_invitations SET attended_status='nicht_erledigt', pokale=2 WHERE id=$1`, [alt2]);
await db.query(`UPDATE talking_invitations SET attended_status='ausstehend', pokale=0 WHERE id=$1`, [alt3]);
const vorher = (await db.query(`SELECT id, attended_status, pokale FROM talking_invitations ORDER BY id`)).rows;
const s3 = await buchung(await slot('2026-10-03'), P.vera);   // unbewertet - bleibt
srv = await ladeServer(lies('server.js'), db);                  // Neustart
const nb = await eins(`SELECT presented_status AS st, pokale, quality_emoji AS e FROM talking_sessions WHERE id=$1`, [s2]);
pruefe('N1 Vortrag mit Flammen auf "ausstehend" -> "erledigt", Flammen und Emoji bleiben',
  nb.st === 'erledigt' && nb.pokale === 2 && nb.e === '🌟', nb);
e = await einladungJetzt(alt1);
pruefe('N2 Zuhoeren mit Flammen auf "ausstehend" -> "erledigt"', e.st === 'erledigt' && e.pokale === 1, e);
e = await einladungJetzt(alt2);
pruefe('N3 "nicht teilgenommen" mit alten Flammen bleibt unberuehrt (auch die Flammen)', e.st === 'nicht_erledigt' && e.pokale === 2, e);
e = await einladungJetzt(alt3);
pruefe('N4 unbewertet ohne Flammen bleibt unbewertet', e.st === 'ausstehend' && e.pokale === 0, e);
const n3 = await eins(`SELECT presented_status AS st FROM talking_sessions WHERE id=$1`, [s3]);
pruefe('N5 ein unbewerteter Vortrag bleibt unbewertet', n3.st === 'ausstehend', n3);
const nachher = (await db.query(`SELECT id, attended_status, pokale FROM talking_invitations ORDER BY id`)).rows;
pruefe('N6 sonst aendert sich an keiner Einladung etwas (nur alt1)',
  JSON.stringify(nachher.map(z => z.id === alt1 ? null : z)) === JSON.stringify(vorher.map(z => z.id === alt1 ? null : z)), { vorher, nachher });
srv = await ladeServer(lies('server.js'), db);                  // noch ein Start
const zweimal = (await db.query(`SELECT id, attended_status, pokale FROM talking_invitations ORDER BY id`)).rows;
pruefe('N7 ein weiterer Start aendert nichts mehr', JSON.stringify(zweimal) === JSON.stringify(nachher), zweimal);
const mine = (await srv.rufe('get', '/api/talking-sessions/mine', { session: { userId: P.sven, role: 'student', klasse: 'M3M4' }, query: { subject: 'mathe' } })).body;
pruefe('N8 die nachgetragenen Flammen zaehlen jetzt bei "Meine Flammen" (sven: 2 + 3 Mit-Vortrag)',
  mine.trophies && mine.trophies.earned >= 5, mine.trophies);

console.log('\n' + ok + ' Pruefungen bestanden.');
