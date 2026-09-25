// Prueft das Sortieren der Soll-Uebersicht und den eigenen Rollbereich.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };

function machDom(leute) {
  const trs = leute.map(([name, p, z, rang]) => ({ dataset: { name, p: String(p), z: String(z), rang: String(rang) } }));
  const reihenfolge = [...trs];
  const tools = { dataset: {} };
  const pfeile = {};
  const body = {
    querySelectorAll: () => reihenfolge.slice(),
    appendChild: tr => { const i = reihenfolge.indexOf(tr); if (i > -1) reihenfolge.splice(i, 1); reihenfolge.push(tr); },
  };
  const doc = { getElementById: id =>
    id.startsWith('tov-tools') ? tools
    : id.startsWith('tov-body') ? body
    : id.startsWith('tov-pf-') ? (pfeile[id] = pfeile[id] || { textContent: '' })
    : null };
  return { trs, reihenfolge, tools, pfeile, doc };
}
const code = schneide('function talkOvSortieren(hj, spalte) {');
const lade = d => new Function('document', code + '\nreturn talkOvSortieren;')(d.doc);
const namen = d => d.reihenfolge.map(t => t.dataset.name).join(',');

// name, praesentiert, zugehoert, rang(0=nichts,1=arbeit,2=ok)
const LEUTE = [['carl', 0, 0, 0], ['alva', 2, 3, 2], ['ben', 1, 0, 1], ['dora', 0, 2, 1]];

{
  const d = machDom(LEUTE); const f = lade(d);
  f('2627_1', 'p');
  pruefe('S1 nach Praesentieren aufsteigend: wer nichts hat, steht oben',
    namen(d) === 'carl,dora,ben,alva', namen(d));
  pruefe('S1b bei Gleichstand alphabetisch (carl vor dora, beide 0)',
    namen(d).startsWith('carl,dora'), namen(d));
  f('2627_1', 'p');
  pruefe('S2 zweiter Klick dreht um', namen(d) === 'alva,ben,carl,dora', namen(d));
  f('2627_1', 'p');
  pruefe('S3 dritter Klick zurueck auf alphabetisch',
    namen(d) === 'alva,ben,carl,dora' && !d.tools.dataset.sort, namen(d));
}
{
  const d = machDom(LEUTE); const f = lade(d);
  f('2627_1', 'z');
  pruefe('S4 nach Zuhoeren aufsteigend', namen(d) === 'ben,carl,dora,alva', namen(d));
}
{
  const d = machDom(LEUTE); const f = lade(d);
  f('2627_1', 'st');
  pruefe('S5 nach Status: nichts los zuerst, Soll komplett zuletzt',
    namen(d) === 'carl,ben,dora,alva', namen(d));
}
{
  const d = machDom(LEUTE); const f = lade(d);
  f('2627_1', 'name');
  pruefe('S6 nach Name alphabetisch', namen(d) === 'alva,ben,carl,dora', namen(d));
  f('2627_1', 'name');
  pruefe('S6b und rueckwaerts', namen(d) === 'dora,carl,ben,alva', namen(d));
}
{
  const d = machDom(LEUTE); const f = lade(d);
  f('2627_1', 'z');
  pruefe('S7 der Pfeil zeigt die Spalte und die Richtung',
    d.pfeile['tov-pf-2627_1-z'].textContent === ' ▴'
    && d.pfeile['tov-pf-2627_1-name'].textContent === '', JSON.stringify(d.pfeile));
  f('2627_1', 'z');
  pruefe('S7b umgedreht auch', d.pfeile['tov-pf-2627_1-z'].textContent === ' ▾');
  f('2627_1', 'st');
  pruefe('S7c und wandert bei einer anderen Spalte mit',
    d.pfeile['tov-pf-2627_1-z'].textContent === '' && d.pfeile['tov-pf-2627_1-st'].textContent === ' ▴');
}

// --- Verdrahtung + Rollbereich --------------------------------------------
{
  const teil = schneide('function renderTalkingOverview(slots, roster) {');
  pruefe('V1 alle vier Spalten sind anklickbar',
    ["kopf(hj, 'name'", "kopf(hj, 'p'", "kopf(hj, 'z'", "kopf(hj, 'st'"].every(t => teil.includes(t)), '');
  pruefe('V2 die Zeilen tragen die Werte zum Sortieren',
    teil.includes('data-p="${d.presentDone}" data-z="${d.listenDone}" data-rang="${rang}"'), '');
  pruefe('V3 sortiert wird im DOM - Suche und Filter bleiben erhalten',
    schneide('function talkOvSortieren(hj, spalte) {').includes('body.appendChild(tr)'), '');
  pruefe('V4 die Tabelle hat einen eigenen Rollbereich',
    html.includes('.tov-table{max-height:46vh;overflow-y:auto;}'), '');
  pruefe('V4b mit stehender Kopfzeile',
    html.includes('.tov-table thead th{position:sticky;top:0;'), '');
}
console.log('\n' + ok + ' Pruefungen bestanden.');
