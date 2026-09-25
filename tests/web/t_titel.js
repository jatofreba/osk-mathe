// Prueft den Titel "OSKlar" an allen Stellen.
// Hinweis: der Login-Kopf ist inzwischen eine Bildmarke (zweite Session), der
// Schriftzug mit hervorgehobenem OSK steht nur noch in der Kopfzeile nach dem Login.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
const tag = lies('public/tag.html');
let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };

pruefe('T1 der Browser-Tab heisst OSKlar',
  html.includes('<title>OSKlar – Deine Termine im Überblick</title>'), '');
pruefe('T2 die Kopfzeile auch', html.includes('<strong>OSK</strong>lar'), '');
pruefe('T2b mit dem Untertitel daneben',
  html.includes('Deine Termine im Überblick</span>'), '');
pruefe('T3 der Login-Kopf traegt die Bildmarke mit demselben Namen',
  html.includes('src="/img/osklar-logo.png"')
  && html.includes('alt="OSKlar – Deine Termine im Überblick"'), '');
pruefe('T4 der alte Untertitel "Mittelstufe" ist weg', !html.includes('>Mittelstufe<'), '');
pruefe('T5 der alte Titel kommt nirgends mehr vor',
  !/Organisieren\s*<\/strong>|>Organisieren|Organisieren Selbst/.test(html), '');
pruefe('T6 OSK bleibt im Schriftzug als Acronym hervorgehoben',
  (html.match(/<strong>OSK<\/strong>lar/g) || []).length === 1, '');
pruefe('T7 der Untertitel tritt auf schmalen Schirmen zurueck',
  html.includes('@media(max-width:700px){.topbar-claim{display:none;}}'), '');
pruefe('T8 die Link-Vorschau der oeffentlichen Tagesseite heisst auch so',
  tag.includes('content="OSKlar"') && !tag.includes('OSK Mathe'), '');

console.log('\n' + ok + ' Pruefungen bestanden.');
