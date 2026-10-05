// Prueft die gekuerzten Ranglisten der Startseite: Top 10 + eigene Zeile mit Umfeld,
// Gleichstand = gleicher Platz (Nutzerwunsch 2026-10-04).
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); if (a < 0) throw new Error('fehlt: ' + k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };

const code = ['function lbAuswahl(', 'function lbPlaetze(', 'function lbRangSymbol(', 'function lbQuote(',
  'function lbNachQuote(', 'function ranglisteHtml(', 'function hjText(', 'function meineFlammen('].map(schneide).join('\n');
const api = new Function('const LB_TOP = 10; const LB_UMFELD = 2;\n' + code +
  '\nreturn { lbAuswahl, lbPlaetze, lbRangSymbol, lbQuote, lbNachQuote, ranglisteHtml, hjText, meineFlammen };')();

// --- Auswahl ---------------------------------------------------------------
const A = (n, ich) => api.lbAuswahl(n, ich);
const bereich = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
pruefe('A1 Platz 17 von 30: Top 10, dann 15-19 (du mit je 2 davor und danach)',
  JSON.stringify(A(30, 16)) === JSON.stringify([...bereich(0, 9), ...bereich(14, 18)]), A(30, 16));
pruefe('A2 in den Top 10: nur die Top 10', JSON.stringify(A(30, 5)) === JSON.stringify(bereich(0, 9)), A(30, 5));
pruefe('A3 knapp dahinter: lueckenlos, nichts doppelt', JSON.stringify(A(30, 11)) === JSON.stringify(bereich(0, 13)), A(30, 11));
pruefe('A4 genau EINE versteckte Zeile wird gezeigt statt "⋯"',
  JSON.stringify(A(30, 13)) === JSON.stringify(bereich(0, 15)), A(30, 13));
pruefe('A5 zwei versteckte Zeilen: die bleiben weg', JSON.stringify(A(30, 14)) === JSON.stringify([...bereich(0, 9), ...bereich(12, 16)]), A(30, 14));
pruefe('A6 nicht in der Liste (Lernbegleitung): nur die Top 10', JSON.stringify(A(30, -1)) === JSON.stringify(bereich(0, 9)));
pruefe('A7 nur eine Zeile ueber die Top 10 hinaus: alle zeigen', JSON.stringify(A(11, -1)) === JSON.stringify(bereich(0, 10)));
pruefe('A8 kurze Liste: alles', JSON.stringify(A(7, 3)) === JSON.stringify(bereich(0, 6)));
pruefe('A9 Letzter Platz: Umfeld nur nach oben', JSON.stringify(A(30, 29)) === JSON.stringify([...bereich(0, 9), ...bereich(27, 29)]), A(30, 29));

// --- Plaetze ---------------------------------------------------------------
pruefe('P1 Gleichstand = gleicher Platz, danach weiter mit der echten Position',
  JSON.stringify(api.lbPlaetze([25, 21, 14, 13, 13, 13, 11])) === JSON.stringify([1, 2, 3, 4, 4, 4, 7]));
pruefe('P2 Gleichstand ganz oben: zweimal Gold', api.lbPlaetze([5, 5, 3]).map(api.lbRangSymbol).join(' ') === '🥇 🥇 🥉');

// --- Quote -----------------------------------------------------------------
const r = (n, p, m) => ({ username: n, pokale: p, ownMax: m });
const sortiert = api.lbNachQuote([r('a', 0, 0), r('b', 1, 8), r('c', 0, 9), r('d', 2, 15), r('e', 3, 12)]);
pruefe('Q1 nach angezeigter Quote, wer nichts erreichen kann ("–") ans Ende',
  sortiert.map(s => s.username).join('') === 'edbca', sortiert.map(s => s.username + ':' + api.lbQuote(s)));
pruefe('Q2 13 % (1/8) und 13 % (2/15) stehen auf demselben Platz',
  JSON.stringify(api.lbPlaetze(sortiert.map(s => (api.lbQuote(s) === null ? -1 : api.lbQuote(s))))) === JSON.stringify([1, 2, 2, 4, 5]));

// --- HTML ------------------------------------------------------------------
const leute = Array.from({ length: 30 }, (_, i) => r('p' + i, 30 - i, 30));
leute[16].username = 'ich';
const h = api.ranglisteHtml(leute, { wert: s => s.pokale + '', balken: s => s.pokale, schluessel: s => s.pokale,
  ichName: 'ich', farbe: () => '#000' });
pruefe('H1 15 Zeilen, eine "⋯"-Luecke, am Ende "… und 11 weitere"',
  (h.match(/class="lb-row"/g) || []).length + (h.match(/lb-row lb-me"/g) || []).length === 15
  && (h.match(/lb-luecke/g) || []).length === 1 && h.includes('… und 11 weitere'), h.slice(-400));
pruefe('H2 die eigene Zeile ist markiert und heisst "Du", andere bleiben ohne Namen',
  h.includes('lb-row lb-me') && h.includes('<strong>Du</strong>') && !h.includes('p3'), '');
pruefe('H3 der eigene Platz stimmt (17.)', /lb-me">\s*<span class="lb-rank">17\.<\/span>/.test(h), h);
const kurz = api.ranglisteHtml(leute.slice(0, 8), { wert: () => '', balken: () => 0, schluessel: s => s.pokale,
  ichName: 'niemand', farbe: () => '#000' });
pruefe('H4 kurze Liste: keine Luecke, kein Rest-Hinweis', !kurz.includes('lb-luecke') && !kurz.includes('weitere'));

// --- Halbjahr (2026-10-05) ---------------------------------------------------
pruefe('J1 Halbjahr lesbar', api.hjText('2627_1') === '1. Halbjahr 2026/27' && api.hjText('2627_2') === '2. Halbjahr 2026/27');
pruefe('J2 Unbekanntes bleibt, wie es ist', api.hjText('xy') === 'xy' && api.hjText(null) === '' && api.hjText('') === '');
const faecher = [{ key: 'mathe', name: 'Mathe' }, { key: 'englisch', name: 'Englisch' }];
const gesamt = { earned: 40, max: 90, teile: [['📚', 'Mathe-Lerntheken', 30, 60]] };
let mf = api.meineFlammen({ pokale: 9, ownMax: 21, teile: { lerntheken: { earned: 4, max: 9 }, lzk: { earned: 2, max: 3 },
  talks: { mathe: { earned: 3, max: 9 } } } }, gesamt, faecher);
pruefe('J3 mit "ich": die Halbjahreszahlen, je Fach eine Talk-Zeile',
  mf.imHj && mf.earned === 9 && mf.max === 21 && JSON.stringify(mf.teile) === JSON.stringify([
    ['📚', 'Mathe-Lerntheken', 4, 9], ['🎓', 'LZK', 2, 3], ['🗣️', 'Mathe-Talks', 3, 9], ['🗣️', 'Englisch-Talks', 0, 0]]), mf);
mf = api.meineFlammen(null, gesamt, faecher);
pruefe('J4 ohne "ich" (aelterer Server): die Gesamtwerte wie bisher', !mf.imHj && mf.earned === 40 && mf.max === 90 && mf.teile === gesamt.teile, mf);
mf = api.meineFlammen({ pokale: 0, ownMax: 0, teile: {} }, gesamt, faecher);
pruefe('J5 lueckenhafte Teile: Nullen statt Absturz', mf.imHj && mf.teile.every(t => t[2] === 0 && t[3] === 0), mf);

// --- Verdrahtung -----------------------------------------------------------
pruefe('V1 beide Ranglisten nutzen die gekuerzte Darstellung',
  (html.match(/\$\{ranglisteHtml\(/g) || []).length === 2 && html.includes('ranglisteHtml(lbNachQuote(lbRows)'));
pruefe('V2 der alte Helfer ist weg', !html.includes('function renderLb('));
pruefe('V3 die Flammen-Rangliste misst am Spitzenwert des Halbjahres, nicht mehr am Gesamtmaximum',
  html.includes('s.pokale / lbSpitze') && !html.includes('lbGlobalMax'));
console.log('\n' + ok + ' Pruefungen bestanden.');
