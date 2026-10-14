// Prueft, dass die angezeigte Pflicht-Vorgabe der eingestellten folgt -
// je Fach UND je Halbjahr.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };

// --- 1: die Helfer lesen die Einstellung ----------------------------------
{
  const code = schneide('function subjTargetRaw(subj, hj, field) {')
             + html.slice(html.indexOf('function subjPflichtP'), html.indexOf('function subjOptionalP'));
  const f = new Function(code + '\nreturn { subjPflichtP, subjPflichtZ };')();
  const englisch = { key: 'englisch', pflichtPraesentieren: 2, pflichtZuhoeren: 3,
    halbjahrTargets: { '2627_2': { pflichtPraesentieren: 1, pflichtZuhoeren: 4 } } };

  pruefe('V1 der Fach-Standard zaehlt (Englisch: 2x praesentieren, 3x zuhoeren)',
    f.subjPflichtP(englisch, '2627_1') === 2 && f.subjPflichtZ(englisch, '2627_1') === 3);
  pruefe('V2 eine Halbjahr-Abweichung sticht den Standard',
    f.subjPflichtP(englisch, '2627_2') === 1 && f.subjPflichtZ(englisch, '2627_2') === 4);
  pruefe('V3 ohne jede Einstellung greift der alte Vorgabewert 1/2',
    f.subjPflichtP({}, '2627_1') === 1 && f.subjPflichtZ({}, '2627_1') === 2);
}

// --- 2: (V4-V6) pruefte die Halbjahr-Ueberschrift der Soll-Uebersicht im Talks-Reiter - die
// Uebersicht flog 2026-10-14 raus (steht in der Halbjahr-Uebersicht).

// --- 3: die feste Zeile ist weg -------------------------------------------
pruefe('V7 keine fest eingetragene Vorgabe mehr im Kopf',
  !html.includes('Pflicht je Halbjahr: 🎤 1x präsentieren'), '');
pruefe('V7b und ueberhaupt keine harte Soll-Zahl mehr in der Uebersicht',
  !/Pflicht je Halbjahr/.test(html), '');

// --- 4: die uebrigen Anzeigen lasen die Einstellung schon vorher ----------
// Die Admin-Uebersicht (renderTalkingOverview) gibt es seit 2026-10-14 nicht mehr.
for (const [n, s] of [['Schueler-Karte', 'function buildTalkingPickerSummaryHtml'],
                      ['Talks-Tab', 'function renderTalkingStudent']]) {
  const teil = schneide(s);
  pruefe('V8 ' + n + ' fragt die Einstellung ab',
    teil.includes('subjPflichtP(') && teil.includes('subjPflichtZ('), '');
}
console.log('\n' + ok + ' Pruefungen bestanden.');
