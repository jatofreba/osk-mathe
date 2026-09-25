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
const legEnde = html.indexOf('Termin antippen, um Anfragen und Teilnahmen einzutragen.');
const legende = html.slice(html.lastIndexOf('<div class="mw-legend">', legEnde), legEnde);
pruefe('L1 die Legende erklaert ❓', legende.includes('❓ wartet auf DEINE Antwort'), legende);
pruefe('L2 und ⏳ mit dem Unterschied dazu',
  legende.includes('⏳ wartet auf die Antwort der Schüler:in'), legende);
pruefe('L3 und 📋', legende.includes('📋 von dir eingeladen'), legende);
pruefe('L4 und dass kein Zeichen "erledigt" heisst',
  legende.includes('ohne Zeichen = alles erledigt'), legende);
pruefe('L5 und die Zahl bei vielen Personen', legende.includes('👥'), legende);
pruefe('L6 die veralteten Eintraege sind raus (die Zeichen gibt es nicht mehr)',
  !legende.includes('✓ zugesagt') && !legende.includes('📋✓'), legende);

// Jedes Zeichen, das awChip vergeben kann, muss in der Legende stehen
const chip = html.slice(html.indexOf('icon: !offen ?'), html.indexOf('titel: angefragt ?'));
for (const z of (chip.match(/'(❓|⏳|📋)'/g) || []).map(x => x.slice(1, -1)))
  pruefe('L7 Zeichen ' + z + ' ist erklaert', legende.includes(z));
console.log('\n' + ok + ' Pruefungen bestanden.');
