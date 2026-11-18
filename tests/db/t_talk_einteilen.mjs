// Talk einteilen (Wunsch einer Kollegin, 2026-11-18) - Server und Seite ZUSAMMEN (pglite):
//  - POST /api/admin/talking-slots/:id/einteilen: die Lernbegleitung bestimmt, wer einen FREIEN
//    Talk-Termin haelt - danach ist er vergeben, niemand sonst kann ihn buchen,
//  - Regeln: nur Talks, Thema (oder das ausgeschriebene), aktive Schueler:in der Klasse,
//    Zeitkonflikt, schon gebucht; Fehlerweg der Transaktion,
//  - Seite: "+ einteilen" an freien Talks (Wochenleiste, Kalender-Tag, Talks-Reiter), am gebuchten
//    "👥 Beteiligte / einladen"; Fenster mit Suche, danach gleich "Beteiligte" fuer die uebrigen.
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
for (const n of ['ada', 'bo', 'cleo', 'dan']) P[n] = await neu(n);
P.alt = await neu('alt'); await db.query(`UPDATE users SET aktiv=false WHERE id=$1`, [P.alt]);
P.fremd = await neu('fremd', 'student', 'KLEIN');
const A = { userId: LB, role: 'admin', klasse: 'M3M4' };

const tagIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tag = n => { const d = new Date(); d.setDate(d.getDate() + n); return tagIso(d); };
const hj = (() => { const h = new Date(), m = h.getMonth() + 1, y = h.getFullYear(), s = m >= 8 ? y : y - 1;
  return String(s).slice(-2) + String(s + 1).slice(-2) + '_' + (m >= 8 || m === 1 ? 1 : 2); })();
let stunde = 7;
const slot = async ({ datum = tag(3), typ = 'talk', thema = '', klasse = 'M3M4', uhr } = {}) => (await eins(
  `INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
   VALUES ($1,$2,$3,'R1',$4,$5,$6,45,$7,$8) RETURNING id`,
  [klasse, datum, uhr || String(stunde++).padStart(2, '0') + ':00', hj, LB, typ, F.mathe, thema])).id;
const einteilen = (id, body) => srv.rufe('post', '/api/admin/talking-slots/:id/einteilen', { session: A, params: { id }, body });
const buchung = id => eins(`SELECT presenter_id AS p, thema FROM talking_sessions WHERE slot_id=$1`, [id]);

// ── N) Server ────────────────────────────────────────────────────────────────
let s = await slot();
let r = await einteilen(s, { userId: P.ada, thema: 'Pythagoras' });
pruefe('N1 ada haelt den freien Talk', r.code === 200 && r.body.sessionId && JSON.stringify(await buchung(s)) === JSON.stringify({ p: P.ada, thema: 'Pythagoras' }), r.body);
r = await einteilen(s, { userId: P.bo, thema: 'Anders' });
pruefe('N2 nochmal einteilen: schon gebucht, bleibt bei ada', r.code === 409 && r.body.error === 'Termin bereits gebucht' && (await buchung(s)).p === P.ada, r.body);
r = await srv.rufe('post', '/api/talking-sessions', { session: { userId: P.bo, role: 'student', klasse: 'M3M4' },
  body: { slotId: s, thema: 'Meins', inviteeIds: [P.cleo, P.dan] } });
pruefe('N3 und keine Schueler:in kann ihn mehr buchen', r.code === 409 && (await buchung(s)).p === P.ada, r.body);
s = await slot({ thema: 'Ausgeschrieben' });
r = await einteilen(s, { userId: P.bo });
pruefe('N4 ohne Thema gilt das ausgeschriebene', r.code === 200 && (await buchung(s)).thema === 'Ausgeschrieben', r.body);
s = await slot();
r = await einteilen(s, { userId: P.bo, thema: '  ' });
pruefe('N5 ohne jedes Thema: 400, frei', r.code === 400 && !(await buchung(s)), r.body);
r = await einteilen(s, {});
pruefe('N6 ohne Person: 400', r.code === 400 && !(await buchung(s)), r.body);
for (const [was, uid] of [['passiv gesetzt', P.alt], ['anderes Tandem', P.fremd], ['Lernbegleitung', LB]]) {
  r = await einteilen(s, { userId: uid, thema: 'X' });
  pruefe(`N7 ${was}: ungueltige Person, frei`, r.code === 400 && r.body.error === 'Ungültige Person' && !(await buchung(s)), r.body);
}
const fb = await slot({ typ: 'input' });
r = await einteilen(fb, { userId: P.bo, thema: 'X' });
pruefe('N8 beim Fachbuero nicht (dort "+ einladen")', r.code === 400 && !(await buchung(fb)), r.body);
r = await einteilen(await slot({ klasse: 'KLEIN' }), { userId: P.bo, thema: 'X' });
pruefe('N9 Termin eines anderen Tandems: nicht gefunden', r.code === 404, r.body);
// cleo hat zur selben Zeit schon einen Talk (gebucht ueber einen anderen Termin).
const zeit = tag(4);
const anderer = await slot({ datum: zeit, uhr: '10:00' });
await einteilen(anderer, { userId: P.cleo, thema: 'Erster' });
s = await slot({ datum: zeit, uhr: '10:00' });
r = await einteilen(s, { userId: P.cleo, thema: 'Zweiter' });
pruefe('N10 Zeitkonflikt: 409, frei', r.code === 409 && /Zeitkonflikt/.test(r.body.error) && !(await buchung(s)), r.body);
s = await slot({ datum: tag(-2) });
r = await einteilen(s, { userId: P.dan, thema: 'Nachgetragen' });
pruefe('N11 vergangener Termin: nachtragen geht', r.code === 200 && (await buchung(s)).p === P.dan, r.body);
pruefe('N12 nur fuer Lernbegleitungen (requireAdmin)', /app\.post\('\/api\/admin\/talking-slots\/:id\/einteilen', requireAdmin,/.test(lies('server.js')));
{
  // Scheitert das ROLLBACK, antwortet die Route trotzdem, und die Verbindung geht erst danach zurueck.
  const s2 = await slot();
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
  try { antwort = await einteilen(s2, { userId: P.alt, thema: 'X' }); } catch (e) { geworfen = e; }
  srv.pool.connect = echt;
  pruefe('N13 scheitert das ROLLBACK, antwortet die Route', !geworfen && antwort && antwort.code >= 400, geworfen ? String(geworfen) : antwort);
  pruefe('N13b die Verbindung geht erst nach dem ROLLBACK zurueck', ablauf.indexOf('release') > ablauf.indexOf('rollback-ende'), ablauf);
}

// ── S) Seite ─────────────────────────────────────────────────────────────────
await db.query(`DELETE FROM talking_slots`);
const frei = await slot({ datum: tag(2), thema: 'Kreise' });
const gebucht = await slot({ datum: tag(2) });
await einteilen(gebucht, { userId: P.dan, thema: 'Schon' });
const gebuchtSess = (await eins(`SELECT id FROM talking_sessions WHERE slot_id=$1`, [gebucht])).id;

const seite = ladeSeite();
const wer = { userId: LB, username: 'lb', role: 'admin', klasse: 'M3M4' };
let offen = 0;
const serverFetch = srv.fetchFuer(() => ({ userId: wer.userId, role: wer.role, klasse: wer.klasse }));
seite.kontext.fetch = async (...a) => { offen++; try { return await serverFetch(...a); } finally { offen--; } };
const ruhe = async () => { do { await new Promise(r2 => setTimeout(r2, 5)); } while (offen > 0); await new Promise(r2 => setTimeout(r2, 5)); };
const lauf = (code, werte) => seite.lauf(code, werte);
const html = id => seite.element(id).innerHTML;
lauf(`globalThis.__offen = []; { const om = openModal, cm = closeModal;
  openModal = (id) => { __offen.push('auf:' + id); return om(id); }; closeModal = (id) => { __offen.push('zu:' + id); return cm(id); }; }`);
await lauf(`me = __werte.me; activeSubject = 'mathe'; subjectsMeta = []; loadSubjectsMeta()`, { me: wer }); await ruhe();
await lauf(`(async () => { calData = await (await fetch('/api/calendar')).json();
  calClassmates = await (await fetch('/api/classmates')).json(); calSelected = __werte.d; renderCalDetail(); })()`, { d: tag(2) }); await ruhe();
const leiste = id => { lauf(`document.getElementById('cal-adminweek').innerHTML = '<div id="aw-actionbar"></div>'; _awPicked = ${id}; awRenderBar();`); return html('aw-actionbar'); };
let b = leiste(frei);
pruefe('S1 Wochenleiste, freier Talk: "+ einteilen"', b.includes(`onclick="openTalkEinteilen(${frei}, 'kalender')">+ einteilen</button>`) && !b.includes('openTalkBeteiligte'), b);
b = leiste(gebucht);
pruefe('S2 Wochenleiste, gebuchter Talk: "👥 Beteiligte / einladen"', b.includes(`onclick="openTalkBeteiligte(${gebuchtSess}, 'kalender')">👥 Beteiligte / einladen</button>`)
  && !b.includes('openTalkEinteilen'), b);
const tagDetail = html('cal-detail');
pruefe('S3 Kalender-Tag: frei "+ einteilen", gebucht "👥 Beteiligte / einladen"',
  tagDetail.includes(`onclick="openTalkEinteilen(${frei}, 'kalender')">+ einteilen</button>`)
  && tagDetail.includes(`onclick="openTalkBeteiligte(${gebuchtSess}, 'kalender')">👥 Beteiligte / einladen</button>`), tagDetail);

lauf(`openTalkEinteilen(${frei}, 'kalender')`);
const optionen = () => [...html('tein-person').matchAll(/<option value="(\d*)">([^<]*)<\/option>/g)].map(m => m[2]);
pruefe('S4 Fenster: Fach im Titel, Thema vorbelegt, alle aktiven Schueler:innen zur Wahl',
  seite.element('tein-titel').textContent === '🎤 Mathe-Talk einteilen' && seite.element('tein-thema').value === 'Kreise'
  && JSON.stringify(optionen()) === JSON.stringify(['– Person wählen –', 'ada', 'bo', 'cleo', 'dan'])
  && lauf('__offen.at(-1)') === 'auf:modal-talk-einteilen', [seite.element('tein-titel').textContent, optionen()]);
seite.element('tein-suche').value = 'BO';
lauf('talkEinteilenOptionen()');
pruefe('S5 Suche: ein Treffer ist gleich gewaehlt', JSON.stringify(optionen()) === JSON.stringify(['bo']) && seite.element('tein-person').value === String(P.bo), optionen());
seite.element('tein-person').value = '';
await lauf('submitTalkEinteilen()'); await ruhe();
pruefe('S6 ohne Person: Hinweis, nichts angelegt', seite.element('tein-error').textContent === 'Bitte wählen, wer den Talk hält.' && !(await buchung(frei)));
seite.element('tein-person').value = String(P.bo);
seite.element('tein-thema').value = '';
await lauf('submitTalkEinteilen()'); await ruhe();
pruefe('S7 ohne Thema: Hinweis', seite.element('tein-error').textContent === 'Bitte ein Thema angeben.' && !(await buchung(frei)));
seite.element('tein-thema').value = 'Kreise und Zylinder';
lauf('__offen.length = 0');
await lauf('submitTalkEinteilen()'); await ruhe();
const neuSess = (await eins(`SELECT id FROM talking_sessions WHERE slot_id=$1`, [frei])).id;
pruefe('S8 eingeteilt: bo haelt "Kreise und Zylinder"', JSON.stringify(await buchung(frei)) === JSON.stringify({ p: P.bo, thema: 'Kreise und Zylinder' }));
pruefe('S9 ... und gleich geht "Beteiligte" fuer diesen Talk auf, mit bo als buchender Person',
  lauf('__offen.join()') === 'zu:modal-talk-einteilen,auf:modal-talk-beteiligte' && lauf('_tbet.sessionId') === neuSess
  && /bo<\/span><span[^>]*>hat gebucht/.test(html('tbet-liste')), [lauf('__offen.join()'), html('tbet-liste')]);
seite.element('tbet-person').value = String(P.cleo);
await lauf(`talkBeteiligteSetzen('zuhoeren')`); await ruhe();
const cleoE = await eins(`SELECT status, herkunft, rolle FROM talking_invitations WHERE session_id=$1 AND listener_id=$2`, [neuSess, P.cleo]);
pruefe('S10 cleo fest als Zuhoerende eingetragen (ohne Zusage)', JSON.stringify(cleoE) === JSON.stringify({ status: 'angenommen', herkunft: 'zugewiesen', rolle: 'zuhoeren' }), cleoE);
b = leiste(frei);
pruefe('S11 in der Wochenleiste ist er jetzt gebucht ("👥 Beteiligte / einladen")', b.includes(`openTalkBeteiligte(${neuSess}, 'kalender')`), b);

// Fehler vom Server landen im Fenster (Zeitkonflikt).
const konflikt = await slot({ datum: tag(2), uhr: (await eins(`SELECT uhrzeit FROM talking_slots WHERE id=$1`, [frei])).uhrzeit });
await lauf('loadCalendar()'); await ruhe();
lauf(`openTalkEinteilen(${konflikt}, 'kalender')`);
seite.element('tein-person').value = String(P.bo);
seite.element('tein-thema').value = 'Doppelt';
await lauf('submitTalkEinteilen()'); await ruhe();
pruefe('S12 Zeitkonflikt: Meldung im Fenster, nichts angelegt', /Zeitkonflikt/.test(seite.element('tein-error').textContent) && !(await buchung(konflikt)),
  seite.element('tein-error').textContent);

// Talks-Reiter: freie Karte mit "+ einteilen", Neuladen ohne "Lade…".
const reiterFrei = await slot({ datum: tag(5) });
await lauf('loadTalkingAdmin()'); await ruhe();
pruefe('S13 Talks-Reiter: freie Terminkarte mit "+ einteilen", gebuchte mit 👥 "Beteiligte bearbeiten / einladen"',
  html('talking-admin').includes(`onclick="openTalkEinteilen(${reiterFrei}, 'talks')">+ einteilen</button>`)
  && html('talking-admin').includes(`onclick="openTalkBeteiligte(${neuSess}, 'talks')" title="Beteiligte bearbeiten / einladen"`));
const reiter = seite.element('talking-admin');
const zugriff = Object.getOwnPropertyDescriptor(reiter, 'innerHTML');
const gezeigt = [];
Object.defineProperty(reiter, 'innerHTML', { configurable: true, get: zugriff.get, set(v) { gezeigt.push(String(v)); zugriff.set.call(this, v); } });
lauf(`openTalkEinteilen(${reiterFrei}, 'talks')`);
pruefe('S14 aus dem Talks-Reiter: dieselbe Liste (Roster des Reiters)', optionen().includes('ada') && optionen().includes('dan'), optionen());
seite.element('tein-person').value = String(P.ada);
seite.element('tein-thema').value = 'Aus dem Reiter';
await lauf('submitTalkEinteilen()'); await ruhe();
pruefe('S15 eingeteilt, neu gezeichnet ohne "Lade…", "Beteiligte" aus dem Reiter',
  (await buchung(reiterFrei)).p === P.ada && gezeigt.length >= 1 && !gezeigt.some(g => g.includes('Lade…')) && lauf('_tbet.quelle') === 'talks', gezeigt.length);

console.log(`\n${ok} Pruefungen ok`);
process.exit(0);
