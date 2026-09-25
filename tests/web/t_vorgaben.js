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

// --- 2: die Ueberschrift zeigt genau diese Werte --------------------------
{
  const FAECHER = { englisch: { key: 'englisch', name: 'Englisch',
    pflichtPraesentieren: 2, pflichtZuhoeren: 3,
    halbjahrTargets: { '2627_2': { pflichtPraesentieren: 1, pflichtZuhoeren: 4 } } } };
  const code = schneide('function subjTargetRaw(subj, hj, field) {')
             + html.slice(html.indexOf('function subjPflichtP'), html.indexOf('function subjOptionalP'))
             + html.slice(html.indexOf('  const hjLabel = (hj, nothingCount) =>'), html.indexOf('  // Ein Halbjahr gilt als "vergangen"'));
  const hjLabel = new Function('FAECHER', 'activeSubject', `
    const escHtml = t => String(t == null ? '' : t);
    const subjectByKey = k => FAECHER[k];
    const ovSubj = subjectByKey(activeSubject);
  ` + code + '\nreturn hjLabel;')(FAECHER, 'englisch');

  const a = hjLabel('2627_1', 0);
  pruefe('V4 die Ueberschrift nennt die eingestellte Vorgabe',
    a.includes('🎤 2× präsentieren') && a.includes('👂 3× zuhören'), a);
  pruefe('V4b und das Halbjahr selbst', a.includes('Halbjahr 2627_1'), a);
  const b = hjLabel('2627_2', 0);
  pruefe('V5 ein Halbjahr mit eigener Vorgabe zeigt seine eigene',
    b.includes('🎤 1× präsentieren') && b.includes('👂 4× zuhören'), b);
  pruefe('V6 "ohne Fortschritt" bleibt daneben erhalten',
    hjLabel('2627_1', 3).includes('3 ohne jeden Fortschritt'), '');
}

// --- 3: die feste Zeile ist weg -------------------------------------------
pruefe('V7 keine fest eingetragene Vorgabe mehr im Kopf',
  !html.includes('Pflicht je Halbjahr: 🎤 1x präsentieren'), '');
pruefe('V7b und ueberhaupt keine harte Soll-Zahl mehr in der Uebersicht',
  !/Pflicht je Halbjahr/.test(html), '');

// --- 4: die uebrigen Anzeigen lasen die Einstellung schon vorher ----------
for (const [n, s] of [['Schueler-Karte', 'function buildTalkingPickerSummaryHtml'],
                      ['Talks-Tab', 'function renderTalkingStudent'],
                      ['Admin-Uebersicht', 'function renderTalkingOverview']]) {
  const teil = schneide(s);
  pruefe('V8 ' + n + ' fragt die Einstellung ab',
    teil.includes('subjPflichtP(') && teil.includes('subjPflichtZ('), '');
}
console.log('\n' + ok + ' Pruefungen bestanden.');
