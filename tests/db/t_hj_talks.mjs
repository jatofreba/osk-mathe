// Halbjahr-Uebersicht: Talks einzeln mit Flammen (Wunsch einer Kollegin, 2026-11-18) - Server und
// Seite ZUSAMMEN (server_im_test + seite_im_test, pglite):
//  - talkDetails enthaelt jeden Talk, auf dem die Person steht, mit status (erledigt /
//    nicht_erledigt / ausstehend); offene Einladungen und Absagen nicht,
//  - die Zaehler (talksPresented/-Listened, Flammen, lastTalk) zaehlen weiter nur, was
//    stattgefunden hat - darauf bauen Sortierung, "ohne Aktivitaet" und das Tool,
//  - Tabelle: je Rolle die Talks einzeln (🔥 je Flamme, ○, ✗), dahinter ⏳ (vorbei, nicht
//    bewertet) und 📅 (angemeldet), darunter das Datum des letzten bewerteten,
//  - Detail und "Mein Halbjahr" zeigen denselben Stand je Talk.
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
const neu = async (name, rolle = 'student') => (await eins(
  `INSERT INTO users (username, password_hash, klasse, role) VALUES ($1,'x','M3M4',$2) RETURNING id`, [name, rolle])).id;
const LB = await neu('lb', 'admin');
const P = {};
for (const n of ['ada', 'bo', 'cleo', 'dan', 'eva', 'fin', 'gus', 'hal']) P[n] = await neu(n);

const tagIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tag = n => { const h = new Date(); return tagIso(new Date(h.getFullYear(), h.getMonth(), h.getDate() + n)); };
// Laufendes Halbjahr (Aug-Jan = _1, Feb-Jul = _2) - damit die Seite es ohne Umschalten zeigt.
const HJ = (() => { const h = new Date(), m = h.getMonth() + 1, y = h.getFullYear();
  const s = m >= 8 ? y : y - 1; return String(s).slice(-2) + String(s + 1).slice(-2) + '_' + (m >= 8 || m === 1 ? 1 : 2); })();
let stunde = 7;
// Ein Talk: buchende Person mit Status/Flammen, dazu Einladungen [name, status, attended, pokale, rolle].
const talk = async (tagNr, thema, presenter, [pStatus, pPokale], einl = [], fach = F.mathe) => {
  const s = (await eins(`INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
    VALUES ('M3M4',$1,$2,'R1',$3,$4,'talk',45,$5,'') RETURNING id`, [tag(tagNr), String(stunde++).padStart(2, '0') + ':00', HJ, LB, fach])).id;
  const sess = (await eins(`INSERT INTO talking_sessions (slot_id, presenter_id, thema, presented_status, pokale)
    VALUES ($1,$2,$3,$4,$5) RETURNING id`, [s, P[presenter], thema, pStatus, pPokale])).id;
  for (const [n, st, att, pk, rolle] of einl)
    await db.query(`INSERT INTO talking_invitations (session_id, listener_id, status, attended_status, pokale, rolle)
      VALUES ($1,$2,$3,$4,$5,$6)`, [sess, P[n], st, att, pk, rolle || 'zuhoeren']);
};
await talk(-10, 'Pythagoras', 'ada', ['erledigt', 3], [
  ['bo', 'angenommen', 'erledigt', 2], ['cleo', 'angenommen', 'erledigt', 0],
  ['dan', 'eingeladen', 'ausstehend', 0], ['eva', 'abgelehnt', 'ausstehend', 0]]);
await talk(-8, 'Brüche', 'eva', ['erledigt', 2], [['dan', 'angenommen', 'erledigt', 1, 'vortrag']]);
await talk(-5, 'Prozente', 'ada', ['nicht_erledigt', 0], [['bo', 'angenommen', 'nicht_erledigt', 0]]);
await talk(-2, 'Zinsen', 'bo', ['ausstehend', 0], [
  ['ada', 'angenommen', 'ausstehend', 0], ['cleo', 'angenommen', 'ausstehend', 0, 'vortrag']]);
await talk(4, 'Kreise', 'cleo', ['ausstehend', 0], [
  ['ada', 'angenommen', 'ausstehend', 0], ['fin', 'angenommen', 'ausstehend', 0],
  ['dan', 'eingeladen', 'ausstehend', 0], ['eva', 'eingeladen', 'ausstehend', 0, 'vortrag']]);
await talk(-1, 'Phrasal verbs', 'ada', ['erledigt', 1], [], F.englisch);
await talk(0, 'Heute', 'hal', ['ausstehend', 0]);   // heute, noch nicht bewertet

// ── S) Server ────────────────────────────────────────────────────────────────
const A = { userId: LB, role: 'admin', klasse: 'M3M4' };
const ue = (await srv.rufe('get', '/api/admin/halbjahr-uebersicht', { session: A })).body;
const fach = (n, k = 'mathe') => ue.students.find(s => s.username === n).byHalbjahr[HJ].bySubject[k];
const kurz = sd => sd.talkDetails.map(t => `${t.role === 'gehalten' ? 'G' : 'Z'}:${t.thema}:${t.status}:${t.pokale}`).join(' | ');
pruefe('S1 ada: gehalten ✓3 und ✗, zugehoert vorbei-offen und kommend - neueste zuerst',
  kurz(fach('ada')) === 'Z:Kreise:ausstehend:0 | Z:Zinsen:ausstehend:0 | G:Prozente:nicht_erledigt:0 | G:Pythagoras:erledigt:3', kurz(fach('ada')));
pruefe('S2 ... gezaehlt wird nur, was stattgefunden hat', fach('ada').talksPresented === 1 && fach('ada').pokalePresented === 3
  && fach('ada').talksListened === 0 && fach('ada').pokaleListened === 0 && fach('ada').lastTalk === tag(-10), fach('ada'));
pruefe('S3 bo: gebucht und noch offen, zugehoert ✗ und 🔥🔥', kurz(fach('bo')) === 'G:Zinsen:ausstehend:0 | Z:Prozente:nicht_erledigt:0 | Z:Pythagoras:erledigt:2'
  && fach('bo').talksListened === 1 && fach('bo').pokaleListened === 2 && fach('bo').talksPresented === 0, fach('bo'));
pruefe('S4 cleo: Mit-Vortrag zugesagt und eigener kuenftiger Talk; zugehoert ohne Flamme',
  kurz(fach('cleo')) === 'G:Kreise:ausstehend:0 | G:Zinsen:ausstehend:0 | Z:Pythagoras:erledigt:0' && fach('cleo').talksListened === 1, fach('cleo'));
pruefe('S5 dan: offene Einladungen zaehlen nicht, der Mit-Vortrag schon (mit eva)',
  kurz(fach('dan')) === 'G:Brüche:erledigt:1' && fach('dan').talkDetails[0].mit === 'eva' && fach('dan').talksPresented === 1, fach('dan'));
pruefe('S6 eva: Absage und unbeantworteter Mit-Vortrag zaehlen nicht', kurz(fach('eva')) === 'G:Brüche:erledigt:2'
  && fach('eva').talkDetails[0].mit === 'dan', fach('eva'));
pruefe('S7 fin: nur angemeldet - steht drin, zaehlt nichts', kurz(fach('fin')) === 'Z:Kreise:ausstehend:0'
  && fach('fin').talksListened === 0 && fach('fin').lastTalk === null, fach('fin'));
pruefe('S8 Englisch getrennt', kurz(fach('ada', 'englisch')) === 'G:Phrasal verbs:erledigt:1' && fach('ada', 'englisch').talksPresented === 1);
pruefe('S9 gus ohne Talks bekommt kein Fach', !ue.students.find(s => s.username === 'gus').byHalbjahr[HJ]);

// ── T) Tabelle ───────────────────────────────────────────────────────────────
const seite = ladeSeite();
let wer = { userId: LB, username: 'lb', role: 'admin', klasse: 'M3M4', superAdmin: false, defaultSubjectId: null };
let offen = 0;
const serverFetch = srv.fetchFuer(() => ({ userId: wer.userId, role: wer.role, klasse: wer.klasse }));
seite.kontext.fetch = async (...a) => { offen++; try { return await serverFetch(...a); } finally { offen--; } };
const ruhe = async () => { do { await new Promise(r => setTimeout(r, 5)); } while (offen > 0); await new Promise(r => setTimeout(r, 5)); };
await seite.lauf(`me = __werte.me; loadHalbjahr()`, { me: wer }); await ruhe();
const html = seite.element('hj-content').innerHTML;
const [matheTeil, englischTeil] = html.split('>Englisch<');
const datum = d => seite.lauf(`hjFmtDate(__werte.d)`, { d });
// Zellen einer Zeile: [Name, gehalten, zugehoert, ...] als Text; Datum darunter getrennt.
const zeile = (teil, n) => {
  const tr = teil.match(new RegExp(`<tr[^>]*openHjDetail\\(${P[n]},'[a-z]+'\\)[^>]*>([\\s\\S]*?)</tr>`));
  if (!tr) return null;
  return [...tr[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(m => {
    const d = m[1].match(/<div style="font-size:10px;[^"]*">([^<]*)<\/div>/);
    return { text: m[1].replace(/<div[\s\S]*?<\/div>/g, '').replace(/<[^>]+>/g, '').trim(), datum: d ? d[1] : '', roh: m[1] };
  });
};
let z = zeile(matheTeil, 'ada');
pruefe('T1 ada gehalten: "✗ · 🔥🔥🔥", darunter das Datum des ✗', z[1].text === '✗ · 🔥🔥🔥' && z[1].datum === datum(tag(-5)), z[1]);
pruefe('T2 ada zugehoert: ⏳1 📅1, ohne Datum', z[2].text === '⏳1 📅1' && z[2].datum === '', z[2]);
pruefe('T3 ✗ ist rot, jede Marke traegt Datum und Thema als Tooltip',
  z[1].roh.includes(`<span title="${datum(tag(-5))} · Prozente" style="color:var(--md-error);">✗</span>`)
  && z[1].roh.includes(`<span title="${datum(tag(-10))} · Pythagoras">🔥🔥🔥</span>`), z[1].roh);
z = zeile(matheTeil, 'bo');
pruefe('T4 bo: gehalten ⏳1 · zugehoert "✗ · 🔥🔥"', z[1].text === '⏳1' && z[2].text === '✗ · 🔥🔥', z);
z = zeile(matheTeil, 'cleo');
pruefe('T5 cleo: gehalten ⏳1 📅1 · zugehoert ○', z[1].text === '⏳1 📅1' && z[2].text === '○', z);
z = zeile(matheTeil, 'dan');
pruefe('T6 dan: gehalten 🔥 · zugehoert –', z[1].text === '🔥' && z[2].text === '–', z);
z = zeile(matheTeil, 'hal');
pruefe('T6b ein Talk von heute ohne Bewertung ist ⏳, nicht 📅', z[1].text === '⏳1', z);
z = zeile(englischTeil, 'ada');
pruefe('T7 Englisch: ada 🔥', z && z[1].text === '🔥', z);
const trVon = n => (matheTeil.match(new RegExp(`<tr[^>]*openHjDetail\\(${P[n]},'mathe'\\)[^>]*>`)) || [''])[0];
pruefe('T8 nur angemeldet (fin) bleibt "ohne Aktivität" markiert - zeigt aber 📅1',
  trVon('fin').includes('#fef2f2') && zeile(matheTeil, 'fin')[2].text === '📅1' && !trVon('cleo').includes('#fef2f2'), trVon('fin'));
pruefe('T9 Legende erklaert die Zeichen', html.includes('🎤 Gehalten / 👂 Zugehört: je Talk die Flammen (neueste zuerst), ○ = ohne Flamme, ✗ = nicht gehalten bzw. nicht teilgenommen, ⏳ = vorbei, noch nicht bewertet, 📅 = angemeldet, steht noch an.'));
await seite.lauf(`hjSortieren('gehalten'); hjSortieren('gehalten')`);
const reihenfolge = [...seite.element('hj-content').innerHTML.split('>Englisch<')[0].matchAll(/openHjDetail\((\d+),'mathe'\)/g)]
  .map(m => Object.keys(P).find(k => P[k] === +m[1]));
pruefe('T10 sortiert wird weiter nach der Zahl der gehaltenen Talks', reihenfolge.slice(0, 3).sort().join() === 'ada,dan,eva', reihenfolge);

// ── D) Detail und "Mein Halbjahr" ────────────────────────────────────────────
seite.lauf(`openHjDetail(${P.ada}, 'mathe')`);
let d = seite.element('hjd-content').innerHTML;
pruefe('D1 Detail ada: ✗ nicht gehalten, 🔥🔥🔥, ⏳ noch nicht bewertet, 📅 steht noch an',
  /Prozente<\/strong> <span class="pill pill-red"[^>]*>✗ nicht gehalten/.test(d) && d.includes('Pythagoras</strong> 🔥🔥🔥')
  && /Zinsen<\/strong> <span class="pill pill-yellow"[^>]*>⏳ noch nicht bewertet/.test(d)
  && /Kreise<\/strong> <span class="pill pill-blue"[^>]*>📅 steht noch an/.test(d) && d.includes('🎤👂 Talks (4)'), d);
seite.lauf(`openHjDetail(${P.cleo}, 'mathe')`);
d = seite.element('hjd-content').innerHTML;
pruefe('D2 Detail cleo: ○ ohne Flamme', /Pythagoras<\/strong> <span class="pill pill-green"[^>]*>○ ohne Flamme/.test(d), d);
seite.lauf(`openHjDetail(${P.bo}, 'mathe')`);
pruefe('D3 Detail bo: ✗ nicht teilgenommen', /Prozente<\/strong> <span class="pill pill-red"[^>]*>✗ nicht teilgenommen/.test(seite.element('hjd-content').innerHTML));

wer = { userId: P.ada, username: 'ada', role: 'student', klasse: 'M3M4' };
await seite.lauf(`me = __werte.me; hjData = { halbjahre: [], students: [] }; loadHalbjahr()`, { me: wer }); await ruhe();
d = seite.element('hj-content').innerHTML;
pruefe('D4 "Mein Halbjahr" (ada): sieht den kommenden Talk und das ✗', d.includes('📅 steht noch an') && d.includes('✗ nicht gehalten')
  && !d.includes('openHjDetail'), d.slice(0, 600));

console.log(`\n${ok} Pruefungen ok`);
process.exit(0);
