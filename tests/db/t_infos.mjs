// Allgemeine Infos (Nutzerwunsch 2026-11-04) - Server: News fuer "Aktuelles" (sichtbar ab/bis,
// Vorgabe eine Woche, vorplanbar) und Karten fuer den Reiter "Allgemeine Infos" (Reihenfolge je
// Spalte). Alle Lernbegleitungen des Tandems duerfen alles bearbeiten; Schueler:innen bekommen
// nur, was heute sichtbar ist. Laeuft gegen die ECHTE server.js (ganz geladen, pglite).
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
const neu = async (name, rolle = 'student', klasse = 'M3M4') =>
  (await eins(`INSERT INTO users (username, password_hash, klasse, role) VALUES ($1,'x',$2,$3) RETURNING id`, [name, klasse, rolle])).id;
const LB1 = await neu('lb_eins', 'admin');
const LB2 = await neu('lb_zwei', 'admin');
const LB9 = await neu('lb_fremd', 'admin', 'M1M2');
const ANA = await neu('ana');
const A1 = { userId: LB1, role: 'admin', klasse: 'M3M4' };
const A2 = { userId: LB2, role: 'admin', klasse: 'M3M4' };
const A9 = { userId: LB9, role: 'admin', klasse: 'M1M2' };
const S = { userId: ANA, role: 'student', klasse: 'M3M4' };
const tagIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tag = n => { const h = new Date(); return tagIso(new Date(h.getFullYear(), h.getMonth(), h.getDate() + n)); };
const anlegen = (sess, body) => srv.rufe('post', '/api/admin/infos', { session: sess, body });
const aendern = (sess, id, body) => srv.rufe('put', '/api/admin/infos/:id', { session: sess, params: { id }, body });
const holen = async sess => (await srv.rufe('get', '/api/infos', { session: sess })).body;
const zeile = id => eins(`SELECT *, to_char(sichtbar_ab,'YYYY-MM-DD') AS ab, to_char(sichtbar_bis,'YYYY-MM-DD') AS bis FROM infos WHERE id=$1`, [id]);

// ── R) Rechte ────────────────────────────────────────────────────────────────
const route = (m, pfad) => srv.routen.find(r => r.m === m && r.pfad === pfad);
const schutz = (m, pfad) => {
  const h = route(m, pfad).handler;
  let code = 0, weiter = false;
  h[0]({ session: { userId: ANA, role: 'student' } }, { status(c) { code = c; return this; }, json() { return this; } }, () => { weiter = true; });
  return h.length === 2 && code === 403 && !weiter;
};
pruefe('R1 Schreiben nur fuer Lernbegleitungen (anlegen, aendern, loeschen, verschieben)',
  schutz('post', '/api/admin/infos') && schutz('put', '/api/admin/infos/:id') && schutz('delete', '/api/admin/infos/:id')
  && schutz('post', '/api/admin/infos/:id/verschieben'));
pruefe('R2 Lesen fuer alle Angemeldeten', route('get', '/api/infos').handler.length === 2);

// ── N) News ──────────────────────────────────────────────────────────────────
let r = await anlegen(A1, { art: 'news', titel: 'Dienste', text: 'Fegen M3: ana\r\nPlenum: ben' });
const n1 = r.body.id;
let z = await zeile(n1);
pruefe('N1 Vorgabe: ab heute eine Woche (7 Tage) sichtbar, Allgemein, Fachfarbe, nicht angeheftet',
  r.code === 200 && z.ab === tag(0) && z.bis === tag(6) && z.subject_id === null && z.farbe === '' && z.angeheftet === false
  && z.klasse === 'M3M4' && z.admin_id === LB1, [r.body, z]);
pruefe('N2 Zeilenumbrueche aus Windows werden vereinheitlicht', z.text === 'Fegen M3: ana\nPlenum: ben', z.text);
const fehler = async (body, teil, name) => {
  const x = await anlegen(A1, { art: 'news', titel: 'x', ...body });
  pruefe(name, x.code === 400 && (!teil || x.body.error.includes(teil)), x.body);
};
await fehler({ titel: '', text: ' ', links: [] }, 'Titel, Text oder Link', 'N3 leer: abgelehnt');
await fehler({ art: 'quatsch' }, 'Art', 'N4 unbekannte Art: abgelehnt');
await fehler({ farbe: 'pink' }, 'Farbe', 'N5 unbekannte Farbe: abgelehnt');
await fehler({ sichtbarAb: tag(3), sichtbarBis: tag(2) }, 'liegt vor', 'N6 bis vor ab: abgelehnt');
await fehler({ sichtbarAb: '2026-02-30' }, 'Datum', 'N7 kein echtes Datum: abgelehnt');
await fehler({ subjectId: 99999 }, 'Fach', 'N8 unbekanntes Fach: abgelehnt');
await fehler({ links: [{ titel: 'böse', url: 'javascript:alert(1)' }] }, 'http', 'N9 javascript:-Link: abgelehnt');
await fehler({ links: [{ titel: 'ohne Adresse', url: '' }] }, 'fehlt die Adresse', 'N10 Link-Name ohne Adresse: abgelehnt');
await fehler({ links: Array.from({ length: 11 }, (_, i) => ({ titel: '', url: 'https://x.de/' + i })) }, 'Höchstens 10', 'N11 mehr als 10 Links: abgelehnt');
await fehler({ titel: 'x'.repeat(121) }, 'Titel', 'N12 zu langer Titel: abgelehnt');
pruefe('N13 nichts Abgelehntes wurde gespeichert', (await eins(`SELECT COUNT(*)::int AS n FROM infos`)).n === 1);
r = await anlegen(A1, { art: 'news', titel: 'Links', links: [{ titel: 'TaskCard', url: 'www.taskcards.de/board/1' },
  { titel: '', url: '' }, { titel: '', url: 'http://schule.de' }] });
z = await zeile(r.body.id);
pruefe('N14 "www.…" bekommt https://, leere Zeilen fallen weg, http bleibt',
  z.links.map(l => l.titel + '|' + l.url).join(' ; ') === 'TaskCard|https://www.taskcards.de/board/1 ; |http://schule.de', z.links);
const nLinks = r.body.id;

const nGeplant = (await anlegen(A1, { art: 'news', titel: 'Dienste naechste Woche', sichtbarAb: tag(3), subjectId: F.mathe, farbe: 'gelb' })).body.id;
z = await zeile(nGeplant);
pruefe('N15 vorgeplant: ab in 3 Tagen, eine Woche ab dann; Fach und Farbe gespeichert',
  z.ab === tag(3) && z.bis === tag(9) && z.subject_id === F.mathe && z.farbe === 'gelb', z);
const nAlt = (await anlegen(A1, { art: 'news', titel: 'Alte Info', sichtbarAb: tag(-10), sichtbarBis: tag(-1) })).body.id;
const nHeuteZuEnde = (await anlegen(A1, { art: 'news', titel: 'Nur heute', sichtbarAb: tag(-3), sichtbarBis: tag(0), angeheftet: true })).body.id;
const kAllg = (await anlegen(A1, { art: 'karte', titel: 'Berufsorientierung', links: [{ titel: 'TaskCard', url: 'https://taskcards.de/bo' }],
  sichtbarBis: tag(1), angeheftet: true })).body.id;
z = await zeile(kAllg);
pruefe('N16 Karten haben keine Sichtbarkeits-Daten und sind nie angeheftet', z.ab === null && z.bis === null && z.angeheftet === false, z);

// ── S) Wer sieht was ─────────────────────────────────────────────────────────
let d = await holen(S);
const ids = l => l.map(x => x.id).sort((a, b) => a - b).join(',');
pruefe('S1 Schueler:innen: nur heute sichtbare News (auch die, die heute endet), alle Karten',
  ids(d.news) === [n1, nLinks, nHeuteZuEnde].sort((a, b) => a - b).join(',') && ids(d.karten) === String(kAllg) && d.heute === tag(0), d);
pruefe('S2 ... ohne Namen der Lernbegleitung', d.news.every(x => x.vonUsername === undefined), d.news[0]);
pruefe('S3 angeheftete News zuerst', d.news[0].id === nHeuteZuEnde, d.news.map(x => x.id));
d = await holen(A2);
pruefe('S4 Lernbegleitungen: alle News (auch geplante und abgelaufene), mit Namen',
  ids(d.news) === [n1, nLinks, nGeplant, nAlt, nHeuteZuEnde].sort((a, b) => a - b).join(',') && d.news.every(x => x.vonUsername === 'lb_eins'), d);
const n1Json = d.news.find(x => x.id === n1);
pruefe('S5 Felder fuer die Seite', n1Json.sichtbarAb === tag(0) && n1Json.sichtbarBis === tag(6) && n1Json.subjectId === null
  && Array.isArray(n1Json.links) && n1Json.art === 'news' && n1Json.angeheftet === false, n1Json);
d = await holen(A9);
pruefe('S6 ein anderes Tandem sieht nichts davon', d.news.length === 0 && d.karten.length === 0, d);

// ── A) Aendern und Loeschen ──────────────────────────────────────────────────
r = await aendern(A2, n1, { titel: 'Dienste (geändert)' });
z = await zeile(n1);
pruefe('A1 jede Lernbegleitung darf jede Info aendern - nur Mitgeschicktes aendert sich',
  r.code === 200 && z.titel === 'Dienste (geändert)' && z.text === 'Fegen M3: ana\nPlenum: ben' && z.ab === tag(0) && z.bis === tag(6), [r.body, z]);
r = await aendern(A2, n1, { sichtbarBis: tag(-1) });
pruefe('A2 bis vor ab: abgelehnt, nichts geaendert', r.code === 400 && (await zeile(n1)).bis === tag(6), r.body);
r = await aendern(A1, nAlt, { sichtbarAb: tag(0), sichtbarBis: tag(6) });
pruefe('A3 abgelaufene Info erneut zeigen = neue Daten am selben Eintrag', r.code === 200 && (await zeile(nAlt)).bis === tag(6), r.body);
r = await aendern(A1, n1, { farbe: 'lila', angeheftet: true, subjectId: F.englisch, links: [{ titel: 'x', url: 'https://x.de' }] });
z = await zeile(n1);
pruefe('A4 Farbe, Anheften, Fach und Links aenderbar', r.code === 200 && z.farbe === 'lila' && z.angeheftet === true
  && z.subject_id === F.englisch && z.links.length === 1, z);
r = await aendern(A1, n1, { subjectId: null, farbe: '' });
z = await zeile(n1);
pruefe('A5 zurueck auf Allgemein und Fachfarbe', r.code === 200 && z.subject_id === null && z.farbe === '', z);
r = await aendern(A9, n1, { titel: 'fremd' });
pruefe('A6 ein anderes Tandem kann nichts aendern', r.code === 404 && (await zeile(n1)).titel === 'Dienste (geändert)', r.body);
r = await srv.rufe('delete', '/api/admin/infos/:id', { session: A9, params: { id: n1 } });
pruefe('A7 ... und nichts loeschen', r.code === 404 && !!(await zeile(n1)), r.body);
r = await srv.rufe('delete', '/api/admin/infos/:id', { session: A2, params: { id: nLinks } });
pruefe('A8 Loeschen', r.code === 200 && !(await zeile(nLinks)), r.body);
r = await srv.rufe('delete', '/api/admin/infos/:id', { session: A2, params: { id: nLinks } });
pruefe('A9 schon weg: 404', r.code === 404, r.body);

// ── K) Karten: Reihenfolge je Spalte ─────────────────────────────────────────
const k2 = (await anlegen(A1, { art: 'karte', titel: 'Gestaltete Pausen' })).body.id;
const k3 = (await anlegen(A2, { art: 'karte', titel: 'Dienste-Plan' })).body.id;
const kM1 = (await anlegen(A1, { art: 'karte', titel: 'Lerntheken', subjectId: F.mathe })).body.id;
const pos = async id => (await zeile(id)).position;
pruefe('K1 neue Karten ans Ende ihrer Spalte (Allgemein 1,2,3 - Mathe 1)',
  await pos(kAllg) === 1 && await pos(k2) === 2 && await pos(k3) === 3 && await pos(kM1) === 1);
const schieben = (id, richtung, sess = A1) => srv.rufe('post', '/api/admin/infos/:id/verschieben', { session: sess, params: { id }, body: { richtung } });
const spalte = async fach => (await db.query(`SELECT titel FROM infos WHERE art='karte' AND subject_id IS NOT DISTINCT FROM $1 ORDER BY position, id`, [fach])).rows.map(x => x.titel).join(' | ');
r = await schieben(k3, 'hoch');
pruefe('K2 nach oben', r.code === 200 && await spalte(null) === 'Berufsorientierung | Dienste-Plan | Gestaltete Pausen', await spalte(null));
r = await schieben(kAllg, 'hoch');
pruefe('K3 ganz oben bleibt oben', r.code === 200 && r.body.unveraendert === true && await spalte(null) === 'Berufsorientierung | Dienste-Plan | Gestaltete Pausen');
r = await schieben(kAllg, 'runter', A2);
pruefe('K4 nach unten (auch durch eine andere Lernbegleitung)', r.code === 200 && await spalte(null) === 'Dienste-Plan | Berufsorientierung | Gestaltete Pausen', await spalte(null));
await db.query(`UPDATE infos SET position=5 WHERE id = ANY($1::int[])`, [[kAllg, k2, k3]]);
r = await schieben(k2, 'hoch');
pruefe('K5 doppelte Positionen: die Spalte wird sauber neu nummeriert',
  r.code === 200 && (await db.query(`SELECT position FROM infos WHERE art='karte' AND subject_id IS NULL ORDER BY position`)).rows.map(x => x.position).join(',') === '1,2,3', await spalte(null));
r = await schieben(n1, 'hoch');
pruefe('K6 News lassen sich nicht verschieben', r.code === 404, r.body);
r = await schieben(k2, 'seitwaerts');
pruefe('K7 unbekannte Richtung: abgelehnt', r.code === 400, r.body);
r = await schieben(k2, 'hoch', A9);
pruefe('K8 anderes Tandem: nicht gefunden', r.code === 404, r.body);
r = await aendern(A1, k2, { subjectId: F.mathe });
pruefe('K9 Karte in eine andere Spalte: dort ans Ende', r.code === 200 && await pos(k2) === 2 && await spalte(F.mathe) === 'Lerntheken | Gestaltete Pausen', await spalte(F.mathe));
r = await aendern(A1, k2, { titel: 'Pausen' });
pruefe('K10 Aendern ohne Spaltenwechsel laesst die Position', r.code === 200 && await pos(k2) === 2);
r = await aendern(A1, kM1, { sichtbarBis: tag(1), angeheftet: true });
z = await zeile(kM1);
pruefe('K11 Karten bekommen auch beim Aendern keine Daten', r.code === 200 && z.bis === null && z.angeheftet === false, z);

console.log(`\n${ok} Pruefungen ok`);
process.exit(0);
