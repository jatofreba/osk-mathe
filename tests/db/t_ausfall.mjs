// Ausfall "Lernbegleitung krank" (Nutzerwunsch 2026-11-19) - Server und Seite ZUSAMMEN (pglite):
//  - POST /api/admin/talking-slots/:id/ausfall: ein Termin oder alle der Lernbegleitung am Tag,
//    zuruecknehmen, bewertete bleiben, jede Lernbegleitung des Tandems darf,
//  - ein ausgefallener Termin nimmt niemanden auf (buchen, mitmachen, zusagen, einladen, einteilen),
//    gibt die Zeit frei und zaehlt nirgends (Halbjahr-Uebersicht, eigene Talks, Rangliste),
//  - die oeffentliche Woche zeigt ihn nicht mehr,
//  - Seite: Kachel grau/durchgestrichen, Leiste mit "🤒 Lernbegleitung krank" / "↩ Findet doch statt",
//    Fenster mit "ganzer Tag", Hinweis oben in der Woche der Betroffenen, Kalender, Talks, Plenum.
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
  `INSERT INTO users (username, password_hash, klasse, role, created_at, default_subject_id) VALUES ($1,'x',$2,$3, NOW() - INTERVAL '2 years', $4) RETURNING id`,
  [name, klasse, rolle, rolle === 'admin' ? F.mathe : null])).id;
const LB = await neu('lb_krank', 'admin');
const LB2 = await neu('lb_gesund', 'admin');
const P = {};
for (const n of ['ada', 'bo', 'cleo', 'dan']) P[n] = await neu(n);
const A = (uid = LB2) => ({ userId: uid, role: 'admin', klasse: 'M3M4' });
const S = n => ({ userId: P[n], role: 'student', klasse: 'M3M4' });

// Naechste Woche, Donnerstag: drei Termine von lb_krank, einer von lb_gesund.
const seite = ladeSeite();
const T = seite.lauf(`(() => { const m = lwMonday(); m.setDate(m.getDate() + 7);
  return [0, 1, 2, 3, 4].map(i => { const d = new Date(m); d.setDate(m.getDate() + i); return lwDateStr(d); }); })()`);
const DO = T[3], FR = T[4];
const hj = (() => { const h = new Date(), m = h.getMonth() + 1, y = h.getFullYear(), s = m >= 8 ? y : y - 1;
  return String(s).slice(-2) + String(s + 1).slice(-2) + '_' + (m >= 8 || m === 1 ? 1 : 2); })();
const slot = async (datum, uhr, typ = 'input', admin = LB, dauer = 45) => (await eins(
  `INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
   VALUES ('M3M4',$1,$2,'R1',$3,$4,$5,$6,$7,'') RETURNING id`, [datum, uhr, typ === 'talk' ? hj : '', admin, typ, dauer, F.mathe])).id;
const buche = async (slotId, presenter, thema = 'X') => (await eins(
  `INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,$3) RETURNING id`, [slotId, presenter, thema])).id;
const fbDo = await slot(DO, '10:45');                          // ada bucht
const fbDoSess = await buche(fbDo, P.ada, 'Brüche');
const talkDo = await slot(DO, '11:30', 'talk');                // dan haelt, ada eingeladen
const talkDoSess = await buche(talkDo, P.dan, 'Kreise');
const adaEinl = (await eins(`INSERT INTO talking_invitations (session_id, listener_id, status) VALUES ($1,$2,'eingeladen') RETURNING id`, [talkDoSess, P.ada])).id;
// bo hat die Einladung zum Talk abgesagt - der Ausfall geht sie nichts an.
await db.query(`INSERT INTO talking_invitations (session_id, listener_id, status) VALUES ($1,$2,'abgelehnt')`, [talkDoSess, P.bo]);
const frei15a = await slot(DO, '08:45', 'input', LB, 15);      // zwei freie 15-Min-Termine hintereinander
const frei15b = await slot(DO, '09:00', 'input', LB, 15);
const gesundDo = await slot(DO, '10:45', 'input', LB2);        // andere Lernbegleitung, selber Tag
const lbFr = await slot(FR, '10:45');                          // lb_krank, anderer Tag
const gesundFrei = await slot(FR, '12:30', 'input', LB2);      // zwei freie von lb_gesund (Wunschliste)
const gesundFrei2 = await slot(FR, '13:15', 'input', LB2);
// Ein Termin in der laufenden oeffentlichen Woche (dieselbe Montagsregel wie lwMonday).
const pubTag = seite.lauf(`lwDateStr(lwMonday())`);
const pubAus = await slot(pubTag, '08:45', 'input', LB2), pubDa = await slot(pubTag, '09:30', 'input', LB2);
const ausfall = (id, body, wer = A()) => srv.rufe('post', '/api/admin/talking-slots/:id/ausfall', { session: wer, params: { id }, body });
const stand = async id => (await eins(`SELECT ausfall, ausfall_von FROM talking_slots WHERE id=$1`, [id]));

// ── H) Halbjahr-Uebersicht vorher (zum Vergleich) ────────────────────────────
// Ein vergangener Talk von dan (bewertet nicht), den es gleich trifft.
const gestern = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return seite.lauf(`lwDateStr(__werte.d)`, { d }); })();
const talkGestern = await slot(gestern, '09:30', 'talk');
const talkGesternSess = await buche(talkGestern, P.dan, 'Gestern');
await db.query(`UPDATE talking_sessions SET presented_status='erledigt', pokale=2 WHERE id=$1`, [talkGesternSess]);
// cleo hat zugesagt und hoert zu.
await db.query(`INSERT INTO talking_invitations (session_id, listener_id, status) VALUES ($1,$2,'angenommen')`, [talkGesternSess, P.cleo]);
const hjVon = async name => {
  const u = (await srv.rufe('get', '/api/admin/halbjahr-uebersicht', { session: A() })).body.students.find(s => s.username === name);
  return ((u.byHalbjahr[hj] || {}).bySubject || {}).mathe || null;
};

// ── R) Route ─────────────────────────────────────────────────────────────────
let r = await ausfall(talkGestern, {});
pruefe('R1 einzelner bewerteter Talk: 409, bleibt', r.code === 409 && !(await stand(talkGestern)).ausfall, r.body);
await db.query(`UPDATE talking_sessions SET presented_status='ausstehend', pokale=0 WHERE id=$1`, [talkGesternSess]);
const vorher = await hjVon('dan');
pruefe('R1b (vorher zaehlen dans Vortrag und cleos Zuhoeren von gestern)', vorher && vorher.talkDetails.some(t => t.thema === 'Gestern')
  && (await hjVon('cleo')).talkDetails.some(t => t.thema === 'Gestern'), vorher);
r = await ausfall(fbDo, {});
pruefe('R2 lb_gesund meldet einen Termin von lb_krank: faellt aus, mit Vermerk wer', r.code === 200 && r.body.anzahl === 1
  && JSON.stringify(await stand(fbDo)) === JSON.stringify({ ausfall: 'krank', ausfall_von: LB2 }) && !(await stand(talkDo)).ausfall, r.body);
r = await ausfall(fbDo, { ausfall: false });
pruefe('R3 findet doch statt', r.code === 200 && (await stand(fbDo)).ausfall === null, r.body);
await db.query(`UPDATE talking_sessions SET presented_status='erledigt', pokale=1 WHERE id=$1`, [talkDoSess]);
r = await ausfall(fbDo, { ganzerTag: true });
const amDo = async () => Promise.all([fbDo, talkDo, frei15a, frei15b, gesundDo, lbFr].map(async id => !!(await stand(id)).ausfall));
pruefe('R4 ganzer Tag: alle von lb_krank am Do - ausser dem bewerteten Talk (gemeldet); lb_gesund und Freitag nicht',
  r.code === 200 && r.body.anzahl === 3 && r.body.uebersprungen === 1
  && JSON.stringify(await amDo()) === JSON.stringify([true, false, true, true, false, false]), [r.body, await amDo()]);
await db.query(`UPDATE talking_sessions SET presented_status='ausstehend', pokale=0 WHERE id=$1`, [talkDoSess]);
r = await ausfall(talkDo, {});
pruefe('R5 (der Talk, jetzt unbewertet, faellt auch aus)', r.code === 200 && (await stand(talkDo)).ausfall === 'krank');
r = await ausfall(fbDo, {}, { userId: await neu('lb_fremd', 'admin', 'KLEIN'), role: 'admin', klasse: 'KLEIN' });
pruefe('R6 anderes Tandem: nicht gefunden', r.code === 404, r.body);
pruefe('R7 nur fuer Lernbegleitungen (requireAdmin)', lies('server.js').includes("app.post('/api/admin/talking-slots/:id/ausfall', requireAdmin,"));

// ── K) niemand kommt mehr hinein ─────────────────────────────────────────────
const MELDUNG = 'Dieser Termin fällt aus – die Lernbegleitung ist krank.';
r = await srv.rufe('post', '/api/talking-sessions', { session: S('bo'), body: { slotId: frei15a, thema: 'X' } });
pruefe('K1 buchen: 409', r.code === 409 && r.body.error === MELDUNG, r.body);
const fbDoGeb2 = fbDo;
r = await srv.rufe('post', '/api/talking-slots/:id/request', { session: S('bo'), params: { id: fbDoGeb2 } });
pruefe('K2 mitmachen: 409', r.code === 409 && r.body.error === MELDUNG, r.body);
r = await srv.rufe('post', '/api/talking-invitations/:id/respond', { session: S('ada'), params: { id: adaEinl }, body: { accept: true } });
pruefe('K3 Einladung zusagen: 409', r.code === 409 && r.body.error === MELDUNG, r.body);
r = await srv.rufe('post', '/api/admin/talking-sessions/:id/assign', { session: A(), params: { id: fbDoSess }, body: { studentIds: [P.cleo] } });
pruefe('K4 Lernbegleitung traegt ein: mit Grund zurueck', r.code === 200 && r.body.assigned === 0
  && r.body.conflicts[0].reason === 'der Termin fällt aus – die Lernbegleitung ist krank', r.body);
r = await srv.rufe('post', '/api/admin/talking-sessions', { session: A(), body: { slotId: frei15b, thema: 'Neu', studentIds: [P.cleo] } });
pruefe('K5 FaBue anlegen mit Einladung: 409', r.code === 409 && r.body.error === MELDUNG && !(await eins(`SELECT 1 FROM talking_sessions WHERE slot_id=$1`, [frei15b])), r.body);
const freiTalk = await slot(DO, '12:30', 'talk');
await ausfall(freiTalk, {});
r = await srv.rufe('post', '/api/admin/talking-slots/:id/einteilen', { session: A(), params: { id: freiTalk }, body: { userId: P.bo, thema: 'X' } });
pruefe('K6 einteilen: 409', r.code === 409 && r.body.error === MELDUNG, r.body);
// ada war im ausgefallenen FaBue um 10:45 - die Zeit ist wieder frei.
r = await srv.rufe('post', '/api/talking-sessions', { session: S('ada'), body: { slotId: gesundDo, thema: 'Ersatz' } });
pruefe('K7 ada bucht zur selben Zeit einen anderen Termin: geht', r.code === 200, r.body);

// ── Z) zaehlt nirgends ───────────────────────────────────────────────────────
await ausfall(talkGestern, {});
const nachher = await hjVon('dan');
pruefe('Z1 Halbjahr-Uebersicht: dans ausgefallene Talks fehlen', !nachher || !nachher.talkDetails.some(t => ['Gestern', 'Kreise'].includes(t.thema)), nachher);
const cleoHj = await hjVon('cleo');
pruefe('Z1b ... und cleos Zuhoeren dort auch', !cleoHj || !cleoHj.talkDetails.some(t => t.thema === 'Gestern'), cleoHj);
const adaHj = await hjVon('ada');
pruefe('Z2 adas ausgefallenes FaBue zaehlt nicht (nur das Ersatz-FaBue)', adaHj && adaHj.inputDetails.length === 1 && adaHj.inputDetails[0].thema === 'Ersatz', adaHj);
const mine = (await srv.rufe('get', '/api/talking-sessions/mine', { session: S('dan'), query: { subject: 'mathe' } })).body;
pruefe('Z3 dans eigene Talks: ausgefallene fehlen', (mine.presenting || []).length === 0, (mine.presenting || []).map(x => x.thema));
const quelle = lies('server.js');
pruefe('Z4 Rangliste filtert ausgefallene (Vortrag, Mit-Vortrag, Zuhoeren)',
  quelle.includes("WHERE sl.typ = 'talk' AND sl.ausfall IS NULL\n        UNION ALL")
  && quelle.includes("WHERE sl.typ = 'talk' AND ti.rolle = 'vortrag' AND sl.ausfall IS NULL")
  && quelle.includes("AND sl.typ = 'talk' AND ti.rolle <> 'vortrag'\n          AND sl.ausfall IS NULL"));
await ausfall(pubAus, {});
const pub = await srv.rufe('get', '/api/public/week', {});
const pubIds = (pub.body.slots || []).map(s => s.id);
pruefe('Z5 oeffentliche Woche: der ausgefallene fehlt, der andere am selben Tag steht da', !pubIds.includes(pubAus) && pubIds.includes(pubDa), pubIds);

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
  try { antwort = await ausfall(99999, {}); } catch (e) { geworfen = e; }
  srv.pool.connect = echt;
  pruefe('R8 scheitert das ROLLBACK, antwortet die Route', !geworfen && antwort && antwort.code >= 400, geworfen ? String(geworfen) : antwort);
  pruefe('R8b die Verbindung geht erst nach dem ROLLBACK zurueck', ablauf.indexOf('release') > ablauf.indexOf('rollback-ende'), ablauf);
}

// ── S) Seite: Lernbegleitung ─────────────────────────────────────────────────
await ausfall(fbDo, { ausfall: false, ganzerTag: true });     // alles am Do wieder zurueck
await ausfall(talkDo, { ausfall: false });
let wer = { userId: LB2, username: 'lb_gesund', role: 'admin', klasse: 'M3M4', superAdmin: false, defaultSubjectId: F.mathe };
let offen = 0;
const serverFetch = srv.fetchFuer(() => ({ userId: wer.userId, role: wer.role, klasse: wer.klasse }));
seite.kontext.fetch = async (...a) => { offen++; try { return await serverFetch(...a); } finally { offen--; } };
const meldungen = [];
seite.kontext.alert = t2 => meldungen.push(String(t2));
const ruhe = async () => { do { await new Promise(r2 => setTimeout(r2, 5)); } while (offen > 0); await new Promise(r2 => setTimeout(r2, 5)); };
const lauf = (code, werte) => seite.lauf(code, werte);
const html = id => seite.element(id).innerHTML;
await lauf(`me = __werte.me; activeSubject = 'mathe'; loadSubjectsMeta()`, { me: wer }); await ruhe();
const woche = async () => { await lauf(`_awWoche = 1; loadCalendar()`); await ruhe(); return html('cal-adminweek'); };
const leiste = id => { lauf(`document.getElementById('cal-adminweek').innerHTML = '<div id="aw-actionbar"></div>'; _awPicked = ${id}; awRenderBar();`); return html('aw-actionbar'); };
await woche();
let b = leiste(fbDo);
pruefe('S1 Leiste eines fremden Termins (lb_gesund schaut auf lb_krank): "🤒 Lernbegleitung krank" ist da',
  b.includes(`onclick="openAusfall(${fbDo})">🤒 Lernbegleitung krank</button>`) && !b.includes('Bearbeiten'), b);
lauf(`openAusfall(${fbDo})`);
pruefe('S2 Fenster: Termin, Folgen, "Auch die 4 weiteren Termine von …" (angehakt)',
  seite.element('ausfall-kopf').textContent === '🤒 Lernbegleitung krank'
  && seite.element('ausfall-info').textContent.startsWith(`Mathe-FaBü ${lauf(`lwFmtDay(__werte.d)`, { d: DO })} 10:45 fällt aus – `)
  && seite.element('ausfall-tag-zeile').style.display === 'flex' && seite.element('ausfall-tag').checked
  && /^Auch die 4 weiteren Termine von .* an diesem Tag$/.test(seite.element('ausfall-tag-text').textContent),
  [seite.element('ausfall-info').textContent, seite.element('ausfall-tag-text').textContent]);
await lauf('ausfallSpeichern()'); await ruhe();
pruefe('S3 gespeichert: der ganze Tag von lb_krank faellt aus', JSON.stringify(await amDo()) === JSON.stringify([true, true, true, true, false, false]), await amDo());
let h = html('cal-adminweek');
const kachel = id => (h.match(new RegExp(`<div class="lw-chip[^"]*"[^>]*data-aw="${id}"[\\s\\S]*?</div>\\s*</div>`)) || [''])[0];
pruefe('S4 Kachel grau, durchgestrichen, "🤒 fällt aus"', /class="lw-chip mw-\w+ [\w-]+ ist-ausfall"/.test(kachel(fbDo)) && kachel(fbDo).includes('🤒 fällt aus')
  && kachel(fbDo).includes('fällt aus – Lernbegleitung krank'), kachel(fbDo));
pruefe('S5 freie ausgefallene werden nicht zu einer Serie gebuendelt', kachel(frei15a).includes('ist-ausfall') && kachel(frei15b).includes('ist-ausfall')
  && !h.includes('2 × 15 Min'), h.slice(0, 200));
lauf(`me.superAdmin = true`);                       // darf verwalten - sonst gaebe es die Knoepfe ohnehin nicht
b = leiste(talkDo);
const bFb = leiste(fbDo);
lauf(`me.superAdmin = false`);
pruefe('S6 Leiste ausgefallener Termine (mit Verwaltungsrecht): "↩ Findet doch statt", Bearbeiten - kein Einladen, Beteiligte, Schliessen',
  b.includes('↩ Findet doch statt') && b.includes('🤒 fällt aus') && b.includes('Bearbeiten') && !b.includes('openTalkBeteiligte')
  && bFb.includes('Bearbeiten') && !bFb.includes('openInputAssignModal') && !bFb.includes('calSlotGeschlossen'), [b, bFb]);
// 1. Block (1/2): dort liegen nur die beiden ausgefallenen 15-Minuten-Termine von lb_krank.
const feld0 = JSON.parse(lauf(`JSON.stringify(awFeldZustand(__werte.d, 0))`, { d: DO }));
pruefe('S7 Schnellanlegen: ausgefallene Termine belegen das Feld nicht mehr', feld0.art === 'frei'
  && JSON.stringify(feld0.frei) === JSON.stringify([[525, 570]]), feld0);
lauf(`openAusfall(${talkDo})`);
seite.element('ausfall-tag').checked = false;
pruefe('S8 zuruecknehmen: Fenster "findet doch statt"', seite.element('ausfall-ok').textContent === 'Findet doch statt'
  && seite.element('ausfall-tag-text').textContent.includes('weiteren ausgefallenen Termine'));
await lauf('ausfallSpeichern()'); await ruhe();
pruefe('S9 nur dieser Termin zurueck', JSON.stringify(await amDo()) === JSON.stringify([true, false, true, true, false, false]), await amDo());
await ausfall(talkDo, {});

// Kalender, Talks-Reiter, Plenum, Wunschliste
await lauf(`calYear = new Date(__werte.d + 'T00:00:00').getFullYear(); calMonth = new Date(__werte.d + 'T00:00:00').getMonth(); calSelected = __werte.d; renderCalendar(); renderCalDetail();`, { d: DO });
pruefe('S10 Monat: ausgefallene Termine durchgestrichen', (html('cal-grid').match(/cal-ev cal-ev-ausfall/g) || []).length >= 1, html('cal-grid').slice(0, 300));
pruefe('S11 Tag: "🤒 fällt aus" mit "↩ Findet doch statt"; der Termin von lb_gesund mit "🤒 Lernbegleitung krank"',
  html('cal-detail').includes('🤒 fällt aus – Lernbegleitung krank') && html('cal-detail').includes(`onclick="openAusfall(${fbDo})">↩ Findet doch statt`)
  && html('cal-detail').includes(`onclick="openAusfall(${gesundDo})">🤒 Lernbegleitung krank`), html('cal-detail').slice(0, 600));
await lauf('loadTalkingAdmin()'); await ruhe();
const zb = html('talking-admin').slice(0, html('talking-admin').indexOf('📅 Termine verwalten'));
pruefe('S12 Talks: der ausgefallene Talk von gestern steht nicht unter "Noch zu bewerten"; Karte mit Pille',
  !zb.includes('Gestern') && html('talking-admin').includes('🤒 fällt aus'), zb.slice(0, 400));
await lauf(`_plDaten = calData; _plPicked = null`);
pruefe('S13 Plenum: Kachel "🤒 fällt aus"', lauf(`plChip(calData.slots.find(s => s.id === ${fbDo}))`).includes('🤒 fällt aus')
  && lauf(`plChip(calData.slots.find(s => s.id === ${fbDo}))`).includes('ist-ausfall'));
await ausfall(gesundFrei, {});
await lauf('loadCalendar()'); await ruhe();
const wf = JSON.parse(lauf(`JSON.stringify(wunschFreieTermine({ subjectId: ${F.mathe} }).map(s => s.id))`));
pruefe('S14 Wunsch -> Termin bietet den ausgefallenen eigenen nicht an, den anderen schon', !wf.includes(gesundFrei) && wf.includes(gesundFrei2), wf);

// ── W) Seite: Schueler:innen ─────────────────────────────────────────────────
const schuelerWoche = async name => {
  wer = { userId: P[name], username: name, role: 'student', klasse: 'M3M4' };
  await lauf(`me = __werte.me; _mwWoche = 1; _mwPicked = null; loadMyWeek()`, { me: wer }); await ruhe();
  return html('home-myweek');
};
h = await schuelerWoche('ada');
const tagText = lauf(`lwFmtDay(__werte.d)`, { d: DO });
pruefe('W1 ada: Hinweis oben - ihr FaBue und der Talk, zu dem sie eingeladen ist',
  h.includes(`<div class="mw-ausfall-hinweis" role="status">⚠️ Fällt aus – die Lernbegleitung ist krank: Mathe-FaBü ${tagText} 10:45 · Mathe-Talk ${tagText} 11:30</div>`), h.slice(0, 800));
lauf(`mwSelect(${fbDo})`);
pruefe('W2 Kachel "fällt aus" (grau, nicht im Stil des Hinweises), Leiste mit Hinweis', lauf(`mwState(_mwSlots.find(s => s.id === ${fbDo}))`) === 'ausfall'
  && /class="lw-chip mw-ausfall ist-vergeben ist-ausfall"[^>]*data-mw="\d+"/.test(h) && !/\.mw-ausfall\{/.test(lies('public/index.html'))
  && html('mw-actionbar').includes('🤒 Fällt aus – die Lernbegleitung ist krank. Such dir gern einen anderen Termin.'), html('mw-actionbar'));
pruefe('W3 der Ersatztermin zur selben Zeit ist ihrer (nicht im Konflikt)', lauf(`mwState(_mwSlots.find(s => s.id === ${gesundDo}))`) === 'mine');
h = await schuelerWoche('bo');
pruefe('W3b bo hat den Talk abgesagt: kein Hinweis', !h.includes('mw-ausfall-hinweis'), h.slice(0, 300));
h = await schuelerWoche('cleo');
pruefe('W4 cleo (nicht dabei): kein Hinweis, der freie ausgefallene ist nicht buchbar', !h.includes('mw-ausfall-hinweis')
  && lauf(`mwState(_mwSlots.find(s => s.id === ${frei15a}))`) === 'ausfall' && !lauf(`lwBuchbar(_mwSlots.find(s => s.id === ${frei15a}))`), h.slice(0, 300));
await lauf(`(async () => { calData = await (await fetch('/api/calendar')).json(); calSelected = __werte.d; renderCalDetail(); })()`, { d: DO }); await ruhe();
wer = { userId: P.ada, username: 'ada', role: 'student', klasse: 'M3M4' };
await lauf(`me = __werte.me; (async () => { calData = await (await fetch('/api/calendar')).json(); calSelected = __werte.d; renderCalDetail(); })()`, { me: wer, d: DO }); await ruhe();
pruefe('W5 adas Kalender-Tag: ihr FaBue durchgestrichen, ohne Knopf', html('cal-detail').includes('🤒 fällt aus – Lernbegleitung krank') && !html('cal-detail').includes('openAusfall('), html('cal-detail').slice(0, 400));

console.log(`\n${ok} Pruefungen ok`);
process.exit(0);
