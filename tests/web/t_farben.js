// Prueft: die Fachfarbe bleibt im Monatsraster erhalten, und die Legende erklaert
// genau die Zeichen, die auch vorkommen.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };

const raster = html.slice(html.indexOf('const zustand = calSlotState(it)'), html.indexOf('const more = rest.length > platz'));

pruefe('F1 gebuchte Termine behalten fuer die Lernbegleitung die Fachfarbe',
  /closed: isAdminView\s*\?\s*`background:\$\{subj\.colorBg\};color:\$\{subj\.color\}/.test(raster), raster);
pruefe('F1b fuer Schueler:innen bleibt "ausgebucht" neutralgrau',
  raster.includes("'background:#eef1f5;color:#64748b;border-color:#cbd5e1;'"), raster);
pruefe('F2 alle vier Zustaende tragen die Fachfarbe oder sind bewusst neutral',
  ['mine:', 'join:', 'free:', 'closed:'].every(z => raster.includes(z)));
pruefe('F3 das Piktogramm erbt die Farbe (SVG statt Emoji)',
  raster.includes('${lwIcon(it.typ)}') && !raster.includes("'📘'"), raster);

const detail = html.slice(html.indexOf('const rows = items.map(it => {'), html.indexOf('const typLabel = subj.nurZugewiesen'));
pruefe('F4 auch im Tagesdetail traegt der Kopf die Fachfarbe',
  detail.includes('color:${subj.color};">${lwIcon(it.typ)}'), detail.slice(-300));

// Legende
// Genau die Legende der ADMIN-Wochenansicht schneiden - es gibt zwei mw-legend-Bloecke.
const legEnde = html.indexOf('Termin antippen zeigt alle Namen');
const legende = html.slice(html.lastIndexOf('<div class="mw-legend">', legEnde), legEnde);
// Seit 2026-10-04 gibt es beim Fachbuero nichts mehr zu bestaetigen und keine Mitmach-Anfragen.
pruefe('L1 ❓ ist raus - Anfragen, die auf DICH warten, gibt es nicht mehr',
  legEnde > 0 && !legende.includes('❓') && !legende.includes('wartet auf DEINE Antwort'), legende);
pruefe('L2 ⏳ gibt es nur noch beim Talk',
  legende.includes('⏳ Talk: wartet auf die Antwort der Schüler:in'), legende);
pruefe('L3 und 📋', legende.includes('📋 von dir eingeladen'), legende);
pruefe('L4 kein Zeichen heisst "dabei" - beim FaBü ab dem Termintag teilgenommen',
  legende.includes('ohne Zeichen = ist dabei') && legende.includes('ab dem Termintag als teilgenommen')
  && !legende.includes('alles erledigt'), legende);
pruefe('L4b ✗ = hat unentschuldigt gefehlt, rot wie an der Kachel',
  legende.includes('<span class="aw-person-fehlt">✗</span> hat unentschuldigt gefehlt'), legende);
pruefe('L5 und die Zahl bei vielen Personen', legende.includes('👥'), legende);
pruefe('L6 die veralteten Eintraege sind raus (die Zeichen gibt es nicht mehr)',
  !legende.includes('✓ zugesagt') && !legende.includes('📋✓'), legende);
pruefe('L6b der Hinweis zum Antippen spricht nicht mehr von Anfragen',
  html.includes('Termin antippen zeigt alle Namen – beim FaBü trägst du dort Leute ein und aus und vermerkst ab dem Termintag, wer unentschuldigt gefehlt hat.')
  && !html.includes('Termin antippen, um Anfragen und Teilnahmen einzutragen.'), '');

// Jedes Zeichen, das awChip vergeben kann, muss in der Legende stehen
const chipA = html.indexOf('function awChip(s) {');
const chip = html.slice(chipA, html.indexOf('const personenHtml = awPersonenHtml(leute);', chipA));
const zeichen = [...new Set((chip.match(/'(❓|⏳|📋|✗)'/g) || []).map(x => x.slice(1, -1)))];
pruefe('L7 awChip vergibt genau ✗, ⏳ und 📋 (kein ❓ mehr)',
  chipA > 0 && JSON.stringify([...zeichen].sort()) === JSON.stringify(['⏳', '✗', '📋'].sort()), zeichen);
for (const z of zeichen)
  pruefe('L7 Zeichen ' + z + ' ist erklaert', legende.includes(z));

// Halbjahr-Uebersicht: die Zeichen in den Fachbuero-Zellen sind erklaert
pruefe('L8 Halbjahr: Zahl = teilgenommen, ✗ = unentschuldigt gefehlt, 📅 = steht noch an',
  html.includes('📘 FaBü bzw. ✓ Teilgenommen: Zahl = teilgenommen (wer eingetragen war), ✗ = unentschuldigt gefehlt, 📅 = steht noch an.'), '');
console.log('\n' + ok + ' Pruefungen bestanden.');
