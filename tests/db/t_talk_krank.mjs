// 🤒 krank/entschuldigt unter "Noch zu bewerten" (Wunsch einer Kollegin, 2026-11-18) - Server und
// Seite ZUSAMMEN (server_im_test + seite_im_test, pglite):
//  - Zuhoerende/weitere Vortragende kommen aus dem Talk (DELETE talking-invitations) - jetzt auch
//    mit ✗ (traegt nie Flammen); mit ○ oder Flammen bleibt die Zeile geschuetzt,
//  - die buchende Person: POST .../entschuldigt - die erste weitere vortragende Person uebernimmt
//    die Buchung mit ihrer eigenen Bewertung; traegt sonst niemand vor -> 409 keinVortrag und die
//    Seite bietet das Loeschen an,
//  - Rechte, Fehlerweg der Transaktion, Knopf und Klickweg auf der Seite.
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
const neu = async (name, rolle = 'student', klasse = 'M3M4') => (await eins(
  `INSERT INTO users (username, password_hash, klasse, role, created_at) VALUES ($1,'x',$2,$3, NOW() - INTERVAL '2 years') RETURNING id`,
  [name, klasse, rolle])).id;
const LB = await neu('lb', 'admin');
const P = {};
for (const n of ['ada', 'bo', 'cleo', 'dan', 'eva', 'fin']) P[n] = await neu(n);
const A = { userId: LB, role: 'admin', klasse: 'M3M4' };

const tagIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tag = n => { const d = new Date(); d.setDate(d.getDate() + n); return tagIso(d); };
const hj = (() => { const h = new Date(), m = h.getMonth() + 1, y = h.getFullYear(), s = m >= 8 ? y : y - 1;
  return String(s).slice(-2) + String(s + 1).slice(-2) + '_' + (m >= 8 || m === 1 ? 1 : 2); })();
let stunde = 7;
const buchung = async (presenter, thema, typ = 'talk', klasse = 'M3M4') => {
  const s = (await eins(`INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
    VALUES ($1,$2,$3,'R1',$4,$5,$6,45,$7,'') RETURNING id`, [klasse, tag(-1), String(stunde++).padStart(2, '0') + ':00', hj, LB, typ, F.mathe])).id;
  return { slot: s, sess: (await eins(`INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,$3) RETURNING id`,
    [s, presenter, thema])).id };
};
const einl = async (sess, uid, rolle = 'zuhoeren', status = 'angenommen') => (await eins(
  `INSERT INTO talking_invitations (session_id, listener_id, status, rolle) VALUES ($1,$2,$3,$4) RETURNING id`, [sess, uid, status, rolle])).id;
const bewerte = (id, st, pk = 0, e = null) => db.query(`UPDATE talking_invitations SET attended_status=$2, pokale=$3, quality_emoji=$4 WHERE id=$1`, [id, st, pk, e]);
const sessZeile = sess => eins(`SELECT presenter_id AS p, presented_status AS st, pokale, quality_emoji AS e FROM talking_sessions WHERE id=$1`, [sess]);
const gibtEinl = async id => !!(await eins(`SELECT 1 FROM talking_invitations WHERE id=$1`, [id]));
const austragen = id => srv.rufe('delete', '/api/admin/talking-invitations/:id', { session: A, params: { id } });
const entschuldigt = (sess, session = A) => srv.rufe('post', '/api/admin/talking-sessions/:id/entschuldigt', { session, params: { id: sess } });

// ── E) Einladungen austragen ─────────────────────────────────────────────────
let t = await buchung(P.ada, 'Eins');
const boE = await einl(t.sess, P.bo), cleoE = await einl(t.sess, P.cleo), danE = await einl(t.sess, P.dan);
await bewerte(boE, 'nicht_erledigt');
let r = await austragen(boE);
pruefe('E1 mit ✗ (traegt keine Flammen) laesst sich austragen', r.code === 200 && !(await gibtEinl(boE)), r.body);
await bewerte(cleoE, 'erledigt', 0);
r = await austragen(cleoE);
pruefe('E2 mit ○ (hat stattgefunden) bleibt geschuetzt', r.code === 409 && await gibtEinl(cleoE), r.body);
await bewerte(danE, 'erledigt', 2);
r = await austragen(danE);
pruefe('E3 mit Flammen bleibt geschuetzt', r.code === 409 && await gibtEinl(danE), r.body);

// ── B) buchende Person entschuldigt ──────────────────────────────────────────
t = await buchung(P.ada, 'Zwei');
const evaE = await einl(t.sess, P.eva, 'vortrag', 'eingeladen');       // ohne Antwort - zaehlt nicht
const finE = await einl(t.sess, P.fin, 'vortrag', 'abgelehnt');        // Absage - zaehlt nicht
r = await entschuldigt(t.sess);
pruefe('B1 sonst traegt niemand (zugesagt) vor: 409 keinVortrag, nichts geaendert',
  r.code === 409 && r.body.keinVortrag === true && (await sessZeile(t.sess)).p === P.ada && await gibtEinl(evaE) && await gibtEinl(finE), r.body);
const boV = await einl(t.sess, P.bo, 'vortrag');
await bewerte(boV, 'erledigt', 3, '🤩');
const cleoV = await einl(t.sess, P.cleo, 'vortrag');
const danZ = await einl(t.sess, P.dan);
r = await entschuldigt(t.sess);
let z = await sessZeile(t.sess);
pruefe('B2 bo (erste weitere Vortragende) uebernimmt - mit ihrer Bewertung 🔥🔥🔥 🤩',
  r.code === 200 && r.body.neuId === P.bo && z.p === P.bo && z.st === 'erledigt' && z.pokale === 3 && z.e === '🤩', [r.body, z]);
pruefe('B3 bo steht nicht mehr auf der Liste, ada ist ganz raus, cleo und dan bleiben',
  !(await gibtEinl(boV)) && await gibtEinl(cleoV) && await gibtEinl(danZ)
  && !(await eins(`SELECT 1 FROM talking_invitations WHERE session_id=$1 AND listener_id=$2`, [t.sess, P.ada])));
r = await entschuldigt(t.sess);
pruefe('B4 jetzt bo entschuldigen: bewertet -> 409, bleibt', r.code === 409 && (await sessZeile(t.sess)).p === P.bo, r.body);

t = await buchung(P.ada, 'Drei');
await db.query(`UPDATE talking_sessions SET presented_status='nicht_erledigt' WHERE id=$1`, [t.sess]);
const evaV = await einl(t.sess, P.eva, 'vortrag');
r = await entschuldigt(t.sess);
z = await sessZeile(t.sess);
pruefe('B5 ada hatte schon ✗: eva uebernimmt unbewertet (das ✗ war adas)', r.code === 200 && z.p === P.eva && z.st === 'ausstehend' && z.pokale === 0, z);

// ── R) Rechte und Fehlerwege ─────────────────────────────────────────────────
const fabue = await buchung(P.ada, 'FaBü', 'input');
r = await entschuldigt(fabue.sess);
pruefe('R1 beim Fachbuero nicht (dort gibt es ×)', r.code === 400, r.body);
const anders = await buchung(P.ada, 'Fremd', 'talk', 'KLEIN');
r = await entschuldigt(anders.sess);
pruefe('R2 Talk eines anderen Tandems: nicht gefunden', r.code === 404, r.body);
// rufe() startet nur den letzten Handler (ohne requireAdmin) - deshalb am Quelltext.
pruefe('R3 nur fuer Lernbegleitungen (requireAdmin)', /app\.post\('\/api\/admin\/talking-sessions\/:id\/entschuldigt', requireAdmin,/.test(lies('server.js'))
  && srv.routen.filter(x => x.pfad === '/api/admin/talking-sessions/:id/entschuldigt').length === 1);
{
  // Scheitert das ROLLBACK, antwortet die Route trotzdem, und die Verbindung geht erst danach zurueck.
  const t4 = await buchung(P.ada, 'Vier');
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
  try { antwort = await entschuldigt(t4.sess); } catch (e) { geworfen = e; }
  srv.pool.connect = echt;
  pruefe('R4 scheitert das ROLLBACK (niemand traegt vor), antwortet die Route', !geworfen && antwort && antwort.code >= 400, geworfen ? String(geworfen) : antwort);
  pruefe('R4b die Verbindung geht erst nach dem ROLLBACK zurueck', ablauf.indexOf('release') > ablauf.indexOf('rollback-ende'), ablauf);
  pruefe('R4c ... und ada bucht weiter', (await sessZeile(t4.sess)).p === P.ada);
}

// ── S) Seite: "Noch zu bewerten" ─────────────────────────────────────────────
await db.query(`DELETE FROM talking_slots`);
const S1 = await buchung(P.ada, 'Kreise');                 // ada bucht, bo traegt mit vor, cleo/dan hoeren zu
const boS = await einl(S1.sess, P.bo, 'vortrag'), cleoS = await einl(S1.sess, P.cleo), danS = await einl(S1.sess, P.dan);
await bewerte(danS, 'erledigt', 1);
const S2 = await buchung(P.eva, 'Allein');                 // eva bucht allein, fin hoert zu
const finS = await einl(S2.sess, P.fin);

const seite = ladeSeite();
const wer = { userId: LB, username: 'lb', role: 'admin', klasse: 'M3M4' };
let offen = 0;
const serverFetch = srv.fetchFuer(() => ({ userId: wer.userId, role: wer.role, klasse: wer.klasse }));
seite.kontext.fetch = async (...a) => { offen++; try { return await serverFetch(...a); } finally { offen--; } };
const meldungen = [], fragen = [];
let antwort = true;
seite.kontext.alert = t2 => meldungen.push(String(t2));
seite.kontext.confirm = t2 => { fragen.push(String(t2)); return antwort; };
const ruhe = async () => { do { await new Promise(r2 => setTimeout(r2, 5)); } while (offen > 0); await new Promise(r2 => setTimeout(r2, 5)); };
const lauf = (code, werte) => seite.lauf(code, werte);
const html = () => seite.element('talking-admin').innerHTML;
await lauf(`me = __werte.me; activeSubject = 'mathe'; subjectsMeta = []; loadSubjectsMeta()`, { me: wer }); await ruhe();
await lauf('loadTalkingAdmin()'); await ruhe();
lauf(`talkZbWaehlen(${S1.sess}, 'offen')`);
const personZeile = (h, name) => (h.match(new RegExp(`<div class="tzb-person">\\s*<span class="tzb-name">[^<]*${name}[\\s\\S]*?</span>\\s*</div>`)) || [''])[0];
let h = html();
pruefe('S1 Erklaerung nennt 🤒', h.includes('🤒 krank/entschuldigt – nimmt die Person aus dem Talk (zählt nicht, kein ✗)'));
const cz = personZeile(h, 'cleo');
pruefe('S2 🤒 steht zwischen ✗ und ○', cz.indexOf('>✗<') < cz.indexOf('>🤒<') && cz.indexOf('>🤒<') < cz.indexOf('>○<')
  && cz.includes(`onclick="talkZbEntschuldigt('attended', ${cleoS})">🤒</button>`) && !/aria-pressed="[^"]*"[^>]*talkZbEntschuldigt/.test(cz), cz);
pruefe('S3 bei Flammen (dan) ausgegraut, mit Hinweis', /title="krank\/entschuldigt – erst die Bewertung zurücksetzen"[^>]*disabled/.test(personZeile(h, 'dan')), personZeile(h, 'dan'));

antwort = false;
await lauf(`talkZbEntschuldigt('attended', ${cleoS})`); await ruhe();
pruefe('S4 Rueckfrage nennt die Folgen; Abbrechen aendert nichts',
  fragen.at(-1) === 'cleo ist krank/entschuldigt?\n\ncleo kommt aus diesem Talk – ohne ✗, der Talk zählt für cleo nicht.' && await gibtEinl(cleoS), fragen.at(-1));
antwort = true;
// Was der Reiter unterwegs zeigt: ein "Lade…" dazwischen liesse die Ansicht springen.
const reiter = seite.element('talking-admin');
const zugriff = Object.getOwnPropertyDescriptor(reiter, 'innerHTML');
const gezeigt = [];
Object.defineProperty(reiter, 'innerHTML', { configurable: true, get: zugriff.get, set(v) { gezeigt.push(String(v)); zugriff.set.call(this, v); } });
await lauf(`talkZbEntschuldigt('attended', ${cleoS})`); await ruhe();
h = html();
pruefe('S5 cleo ist raus, der Talk bleibt aufgeklappt - ohne "Lade…"', !(await gibtEinl(cleoS)) && !personZeile(h, 'cleo')
  && personZeile(h, 'bo') && gezeigt.length >= 1 && !gezeigt.some(g => g.includes('Lade…')), h.slice(0, 300));

await lauf(`talkZbEntschuldigt('presented', ${S1.sess})`); await ruhe();
z = await sessZeile(S1.sess);
pruefe('S6 ada (bucht) entschuldigt: Rueckfrage nennt bo als Nachfolge, bo bucht jetzt',
  fragen.at(-1).startsWith('ada ist krank/entschuldigt?\n\nbo übernimmt die Buchung (mit der eigenen Bewertung).') && z.p === P.bo && !(await gibtEinl(boS)), [fragen.at(-1), z]);

const vorher = fragen.length;
await lauf(`talkZbEntschuldigt('presented', ${S2.sess})`); await ruhe();
pruefe('S7 eva bucht allein: Loeschen mit Grund angeboten - Talk weg',
  fragen.length === vorher + 1 && fragen.at(-1).startsWith('eva ist krank/entschuldigt, und sonst trägt niemand vor – der Talk fällt aus.\n\nTalk am ')
  && !(await eins(`SELECT 1 FROM talking_slots WHERE id=$1`, [S2.slot])) && !(await gibtEinl(finS)), fragen.at(-1));

const S3 = await buchung(P.eva, 'Allein2');
const finS3 = await einl(S3.sess, P.fin);
await bewerte(finS3, 'erledigt', 0);
await lauf('talkingAdminAktualisieren()'); await ruhe();
await lauf(`talkZbEntschuldigt('presented', ${S3.sess})`); await ruhe();
pruefe('S8 ... ist dort schon jemand bewertet: Hinweis mit Grund, nichts geloescht',
  meldungen.at(-1).startsWith('eva ist krank/entschuldigt, und sonst trägt niemand vor – der Talk fällt aus.\n\nHier ist schon jemand bewertet')
  && !!(await eins(`SELECT 1 FROM talking_slots WHERE id=$1`, [S3.slot])), meldungen.at(-1));

// ── W) Wochenleiste und Fenster "Beteiligte": dieselbe Regel wie der Server ───
const W = await buchung(P.ada, 'Woche');
const boW = await einl(W.sess, P.bo), cleoW = await einl(W.sess, P.cleo);
await bewerte(boW, 'nicht_erledigt');
await bewerte(cleoW, 'erledigt', 1);
await db.query(`UPDATE talking_sessions SET presented_status='erledigt', pokale=2 WHERE id=$1`, [W.sess]);
await lauf('loadCalendar()'); await ruhe();
lauf(`document.getElementById('cal-adminweek').innerHTML = '<div id="aw-actionbar"></div>'; _awPicked = ${W.slot}; awRenderBar();`);
const bar = seite.element('aw-actionbar').innerHTML;
pruefe('W1 Wochenleiste: × bei bo (✗), nicht bei cleo (🔥) - auch wenn der Vortrag schon bewertet ist',
  bar.includes(`calRemoveInvitee(${boW})`) && !bar.includes(`calRemoveInvitee(${cleoW})`), bar);
await lauf('talkingAdminAktualisieren()'); await ruhe();
lauf(`openTalkBeteiligte(${W.sess}, 'talks')`);
const liste = seite.element('tbet-liste').innerHTML;
pruefe('W2 Fenster "Beteiligte": ✕ bei bo (✗), nicht bei cleo', liste.includes(`talkBeteiligteEntfernen(${boW})`)
  && !liste.includes(`talkBeteiligteEntfernen(${cleoW})`), liste);

console.log(`\n${ok} Pruefungen ok`);
process.exit(0);
