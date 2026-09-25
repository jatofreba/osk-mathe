// Funktionsnamen sind in dieser einen grossen Datei global - gleiche Namen
// ueberschreiben sich still (die LETZTE Deklaration gewinnt). Genau so blieb der
// Kalender der Lernbegleitung einmal leer (calMeinTermin gab es zweimal).
// Seit be0c958 heissen die beiden Fragen verschieden:
//   calImKalenderZeigen(s) - WAS steht im Kalender
//   calGehoertMir(it)      - gehoert der Termin mir persoenlich
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');

let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); if (a < 0) throw new Error('nicht gefunden: ' + k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };

// --- 1) Kein Funktionsname ist doppelt vergeben --------------------------
{
  const namen = [...html.matchAll(/^(?:async )?function ([A-Za-z0-9_$]+)\s*\(/gm)].map(m => m[1]);
  const doppelt = [...new Set(namen.filter((n, i) => namen.indexOf(n) !== i))];
  pruefe('D1 kein Funktionsname ist doppelt vergeben', doppelt.length === 0, doppelt.join(', '));
  pruefe('D1b calMeinTermin gibt es nicht mehr', !/function calMeinTermin\s*\(/.test(html), '');
}

// --- 2) Was im Kalender steht: rollenbewusst ----------------------------
{
  const mach = rolle => new Function('me',
    schneide('function calImKalenderZeigen(s) {') + '\nreturn calImKalenderZeigen;')(rolle);

  const LB = mach({ role: 'admin', userId: 7, defaultSubjectId: 1 });
  pruefe('D2 die Lernbegleitung sieht ihre eigenen Termine', LB({ teacherId: 7, subjectId: 9 }) === true, '');
  pruefe('D2b auch die noch niemandem zugeordneten', LB({ teacherId: null, subjectId: 9 }) === true, '');
  pruefe('D2c und alles aus ihrem Standard-Fach', LB({ teacherId: 99, subjectId: 1 }) === true, '');
  pruefe('D2d fremde Termine eines fremden Fachs aber nicht', LB({ teacherId: 99, subjectId: 9 }) === false, '');

  const S = mach({ role: 'student', userId: 3 });
  pruefe('D3 Schueler:innen sehen ihre gebuchten Termine', S({ mineAsPresenter: true }) === true, '');
  pruefe('D3b und die, zu denen sie eingeladen oder angefragt sind', S({ mineAsListener: true }) === true, '');
  pruefe('D3c fremde nicht', S({ teacherId: 7, subjectId: 1 }) === false, '');
}

// --- 3) Gehoert mir: nur die eigene Beteiligung --------------------------
{
  const mir = new Function(schneide('function calGehoertMir(it) {') + '\nreturn calGehoertMir;')();
  pruefe('D4 eigener Vortrag gehoert mir', mir({ mineAsPresenter: true }) === true, '');
  pruefe('D4b eigene Einladung/Anfrage auch', mir({ mineAsListener: true }) === true, '');
  pruefe('D4c ein Termin der Lernbegleitung gehoert ihr NICHT persoenlich',
    mir({ teacherId: 7 }) === false, '');
}

// --- 4) Die richtigen Aufrufer -------------------------------------------
{
  pruefe('D5 calItemsByDay filtert mit calImKalenderZeigen',
    schneide('function calItemsByDay() {').includes('.filter(calImKalenderZeigen)'), '');
  pruefe('D5b das Tagesdetail fragt calGehoertMir',
    html.includes("!actions.includes('<button') && !calGehoertMir(it)"), '');
}

console.log('\n' + ok + ' Pruefungen bestanden.');
