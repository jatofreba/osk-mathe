// Talks je Talk: Vortragende (min/max, weitere als Einladung mit rolle='vortrag') und Zuhoerende
// (min/max), je Fach einstellbar. Laeuft gegen die ECHTE server.js (ganz geladen, pglite).
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { ladeServer } = require('../lib/server_im_test.js');
const { lies } = require('../lib/quelle.js');

let ok = 0;
const pruefe = (n, b, e) => {
  if (!b) { console.error('FAIL: ' + n + (e !== undefined ? '\n      ' + String(typeof e === 'string' ? e : JSON.stringify(e)).slice(0, 1200) : '')); process.exit(1); }
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
const LB = await neu('lb_test', 'admin');
const P = {};
for (const n of ['ada', 'bo', 'cleo', 'dan', 'eli', 'fay', 'gil', 'hal', 'ivy']) P[n] = await neu(n);
const tag = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
let minute = 0;
const slot = async (fach = 'mathe', typ = 'talk', datum = tag(7)) => {
  // jede Stunde ein anderer Termin - so kommen sich die Buchungen zeitlich nie in die Quere
  const uhr = String(7 + Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0'); minute += 60;
  return (await eins(`INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
                      VALUES ('M3M4',$1,$2,'R1','2627_1',$3,$4,45,$5,'') RETURNING id`, [datum, uhr, LB, typ, F[fach]])).id;
};
const S = uid => ({ userId: uid, role: 'student', klasse: 'M3M4' });
const A = { userId: LB, role: 'admin', klasse: 'M3M4' };
const buche = (uid, slotId, inviteeIds, coPresenterIds, thema = 'Thema') =>
  srv.rufe('post', '/api/talking-sessions', { session: S(uid), body: { slotId, thema, inviteeIds, coPresenterIds } });
const mine = (uid, subject = 'mathe') => srv.rufe('get', '/api/talking-sessions/mine', { session: S(uid), query: { subject } }).then(r => r.body);
const kal = uid => srv.rufe('get', '/api/calendar', { session: S(uid) }).then(r => r.body.slots);
const antworte = (uid, id, accept) => srv.rufe('post', '/api/talking-invitations/:id/respond', { session: S(uid), params: { id }, body: { accept } });
const lade = (uid, sessionId, inviteeIds, coPresenterIds) =>
  srv.rufe('post', '/api/talking-sessions/:id/invite', { session: S(uid), params: { id: sessionId }, body: { inviteeIds, coPresenterIds } });
const einl = (sessionId, uid) => eins(`SELECT * FROM talking_invitations WHERE session_id=$1 AND listener_id=$2`, [sessionId, uid]);
const faecher = () => srv.rufe('get', '/api/subjects', { session: S(P.ada) }).then(r => Object.fromEntries(r.body.map(f => [f.key, f])));
const setzeFach = (key, body) => srv.rufe('post', '/api/admin/subjects/:id', { session: A, params: { id: F[key] },
  body: { defaultOrt: '', defaultDauer: 45, pflichtPraesentieren: 1, pflichtZuhoeren: 2, optionalPraesentieren: 2, optionalZuhoeren: 1, ...body } });

// ── G) Grenzen je Fach ────────────────────────────────────────────────────────
let f = await faecher();
pruefe('G1 Standard je Talk: Vortragende 1-2, Zuhoerende 2-5',
  f.mathe.minVortragende === 1 && f.mathe.maxVortragende === 2 && f.mathe.minZuhoerende === 2 && f.mathe.maxZuhoerende === 5, f.mathe);
let r = await setzeFach('englisch', { minVortragende: 2, maxVortragende: 3, minZuhoerende: 1, maxZuhoerende: 4 });
f = await faecher();
pruefe('G2 je Fach einstellbar (Englisch 2-3 / 1-4)', r.code === 200 && f.englisch.minVortragende === 2 && f.englisch.maxVortragende === 3
  && f.englisch.minZuhoerende === 1 && f.englisch.maxZuhoerende === 4 && f.mathe.maxZuhoerende === 5, f.englisch);
for (const [was, body] of [['min ueber max', { minVortragende: 2, maxVortragende: 1, minZuhoerende: 2, maxZuhoerende: 5 }],
  ['mehr als 4 Vortragende', { minVortragende: 1, maxVortragende: 5, minZuhoerende: 2, maxZuhoerende: 5 }],
  ['Zuhoerende min ueber max', { minVortragende: 1, maxVortragende: 2, minZuhoerende: 6, maxZuhoerende: 5 }],
  ['unvollstaendig', { minVortragende: 1 }]]) {
  r = await setzeFach('deutsch', body);
  pruefe(`G3 ungueltig (${was}) -> 400`, r.code === 400, r.body);
}
f = await faecher();
pruefe('G3b dabei nichts geaendert', f.deutsch.minVortragende === 1 && f.deutsch.maxZuhoerende === 5, f.deutsch);
r = await srv.rufe('post', '/api/admin/subjects/:id', { session: A, params: { id: F.englisch },
  body: { defaultOrt: '', defaultDauer: 45, halbjahr: '2627_1', reset: true } });
f = await faecher();
pruefe('G4 ein Aufruf ohne Grenzen (Halbjahr zuruecksetzen) laesst sie stehen', r.code === 200 && f.englisch.minVortragende === 2 && f.englisch.maxZuhoerende === 4, f.englisch);

// ── B) Buchen ─────────────────────────────────────────────────────────────────
r = await buche(P.ada, await slot(), [P.bo]);
pruefe('B1 zu wenige Zuhoerende (1 von mind. 2) -> 400', r.code === 400 && /mindestens 2/.test(r.body.error), r.body);
r = await buche(P.ada, await slot(), [P.bo, P.cleo, P.dan, P.eli, P.fay, P.gil]);
pruefe('B2 zu viele Zuhoerende (6 von hoechstens 5) -> 400', r.code === 400 && /Höchstens 5/.test(r.body.error), r.body);
const s1 = await slot();
r = await buche(P.ada, s1, [P.bo, P.cleo]);
pruefe('B3 allein mit 2 Zuhoerenden: gebucht', r.code === 200 && r.body.sessionId, r.body);
const allein = r.body.sessionId;
pruefe('B3b die Eingeladenen hoeren zu', (await alle(`SELECT rolle FROM talking_invitations WHERE session_id=$1`, [allein])).every(z => z.rolle === 'zuhoeren'));
const s2 = await slot();
r = await buche(P.dan, s2, [P.eli, P.fay], [P.gil]);
pruefe('B4 mit einer zweiten vortragenden Person: gebucht', r.code === 200, r.body);
const paar = r.body.sessionId;
const gilEinl = await einl(paar, P.gil);
pruefe('B4b sie ist eingeladen - als Vortragende, noch ohne Zusage', gilEinl.rolle === 'vortrag' && gilEinl.status === 'eingeladen', gilEinl);
r = await buche(P.hal, await slot(), [P.ada, P.bo], [P.cleo, P.ivy]);
pruefe('B5 drei Vortragende bei hoechstens 2 -> 400', r.code === 400 && /Höchstens 2 Personen tragen/.test(r.body.error), r.body);
r = await buche(P.hal, await slot(), [P.ada, P.cleo], [P.cleo]);
pruefe('B6 wer mit vortraegt, hoert nicht zugleich zu (dann fehlt hier eine Zuhoerende) -> 400', r.code === 400 && /mindestens 2/.test(r.body.error), r.body);
r = await buche(P.hal, await slot('mathe', 'input'), [], [P.ada]);
pruefe('B7 Fachbuero mit Mit-Vortrag -> 400', r.code === 400 && /nur bei Talks/.test(r.body.error), r.body);
r = await buche(P.hal, await slot('mathe', 'input'), []);
pruefe('B7b Fachbuero allein geht weiter', r.code === 200, r.body);
r = await buche(P.ivy, await slot('englisch'), [P.ada]);
pruefe('B8 Englisch verlangt 2 Vortragende: allein -> 400', r.code === 400 && /mindestens 2 Personen gemeinsam/.test(r.body.error), r.body);
r = await buche(P.ivy, await slot('englisch'), [P.ada], [P.hal]);
pruefe('B8b zu zweit mit 1 Zuhoerenden (Englisch 1-4): gebucht', r.code === 200, r.body);
// kleine Lerngruppe: nur zwei andere Personen -> die Mindestzahl 2 bleibt erreichbar, mehr gibt es nicht
const k1 = await neu('k_eins', 'student', 'KLEIN'), k2 = await neu('k_zwei', 'student', 'KLEIN'), k3 = await neu('k_drei', 'student', 'KLEIN');
await db.query(`UPDATE subjects SET talk_min_zuhoerende=4 WHERE id=$1`, [F.deutsch]);
const kleinSlot = (await eins(`INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
  VALUES ('KLEIN',$1,'10:00','R1','2627_1',$2,'talk',45,$3,'') RETURNING id`, [tag(7), LB, F.deutsch])).id;
r = await srv.rufe('post', '/api/talking-sessions', { session: { userId: k1, role: 'student', klasse: 'KLEIN' },
  body: { slotId: kleinSlot, thema: 'x', inviteeIds: [k2, k3] } });
pruefe('B9 Mindestzahl hoechstens so gross wie die Lerngruppe (2 statt 4)', r.code === 200, r.body);
await db.query(`UPDATE subjects SET talk_min_zuhoerende=2 WHERE id=$1`, [F.deutsch]);

// ── M) Mit-Vortrag aus Sicht der Beteiligten ────────────────────────────────
let m = await mine(P.gil);
pruefe('M1 offene Einladung zum Mit-Vortragen: eigenes Feld, weder Vortrag noch Zuhoeren',
  m.mitVortragOffen.length === 1 && m.mitVortragOffen[0].gebuchtVon === 'dan' && m.presenting.length === 0 && m.invitations.length === 0, m);
let k = (await kal(P.gil)).find(x => x.id === s2);
pruefe('M2 Kalender: traegt mit vor, ist aber nicht unter den Zuhoerenden',
  k.mineAsCoPresenter === true && k.mineAsListener === true && k.myInvitationRolle === 'vortrag'
  && !k.invitees.some(i => i.username === 'gil') && k.coPresenters.map(c => c.username).join() === 'gil', k);
r = await antworte(P.gil, gilEinl.id, true);
m = await mine(P.gil);
pruefe('M3 zugesagt: der Talk steht bei ihr unter den eigenen Vortraegen', r.code === 200 && m.presenting.length === 1
  && m.presenting[0].alsMitVortrag === true && m.presenting[0].gebuchtVon === 'dan' && m.mitVortragOffen.length === 0, m);
m = await mine(P.dan);
pruefe('M4 die buchende Person sieht, wer mit vortraegt', m.presenting[0].coPresenters.length === 1
  && m.presenting[0].coPresenters[0].username === 'gil' && m.presenting[0].coPresenters[0].status === 'angenommen'
  && m.presenting[0].invitees.every(i => i.username !== 'gil'), m.presenting[0]);
m = await mine(P.eli);
pruefe('M5 Zuhoerende sehen beide Vortragenden', m.invitations[0].presenter_username === 'dan' && m.invitations[0].coPresenterNames.join() === 'gil', m.invitations[0]);
// ablehnen und neu einladen
const s3 = await slot();
r = await buche(P.fay, s3, [P.ada, P.bo], [P.cleo]);
const dreier = r.body.sessionId;
await antworte(P.cleo, (await einl(dreier, P.cleo)).id, false);
m = await mine(P.cleo);
pruefe('M6 abgesagt: steht nirgends mehr', m.presenting.length === 0 && m.mitVortragOffen.length === 0, m);
m = await mine(P.fay);
pruefe('M6b und bei der Buchung nicht mehr unter den Vortragenden', m.presenting.find(x => x.id === dreier).coPresenters.length === 0);
{
  const b = m.presenting.find(x => x.id === dreier);
  pruefe('M6d die buchende Person sieht die Absage (mit Einladungs-Id zum Ausladen)',
    b.coPresentersAbgesagt.length === 1 && b.coPresentersAbgesagt[0].username === 'cleo'
    && b.coPresentersAbgesagt[0].id === (await einl(dreier, P.cleo)).id && b.invitees.every(iv => iv.username !== 'cleo'), b);
}
r = await lade(P.fay, dreier, [], [P.cleo]);
pruefe('M6c die buchende Person kann sie erneut fragen', r.code === 200 && (await einl(dreier, P.cleo)).status === 'eingeladen'
  && (await einl(dreier, P.cleo)).rolle === 'vortrag', r.body);
m = await mine(P.fay);
pruefe('M6e neu gefragt: keine Absage mehr, wieder unter den Vortragenden',
  m.presenting.find(x => x.id === dreier).coPresentersAbgesagt.length === 0
  && m.presenting.find(x => x.id === dreier).coPresenters.map(c => c.username).join() === 'cleo');
r = await lade(P.fay, dreier, [], [P.dan]);
pruefe('M7 ueber hoechstens 2 Vortragende hinaus -> 409', r.code === 409 && /Höchstens 2/.test(r.body.error), r.body);
await antworte(P.cleo, (await einl(dreier, P.cleo)).id, false);
r = await lade(P.fay, dreier, [], [P.ada]);
pruefe('M8 wer schon zuhoert, wird nicht zugleich Vortragende:r -> 409', r.code === 409 && /schon auf der Liste/.test(r.body.error), r.body);
r = await lade(P.fay, dreier, [P.dan, P.eli, P.gil, P.hal]);
pruefe('M9 Zuhoerende ueber hoechstens 5 -> 409 mit Zahl', r.code === 409 && /Höchstens 5/.test(r.body.error) && /2 sind schon/.test(r.body.error), r.body);
r = await lade(P.fay, dreier, [P.dan, P.eli, P.gil]);
pruefe('M9b bis zur Grenze geht es', r.code === 200, r.body);

// ── W) Bewertung und Zaehlung ─────────────────────────────────────────────────
const gilId = (await einl(paar, P.gil)).id, eliId = (await einl(paar, P.eli)).id;
r = await srv.rufe('post', '/api/admin/talking-invitations/:id/confirm-attended', { session: A, params: { id: gilId }, body: { status: 'erledigt', pokale: 3, qualityEmoji: '🤩' } });
await srv.rufe('post', '/api/admin/talking-invitations/:id/confirm-attended', { session: A, params: { id: eliId }, body: { status: 'erledigt', pokale: 3 } });
pruefe('W1 Mit-Vortrag bis 3 Flammen, Zuhoeren weiter bis 2',
  r.code === 200 && (await einl(paar, P.gil)).pokale === 3 && (await einl(paar, P.eli)).pokale === 2);
await srv.rufe('post', '/api/admin/talking-sessions/:id/confirm-presented', { session: A, params: { id: paar }, body: { status: 'erledigt', pokale: 2 } });
const hj = (await srv.rufe('get', '/api/admin/halbjahr-uebersicht', { session: A })).body;
const hjVon = name => (hj.students.find(s => s.username === name).byHalbjahr['2627_1'] || {}).bySubject?.mathe;
const gilHj = hjVon('gil'), danHj = hjVon('dan');
pruefe('W2 Halbjahr: der Mit-Vortrag zaehlt als gehalten, nicht als zugehoert',
  gilHj.talksPresented === 1 && gilHj.talksListened === 0 && gilHj.pokalePresented === 3
  && gilHj.talkDetails[0].role === 'gehalten' && gilHj.talkDetails[0].mit === 'dan', gilHj);
pruefe('W3 bei der buchenden Person steht, mit wem', danHj.talksPresented === 1 && danHj.talkDetails[0].mit === 'gil', danHj);
const rang = (await srv.rufe('get', '/api/leaderboard', { session: S(P.ada) })).body;
const zeile = (rang.rows || rang).find(z => z.username === 'gil');
pruefe('W4 Rangliste: die Flammen aus dem Mit-Vortrag zaehlen', zeile && zeile.pokale >= 3, zeile);
m = await mine(P.gil);
pruefe('W5 Meine Flammen der Mit-Vortragenden: 3', m.trophies.earned === 3, m.trophies);
const liste = (await srv.rufe('get', '/api/admin/talking-slots', { session: A, query: { typ: 'talk', subject: 'mathe' } })).body;
const termin = liste.find(x => x.session_id === paar);
pruefe('W6 Terminliste der Lernbegleitung: Vortragende mit Bewertung, getrennt von den Zuhoerenden',
  termin.coPresenters.length === 1 && termin.coPresenters[0].pokale === 3 && termin.coPresenters[0].attendedStatus === 'erledigt'
  && termin.invitees.every(i => i.username !== 'gil'), termin);
// eine abgesagte, schon bewertete Zeile wird nicht zur Vortragenden umgestellt
const s4 = await slot();
r = await buche(P.bo, s4, [P.ada, P.cleo, P.hal]);
const mitBew = r.body.sessionId;
await antworte(P.hal, (await einl(mitBew, P.hal)).id, false);
await srv.rufe('post', '/api/admin/talking-invitations/:id/confirm-attended', { session: A, params: { id: (await einl(mitBew, P.hal)).id }, body: { status: 'nicht_erledigt' } });
r = await lade(P.bo, mitBew, [], [P.hal]);
pruefe('W7 an einer abgesagten, bewerteten Zeile wird nichts umgestellt -> 409', r.code === 409 && /Bewertung/.test(r.body.error)
  && (await einl(mitBew, P.hal)).rolle === 'zuhoeren' && (await einl(mitBew, P.hal)).attended_status === 'nicht_erledigt', r.body);

// ── Z) Altbestand ─────────────────────────────────────────────────────────────
const alt = (await eins(`INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,'Alt') RETURNING id`, [await slot(), P.ivy])).id;
await db.query(`INSERT INTO talking_invitations (session_id, listener_id, status) VALUES ($1,$2,'angenommen')`, [alt, P.ada]);
r = await lade(P.ivy, alt, [P.bo]);
pruefe('Z1 ein alter Talk mit nur 1 Zuhoerenden bleibt nutzbar: nachladen geht', r.code === 200, r.body);
r = await srv.rufe('post', '/api/admin/talking-sessions/:id/confirm-presented', { session: A, params: { id: alt }, body: { status: 'erledigt', pokale: 3 } });
pruefe('Z2 ... und bewerten', r.code === 200 && (await eins(`SELECT pokale FROM talking_sessions WHERE id=$1`, [alt])).pokale === 3);

console.log('\n' + ok + ' Pruefungen bestanden.');
