// Allgemeine Infos auf der Seite (Nutzerwunsch 2026-11-04) - Seite und Server ZUSAMMEN
// (seite_im_test + server_im_test, pglite):
//  - "📢 Aktuelles" auf der Startseite der Schueler:innen (hoechstens 3, Rest auf Klick)
//  - Plenum → Heute: Aktuelles gross, "+ Info", ✎, Geplant/Abgelaufen; unter "Woche" nur ein Hinweis
//  - Formular: Vorgabe eine Woche, Schnellwahl, vorplanen, Farbe (Fach zuerst), Links, Fehler
//  - Reiter "Allgemeine Infos": Spalten Allgemein + je Fach, Karten, Reihenfolge, Einklappen
//  - Text bleibt Text (kein HTML), nur http(s)-Links
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
const ANA = await neu('ana');
const tagIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tag = n => { const h = new Date(); return tagIso(new Date(h.getFullYear(), h.getMonth(), h.getDate() + n)); };
const A = { userId: LB, role: 'admin', klasse: 'M3M4' };
const anlegen = async body => (await srv.rufe('post', '/api/admin/infos', { session: A, body })).body.id;

// Bestand: 5 aktuelle News (eine angeheftet, eine mit langem Text und gefaehrlichem Inhalt),
// eine geplante, eine abgelaufene; Karten in Allgemein und Mathe.
const nDienste = await anlegen({ art: 'news', titel: 'Dienste', text: 'Fegen M3: ana', angeheftet: true });
const nBoese = await anlegen({ art: 'news', titel: '<b>fett</b>', subjectId: F.mathe,
  text: 'Siehe https://taskcards.de/board/7. <img src=x onerror=alert(1)>\n' + 'lang '.repeat(60) });
const n3 = await anlegen({ art: 'news', titel: 'Drei', sichtbarAb: tag(-2) });
const n4 = await anlegen({ art: 'news', titel: 'Vier', sichtbarAb: tag(-3) });
const n5 = await anlegen({ art: 'news', titel: 'Fünf', sichtbarAb: tag(-4) });
const nGeplant = await anlegen({ art: 'news', titel: 'Nächste Woche', sichtbarAb: tag(4) });
const nAlt = await anlegen({ art: 'news', titel: 'Vorbei', sichtbarAb: tag(-9), sichtbarBis: tag(-2) });
const kBO = await anlegen({ art: 'karte', titel: 'Berufsorientierung', links: [{ titel: 'TaskCard BO', url: 'https://taskcards.de/bo' }] });
const kPause = await anlegen({ art: 'karte', titel: 'Gestaltete Pausen', farbe: 'gruen', links: [{ titel: '', url: 'https://www.canva.com/design/abcdefghijklmnopqrstuvwxyz0123456789' }] });
const kMathe = await anlegen({ art: 'karte', titel: 'Lerntheken-Material', subjectId: F.mathe });

// ── Seite, verbunden mit dem Server ──────────────────────────────────────────
const seite = ladeSeite();
let wer = { userId: ANA, username: 'ana', role: 'student', klasse: 'M3M4' };
let offen = 0;
const serverFetch = srv.fetchFuer(() => ({ userId: wer.userId, role: wer.role, klasse: wer.klasse }));
seite.kontext.fetch = async (...a) => { offen++; try { return await serverFetch(...a); } finally { offen--; } };
const meldungen = [];
seite.kontext.alert = t => meldungen.push(String(t));
const ruhe = async () => { do { await new Promise(r => setTimeout(r, 5)); } while (offen > 0); await new Promise(r => setTimeout(r, 5)); };
const lauf = (code, werte) => seite.lauf(code, werte);
const html = id => seite.element(id).innerHTML;
const el = id => seite.element(id);
await lauf(`me = __werte.me; subjectsMeta = []; loadSubjectsMeta()`, { me: wer }); await ruhe();
await lauf('loadInfos()'); await ruhe();

// ── H) Startseite der Schueler:innen ─────────────────────────────────────────
let h = html('home-news');
const karten = h => (h.match(/class="info-karte"/g) || []).length;
pruefe('H1 "📢 Aktuelles" mit hoechstens 3 Karten, darunter "+ 2 weitere"',
  h.includes('📢 Aktuelles') && karten(h) === 3 && h.includes('+ 2 weitere'), h);
pruefe('H2 angeheftet zuerst (📌), dann die neuesten', h.indexOf('📌 Dienste') > 0 && h.indexOf('📌 Dienste') < h.indexOf('fett')
  && h.indexOf('fett') < h.indexOf('Drei') && !h.includes('Vier'), h);
pruefe('H3 Geplantes und Abgelaufenes sehen Schueler:innen nicht', !h.includes('Nächste Woche') && !h.includes('Vorbei'), h);
pruefe('H4 keine Bearbeiten-Knoepfe', !h.includes('openInfoForm('), h);
pruefe('H5 Text bleibt Text: kein HTML aus Titel oder Text',
  h.includes('&lt;b&gt;fett&lt;/b&gt;') && h.includes('&lt;img src=x onerror=alert(1)&gt;') && !h.includes('<img') && !h.includes('<b>'), h);
pruefe('H6 Adressen im Text werden klickbar (ohne den Punkt dahinter), in neuem Tab',
  h.includes('<a href="https://taskcards.de/board/7" target="_blank" rel="noopener noreferrer">https://taskcards.de/board/7</a>.'), h);
pruefe('H7 langer Text eingeklappt, mit "mehr …"; Fach-Kennzeichen', h.includes('info-text zu') && h.includes(`onclick="infoAufklappen(${nBoese})">mehr …`)
  && h.includes('title="Mathe">M</span>'), h);
lauf(`infoAufklappen(${nBoese})`);
pruefe('H8 "mehr …" klappt auf', !html('home-news').includes('info-text zu') && html('home-news').includes('>weniger<'), html('home-news'));
lauf('homeNewsAlle()');
pruefe('H9 "+ 2 weitere": alle fuenf', karten(html('home-news')) === 5 && html('home-news').includes('weniger anzeigen'), html('home-news'));
pruefe('H10 die Startseite laedt die Infos mit', /async function showHome\(\) \{[\s\S]*?loadInfos\(\)[\s\S]*?\n\}/.test(lies('public/index.html'))
  && lies('public/index.html').indexOf('id="home-news"') < lies('public/index.html').indexOf('id="home-wuensche"'));

// ── B) Reiter "Allgemeine Infos" (Schueler:innen) ────────────────────────────
const quelle = lies('public/index.html');
pruefe('B0 Reiter fuer beide Rollen, vor der Tandem-Uebersicht',
  /<button type="button" class="tab" id="tab-infos" onclick="showView\('infos'\)">ℹ️ Allgemeine Infos<\/button>/.test(quelle)
  && quelle.indexOf('id="tab-infos"') < quelle.indexOf('id="tab-klasse"') && quelle.includes("'plenum','infos','changepw'"));
h = html('iw-inhalt');
const spalten = h => [...h.matchAll(/<section class="iw-spalte" aria-label="([^"]+)">/g)].map(m => m[1]).join(',');
pruefe('B1 Spalten Allgemein, Mathe, Englisch, Deutsch (keine Lernberatung)', spalten(h) === 'Allgemein,Mathe,Englisch,Deutsch'
  && h.includes('--iw-spalten:4'), spalten(h));
const spalteHtml = (h, name) => { const a = h.indexOf(`aria-label="${name}"`); return h.slice(a, h.indexOf('</section>', a)); };
pruefe('B2 Karten in ihrer Spalte, mit Anzahl; Links als Knopf in neuem Tab',
  spalteHtml(h, 'Allgemein').includes('Berufsorientierung') && spalteHtml(h, 'Allgemein').includes('Gestaltete Pausen')
  && spalteHtml(h, 'Mathe').includes('Lerntheken-Material') && spalteHtml(h, 'Allgemein').includes('<span class="iw-zahl">2</span>')
  && h.includes('href="https://taskcards.de/bo" target="_blank"') && h.includes('🔗 TaskCard BO'), h);
pruefe('B3 Link ohne Namen: gekuerzte Adresse', h.includes('🔗 www.canva.com/design/abcdefghijklmnopq…</a>'), h);
pruefe('B4 leere Spalte: "Noch nichts hier."; keine Bearbeiten-Knoepfe', spalteHtml(h, 'Englisch').includes('Noch nichts hier.')
  && !h.includes('openInfoForm(') && !h.includes('infoVerschieben('), h);
pruefe('B5 Farbe: gewaehlte (Gruen) bzw. die des Fachs, sonst Tuerkis fuer Allgemein',
  h.includes('--info-rand:#16a34a;--info-grund:#f0fdf4;') && h.includes('--info-rand:#0d9488;--info-grund:#f0fdfa;'), h);
lauf(`iwSpalteUmschalten('allg')`);
h = html('iw-inhalt');
pruefe('B6 Spalte einklappen', spalteHtml(h, 'Allgemein').includes('aria-expanded="false"') && !spalteHtml(h, 'Allgemein').includes('Berufsorientierung')
  && spalteHtml(h, 'Mathe').includes('Lerntheken-Material'), spalteHtml(h, 'Allgemein'));
lauf(`iwSpalteUmschalten('allg')`);
pruefe('B7 und wieder auf', spalteHtml(html('iw-inhalt'), 'Allgemein').includes('Berufsorientierung'));

// ── P) Plenum (Lernbegleitung) ───────────────────────────────────────────────
wer = { userId: LB, username: 'lb', role: 'admin', klasse: 'M3M4', superAdmin: false, defaultSubjectId: F.mathe };
await lauf(`me = __werte.me; _plZeitraum = 'woche'; loadPlenum()`, { me: wer }); await ruhe();
pruefe('P1 Woche: nur ein Hinweis-Knopf zu "Heute"', html('pl-news').includes(`onclick="plZeitraum('heute')">📢 Aktuelles (5) – unter „Heute“`)
  && !html('pl-news').includes('info-karte'), html('pl-news'));
pruefe('P2 Lernbegleitung: keine Schueler-Startseite', html('home-news') === '', html('home-news'));
lauf(`plZeitraum('heute')`);
h = html('pl-news');
pruefe('P3 Heute: Aktuelles gross mit "+ Info", alle fuenf mit ✎ und "sichtbar bis"',
  h.includes('pl-news') && h.includes(`onclick="openInfoForm('news')">+ Info`) && karten(h) === 5
  && (h.match(/openInfoForm\('news', \d+\)">✎/g) || []).length === 5 && h.includes('sichtbar bis'), h);
pruefe('P4 Geplant (1) und Abgelaufen (1) zum Aufklappen', h.includes('🗓 Geplant (1)') && h.includes('⌛ Abgelaufen (1)')
  && !h.includes('Nächste Woche') && !h.includes('Vorbei'), h);
lauf(`plNewsListe('geplant')`);
pruefe('P5 Geplant aufgeklappt: Titel, ab/bis, Bearbeiten', html('pl-news').includes('Nächste Woche')
  && html('pl-news').includes(`sichtbar ab ${lauf(`lwFmtDay('${tag(4)}')`)}`) && html('pl-news').includes(`openInfoForm('news', ${nGeplant})`), html('pl-news'));
lauf(`plNewsListe('abgelaufen')`);
pruefe('P6 Abgelaufen aufgeklappt: "↻ Erneut zeigen" und ×', html('pl-news').includes('Vorbei')
  && html('pl-news').includes(`openInfoForm('news', ${nAlt}, undefined, true)">↻ Erneut zeigen`) && html('pl-news').includes(`infoLoeschen(${nAlt})`), html('pl-news'));
pruefe('P7 im Plenum steht Aktuelles vor den Wuenschen', quelle.indexOf('<div id="pl-news"></div>') < quelle.indexOf('<div id="pl-wuensche"></div>'));

// ── F) Formular ──────────────────────────────────────────────────────────────
lauf(`openInfoForm('news')`);
pruefe('F1 neue Info: ab heute, bis in 6 Tagen ("1 Woche" gedrueckt), Allgemein, Fachfarbe gewaehlt, kein Loeschen',
  el('info-ab').value === tag(0) && el('info-bis').value === tag(6) && el('info-d7').className === 'wu-btn dabei'
  && el('info-d1').className === 'wu-btn' && el('info-fach').value === '' && el('info-news-felder').style.display === ''
  && el('info-loeschen').style.display === 'none' && html('info-farben').includes('aria-pressed="true"')
  && /aria-pressed="true"[^>]*>[\s\S]*?Allgemein \(Türkis\)/.test(html('info-farben'))
  && el('info-dauer').textContent.includes('(7 Tage)') && html('info-links') === '', [el('info-ab').value, el('info-bis').value, html('info-farben')]);
el('info-fach').value = String(F.englisch);
lauf('infoFormFarbenZeigen()');
pruefe('F2 Fach gewechselt: die erste Farbe heisst jetzt "wie Englisch"', html('info-farben').includes('wie Englisch'), html('info-farben'));
el('info-fach').value = '';
lauf('infoFormFarbenZeigen(); infoDauer(14)');
pruefe('F3 "2 Wochen": bis in 13 Tagen', el('info-bis').value === tag(13) && el('info-d14').className === 'wu-btn dabei'
  && el('info-dauer').textContent.includes('(14 Tage)'), el('info-bis').value);
el('info-ab').value = tag(3);
lauf('infoAbGeaendert()');
pruefe('F4 vorplanen: ab verschoben, Dauer bleibt, Hinweis "erscheint erst dann"',
  el('info-bis').value === tag(16) && el('info-dauer').textContent.includes('erscheint erst dann'), [el('info-bis').value, el('info-dauer').textContent]);
el('info-bis').value = tag(5);
lauf('infoBisGeaendert()');
pruefe('F5 "bis" von Hand: keine Schnellwahl mehr gedrueckt, Tage neu gezaehlt', el('info-d14').className === 'wu-btn'
  && el('info-d7').className === 'wu-btn' && el('info-dauer').textContent.includes('(3 Tage)'), el('info-dauer').textContent);
el('info-bis').value = tag(1);
lauf('infoBisGeaendert()');
await lauf('infoSpeichern()'); await ruhe();
const zahl = async () => (await eins(`SELECT COUNT(*)::int AS n FROM infos`)).n;
pruefe('F6 bis vor ab: Hinweis, nichts gespeichert', el('info-error').textContent.includes('liegt vor') && await zahl() === 10, el('info-error').textContent);
lauf('infoDauer(7)');
pruefe('F7 Schnellwahl rechnet ab "sichtbar ab"', el('info-bis').value === tag(9), el('info-bis').value);
await lauf('infoSpeichern()'); await ruhe();
pruefe('F8 ohne Titel, Text und Link: Hinweis, nichts gespeichert', el('info-error').textContent.includes('Titel, Text oder Link') && await zahl() === 10);
el('info-titel').value = 'Dienste KW 46';
el('info-text').value = 'Fegen: ben';
lauf('infoLinkDazu()');
el('info-lt-0').value = 'Plan';
el('info-lu-0').value = 'www.schule.de/plan';
lauf('infoLinkDazu()');
pruefe('F9 "+ Link" behaelt, was schon eingetippt ist', /id="info-lu-0"[^>]*value="www.schule.de\/plan"/.test(html('info-links'))
  && html('info-links').includes('id="info-lu-1"'), html('info-links'));
lauf(`infoFarbeWaehlen('orange')`);
el('info-oben').checked = true;
await lauf('infoSpeichern()'); await ruhe();
let z = await eins(`SELECT *, to_char(sichtbar_ab,'YYYY-MM-DD') AS ab, to_char(sichtbar_bis,'YYYY-MM-DD') AS bis FROM infos WHERE titel='Dienste KW 46'`);
pruefe('F10 gespeichert: vorgeplant, Farbe, angeheftet, Link mit https (leere Zeile faellt weg)',
  z && z.art === 'news' && z.ab === tag(3) && z.bis === tag(9) && z.farbe === 'orange' && z.angeheftet === true
  && z.links.length === 1 && z.links[0].url === 'https://www.schule.de/plan' && z.subject_id === null, z);
pruefe('F11 Formular zu, Plenum zeigt "Geplant (2)"', lauf('_infoForm') === null && html('pl-news').includes('🗓 Geplant (2)'), html('pl-news'));

lauf(`openInfoForm('news', ${nDienste})`);
pruefe('F12 Bearbeiten: Werte stehen drin, Loeschen sichtbar', el('info-titel').value === 'Dienste' && el('info-text').value === 'Fegen M3: ana'
  && el('info-ab').value === tag(0) && el('info-bis').value === tag(6) && el('info-oben').checked === true
  && el('info-loeschen').style.display === '' && seite.element('info-kopf').textContent === '📢 Info bearbeiten');
el('info-titel').value = 'Dienste diese Woche';
await lauf('infoSpeichern()'); await ruhe();
z = await eins(`SELECT titel, to_char(sichtbar_bis,'YYYY-MM-DD') AS bis FROM infos WHERE id=$1`, [nDienste]);
pruefe('F13 geaendert, Daten unveraendert', z.titel === 'Dienste diese Woche' && z.bis === tag(6) && html('pl-news').includes('Dienste diese Woche'), z);

lauf(`openInfoForm('news', ${nDienste})`);
pruefe('F13b beim Bearbeiten gibt es "⧉ Kopie für die Zeit danach"', el('info-kopie').style.display === '');
lauf('infoKopie()');
pruefe('F13c Kopie: neue Info, ab dem Tag nach dieser, eine Woche', lauf('_infoForm.id') === null
  && el('info-ab').value === tag(7) && el('info-bis').value === tag(13) && el('info-titel').value === 'Dienste diese Woche'
  && el('info-loeschen').style.display === 'none' && el('info-kopie').style.display === 'none'
  && seite.element('info-kopf').textContent === '📢 Neue Info (Kopie)', [el('info-ab').value, el('info-bis').value]);
el('info-titel').value = 'Dienste nächste Woche';
await lauf('infoSpeichern()'); await ruhe();
z = await eins(`SELECT to_char(sichtbar_ab,'YYYY-MM-DD') AS ab, angeheftet, text FROM infos WHERE titel='Dienste nächste Woche'`);
pruefe('F13d gespeichert als zweite Info (Inhalt mitgenommen), das Original bleibt',
  z && z.ab === tag(7) && z.angeheftet === true && z.text === 'Fegen M3: ana'
  && (await eins(`SELECT titel, to_char(sichtbar_bis,'YYYY-MM-DD') AS bis FROM infos WHERE id=$1`, [nDienste])).bis === tag(6)
  && html('pl-news').includes('🗓 Geplant (3)'), z);
lauf(`openInfoForm('news')`);
pruefe('F13e bei einer neuen Info kein Kopie-Knopf', el('info-kopie').style.display === 'none');

lauf(`openInfoForm('news', ${nAlt}, undefined, true)`);
pruefe('F13f beim "Erneut zeigen" auch nicht', el('info-kopie').style.display === 'none');
pruefe('F14 "Erneut zeigen": derselbe Eintrag mit frischen Daten (heute + 1 Woche)',
  seite.element('info-kopf').textContent === '📢 Info erneut zeigen' && el('info-ab').value === tag(0) && el('info-bis').value === tag(6)
  && el('info-titel').value === 'Vorbei');
await lauf('infoSpeichern()'); await ruhe();
pruefe('F15 ... und ist wieder aktuell', html('pl-news').includes('Vorbei') && !html('pl-news').includes('⌛ Abgelaufen')
  && (await eins(`SELECT COUNT(*)::int AS n FROM infos WHERE titel='Vorbei'`)).n === 1, html('pl-news'));

lauf(`openInfoForm('news', ${n5})`);
await lauf(`infoLoeschenAusForm()`); await ruhe();
pruefe('F16 Loeschen aus dem Formular', !(await eins(`SELECT id FROM infos WHERE id=$1`, [n5])) && lauf('_infoForm') === null
  && !html('pl-news').includes('Fünf'), html('pl-news'));

// ── K) Reiter als Lernbegleitung ─────────────────────────────────────────────
h = html('iw-inhalt');
pruefe('K1 je Spalte "+", je Karte ✎ ↑ ↓ (oben ↑ aus, unten ↓ aus)',
  (h.match(/>\+<\/button>/g) || []).length === 4 && h.includes(`openInfoForm('karte', null, ${F.mathe})`) && h.includes(`openInfoForm('karte', null, null)`)
  && new RegExp(`disabled\\s+onclick="infoVerschieben\\(${kBO}, 'hoch'\\)"`).test(h)
  && new RegExp(`disabled\\s+onclick="infoVerschieben\\(${kPause}, 'runter'\\)"`).test(h)
  && h.includes(`openInfoForm('karte', ${kBO})`) && spalteHtml(h, 'Englisch').includes('Noch leer – mit + eine Karte anlegen.'), h);
await lauf(`infoVerschieben(${kPause}, 'hoch')`); await ruhe();
h = spalteHtml(html('iw-inhalt'), 'Allgemein');
pruefe('K2 ↑ verschiebt', h.indexOf('Gestaltete Pausen') < h.indexOf('Berufsorientierung'), h);
lauf(`openInfoForm('karte', null, ${F.englisch})`);
pruefe('K3 neue Karte in Englisch: Fach vorgewaehlt, keine Datumsfelder, eine leere Link-Zeile',
  el('info-fach').value === String(F.englisch) && el('info-news-felder').style.display === 'none'
  && html('info-links').includes('id="info-lu-0"') && !html('info-links').includes('id="info-lu-1"')
  && seite.element('info-kopf').textContent === '📌 Neue Karte für „Allgemeine Infos“', html('info-links'));
el('info-titel').value = 'Vokabel-Trainer';
el('info-lt-0').value = 'Quizlet';
el('info-lu-0').value = 'https://quizlet.com/xyz';
await lauf('infoSpeichern()'); await ruhe();
h = html('iw-inhalt');
pruefe('K4 Karte steht in Englisch, mit Link; ohne Daten', spalteHtml(h, 'Englisch').includes('Vokabel-Trainer')
  && spalteHtml(h, 'Englisch').includes('href="https://quizlet.com/xyz"')
  && (await eins(`SELECT sichtbar_bis FROM infos WHERE titel='Vokabel-Trainer'`)).sichtbar_bis === null, spalteHtml(h, 'Englisch'));
lauf(`openInfoForm('karte', ${kMathe})`);
el('info-fach').value = '';
await lauf('infoSpeichern()'); await ruhe();
h = html('iw-inhalt');
pruefe('K5 Fach auf Allgemein geaendert: Karte wandert ans Ende von Allgemein',
  !spalteHtml(h, 'Mathe').includes('Lerntheken-Material') && spalteHtml(h, 'Allgemein').lastIndexOf('info-karte') < spalteHtml(h, 'Allgemein').indexOf('Lerntheken-Material'), h);

// ── X) Links nur http(s), auch auf der Seite ─────────────────────────────────
pruefe('X1 ein javascript:-Link wird nie zum Link', lauf(`infoLinksHtml([{ titel: 'x', url: 'javascript:alert(1)' }])`) === ''
  && !lauf(`infoTextHtml('javascript:alert(1) und "https://a.de/x" ok')`).includes('href="javascript')
  && lauf(`infoTextHtml('"https://a.de/x"')`) === '&quot;<a href="https://a.de/x" target="_blank" rel="noopener noreferrer">https://a.de/x</a>&quot;');
pruefe('X2 keine Fehlermeldungen unterwegs', meldungen.length === 0, meldungen);

console.log(`\n${ok} Pruefungen ok`);
process.exit(0);
