// Termin samt Buchung loeschen (Nutzerwunsch 2026-11-05: ein Talk, der entschuldigt nicht
// stattgefunden hat, soll unter "Noch zu bewerten" ganz verschwinden) - DELETE
// /api/admin/talking-slots/:id?mitBuchung=1 gegen echtes Postgres (pglite):
//  - ohne mitBuchung bleibt ein gebuchter Termin stehen (wie bisher),
//  - mit mitBuchung gehen Termin, Buchung und Einladungen weg,
//  - ist schon jemand bewertet, bleibt alles stehen (Flammen gingen sonst still verloren),
//  - Rechte wie bisher (eigener Termin oder Super-Admin), fremdes Tandem = nicht gefunden,
//  - Fehlerweg der Transaktion (ROLLBACK scheitert) und Doppelklick.
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
const F = {};
for (const r of (await db.query(`SELECT id, key FROM subjects`)).rows) F[r.key] = r.id;
const neu = async (name, rolle = 'student', klasse = 'M3M4') => (await eins(
  `INSERT INTO users (username, password_hash, klasse, role, aktiv) VALUES ($1,'x',$2,$3,true) RETURNING id`, [name, klasse, rolle])).id;
const LB = await neu('lb_eigen', 'admin');
const LB2 = await neu('lb_fremd', 'admin');
const SUPER = await neu('lb_super', 'admin');
await db.query(`UPDATE users SET super_admin=true WHERE id=$1`, [SUPER]);
const P = {};
for (const n of ['ada', 'bo', 'cleo']) P[n] = await neu(n);
const A = uid => ({ userId: uid, role: 'admin', klasse: 'M3M4' });
const tag = n => { const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
let stunde = 7;
const slot = async (klasse = 'M3M4') => (await eins(
  `INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
   VALUES ($1,$2,$3,'R1','2627_1',$4,'talk',45,$5,'') RETURNING id`,
  [klasse, tag(-1), String(stunde++).padStart(2, '0') + ':00', LB, F.mathe])).id;
// Gebuchter Talk von gestern: ada haelt ihn, bo hoert zu (zugesagt), cleo hat nicht geantwortet.
const gebucht = async (klasse) => {
  const s = await slot(klasse);
  const sess = (await eins(`INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,'Pythagoras') RETURNING id`, [s, P.ada])).id;
  const bo = (await eins(`INSERT INTO talking_invitations (session_id, listener_id, status) VALUES ($1,$2,'angenommen') RETURNING id`, [sess, P.bo])).id;
  await db.query(`INSERT INTO talking_invitations (session_id, listener_id, status) VALUES ($1,$2,'eingeladen')`, [sess, P.cleo]);
  return { s, sess, bo };
};
const loesche = (s, uid = LB, mitBuchung = true) => srv.rufe('delete', '/api/admin/talking-slots/:id',
  { session: A(uid), params: { id: s }, query: mitBuchung ? { mitBuchung: '1' } : {} });
const bestand = async ({ s, sess }) => ({
  slot: !!(await eins(`SELECT 1 FROM talking_slots WHERE id=$1`, [s])),
  buchung: !!(await eins(`SELECT 1 FROM talking_sessions WHERE id=$1`, [sess])),
  einladungen: +(await eins(`SELECT COUNT(*) AS n FROM talking_invitations WHERE session_id=$1`, [sess])).n,
});

// ── wie bisher ───────────────────────────────────────────────────────────────
const frei = await slot();
let r = await loesche(frei, LB, false);
pruefe('W1 ein freier Termin laesst sich wie bisher loeschen', r.code === 200 && !(await eins(`SELECT 1 FROM talking_slots WHERE id=$1`, [frei])), r);
let t = await gebucht();
r = await loesche(t.s, LB, false);
pruefe('W2 ein gebuchter ohne mitBuchung: abgelehnt wie bisher, alles bleibt', r.code === 409 && r.body.error === 'Termin ist bereits gebucht'
  && JSON.stringify(await bestand(t)) === JSON.stringify({ slot: true, buchung: true, einladungen: 2 }), [r, await bestand(t)]);

// ── mit Buchung ──────────────────────────────────────────────────────────────
r = await loesche(t.s);
pruefe('M1 mit mitBuchung: Termin, Buchung und beide Einladungen sind weg', r.code === 200
  && JSON.stringify(await bestand(t)) === JSON.stringify({ slot: false, buchung: false, einladungen: 0 }), [r, await bestand(t)]);

t = await gebucht();
await db.query(`UPDATE talking_invitations SET attended_status='erledigt', pokale=1 WHERE id=$1`, [t.bo]);
r = await loesche(t.s);
pruefe('M2 bo hat schon eine Flamme: abgelehnt mit Hinweis, alles bleibt', r.code === 409 && r.body.error.includes('erst die Bewertungen zurücksetzen')
  && JSON.stringify(await bestand(t)) === JSON.stringify({ slot: true, buchung: true, einladungen: 2 }), [r, await bestand(t)]);
await db.query(`UPDATE talking_invitations SET attended_status='ausstehend', pokale=0 WHERE id=$1`, [t.bo]);
await db.query(`UPDATE talking_sessions SET presented_status='nicht_erledigt' WHERE id=$1`, [t.sess]);
r = await loesche(t.s);
pruefe('M3 auch ein ✗ beim Vortrag zaehlt als bewertet', r.code === 409 && (await bestand(t)).slot, r);
await db.query(`UPDATE talking_sessions SET presented_status='ausstehend' WHERE id=$1`, [t.sess]);

// ── Rechte ───────────────────────────────────────────────────────────────────
r = await loesche(t.s, LB2);
pruefe('E1 fremde Lernbegleitung: nicht erlaubt, alles bleibt', r.code === 403 && (await bestand(t)).buchung, r);
r = await loesche(t.s, SUPER);
pruefe('E2 Super-Admin darf', r.code === 200 && !(await bestand(t)).slot, r);
const anders = await gebucht('KLEIN');
r = await loesche(anders.s);
pruefe('E3 Termin eines anderen Tandems: nicht gefunden, bleibt', r.code === 404 && (await bestand(anders)).buchung, r);

// ── Robustheit ───────────────────────────────────────────────────────────────
// R1 (wie beim Presenter-Tausch): scheitert das ROLLBACK, antwortet die Route trotzdem, und die
// Verbindung geht erst danach zurueck.
{
  t = await gebucht();
  await db.query(`UPDATE talking_invitations SET attended_status='erledigt', pokale=2 WHERE id=$1`, [t.bo]);
  const echt = srv.pool.connect;
  const ablauf = [];
  srv.pool.connect = async () => {
    const c = await echt();
    return {
      query: async (sql, p) => {
        if (/^\s*ROLLBACK/i.test(sql)) {
          ablauf.push('rollback'); await c.query('ROLLBACK'); ablauf.push('rollback-ende');
          throw new Error('Verbindung weg');
        }
        return c.query(sql, p);
      },
      release() { ablauf.push('release'); c.release(); },
    };
  };
  let antwort = null, geworfen = null;
  try { antwort = await loesche(t.s); } catch (e) { geworfen = e; }
  srv.pool.connect = echt;
  pruefe('R1 scheitert das ROLLBACK, antwortet die Route (kein Fehler am catch vorbei)',
    !geworfen && antwort && antwort.code >= 400, geworfen ? String(geworfen) : antwort);
  pruefe('R1b die Verbindung geht erst nach dem ROLLBACK zurueck',
    ablauf.includes('release') && ablauf.indexOf('release') > ablauf.indexOf('rollback-ende'), ablauf);
  pruefe('R1c und der bewertete Talk ist noch da', JSON.stringify(await bestand(t)) === JSON.stringify({ slot: true, buchung: true, einladungen: 2 }), await bestand(t));
}
// R2 Nochmal "Termin löschen" (z.B. aus einem zweiten, veralteten Fenster): "nicht gefunden",
// kein Absturz. Gleichzeitig (Promise.all) laesst sich das hier nicht nachstellen: die
// pglite-Attrappe hat nur EINE Verbindung, zwei Transaktionen liefen ineinander. Im echten
// Postgres wartet die zweite an der Sperre (FOR UPDATE) und findet den Termin dann nicht mehr.
{
  t = await gebucht();
  const a = await loesche(t.s);
  const b = await loesche(t.s);
  pruefe('R2 einmal geloescht, beim zweiten Mal nicht gefunden', a.code === 200 && b.code === 404 && !(await bestand(t)).slot, [a, b]);
  pruefe('R2b die Route sperrt den Termin bis zum Loeschen',
    /FROM talking_slots s LEFT JOIN talking_sessions ts ON ts.slot_id = s.id\s+WHERE s.id=\$1 AND s.klasse=\$2 FOR UPDATE OF s/.test(lies('server.js')));
}

console.log(`\n${ok} Pruefungen ok`);
process.exit(0);
