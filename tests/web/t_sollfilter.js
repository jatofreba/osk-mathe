// Prueft Suche und Statusfilter der Soll-Uebersicht.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };

// --- Die Filterfunktionen an einem nachgestellten DOM ---------------------
function machDom(zeilen, filter = 'alle', suchtext = '') {
  const trs = zeilen.map(([name, st]) => ({ dataset: { name, st }, hidden: false }));
  const tools = { dataset: { filter }, querySelectorAll: () => chips };
  const chips = ['alle', 'ok', 'arbeit', 'nichts'].map(w => {
    const c = { dataset: { w }, an: false };
    c.classList = { toggle: (_k, an) => { c.an = an; } };   // Merker landet am Knopf, nicht an classList
    return c;
  });
  const zahl = { textContent: '' }, leer = { hidden: false };
  const feld = { value: suchtext };
  const body = { querySelectorAll: () => trs };
  const doc = { getElementById: id =>
    id.startsWith('tov-tools') ? tools : id.startsWith('tov-body') ? body
    : id.startsWith('tov-such') ? feld : id.startsWith('tov-zahl') ? zahl
    : id.startsWith('tov-leer') ? leer : null };
  return { trs, tools, chips, zahl, leer, feld, doc };
}
const code = schneide('function talkOvSetzeFilter(hj, wert) {') + schneide('function talkOvFiltern(hj) {');
const lade = d => new Function('document', code + '\nreturn { talkOvSetzeFilter, talkOvFiltern };')(d.doc);

const LEUTE = [['alva', 'nichts'], ['angel', 'arbeit'], ['ben', 'ok'], ['ilayra', 'arbeit'], ['jarno', 'nichts']];
const sichtbar = d => d.trs.filter(t => !t.hidden).map(t => t.dataset.name);

// --- Suche ---------------------------------------------------------------
{
  const d = machDom(LEUTE, 'alle', 'an');
  lade(d).talkOvFiltern('2627_1');
  pruefe('F1 die Suche findet Namensteile', sichtbar(d).join(',') === 'angel', sichtbar(d));
  pruefe('F1b und meldet, wie viele uebrig sind', d.zahl.textContent === '1 von 5', d.zahl.textContent);
}
{
  const d = machDom(LEUTE, 'alle', '');
  lade(d).talkOvFiltern('2627_1');
  pruefe('F2 ohne Suche sind alle da', sichtbar(d).length === 5 && d.zahl.textContent === '5 Personen', d.zahl.textContent);
}
{
  const d = machDom(LEUTE, 'alle', 'ILA');
  lade(d).talkOvFiltern('2627_1');
  pruefe('F3 Gross-/Kleinschreibung ist egal', sichtbar(d).join(',') === 'ilayra', sichtbar(d));
}
{
  const d = machDom(LEUTE, 'alle', 'zzz');
  lade(d).talkOvFiltern('2627_1');
  pruefe('F4 passt niemand, sagt die Tabelle das', d.leer.hidden === false && sichtbar(d).length === 0);
  const d2 = machDom(LEUTE, 'alle', '');
  lade(d2).talkOvFiltern('2627_1');
  pruefe('F4b sonst bleibt der Hinweis verborgen', d2.leer.hidden === true);
}

// --- Statusfilter ---------------------------------------------------------
for (const [f, erwartet] of [['ok', 'ben'], ['arbeit', 'angel,ilayra'], ['nichts', 'alva,jarno']]) {
  const d = machDom(LEUTE, f, '');
  lade(d).talkOvFiltern('2627_1');
  pruefe(`F5 Filter "${f}" zeigt genau die richtigen`, sichtbar(d).join(',') === erwartet, sichtbar(d));
}
{
  const d = machDom(LEUTE, 'nichts', 'al');
  lade(d).talkOvFiltern('2627_1');
  pruefe('F6 Suche und Filter wirken zusammen', sichtbar(d).join(',') === 'alva', sichtbar(d));
}

// --- Knopf-Umschaltung ----------------------------------------------------
{
  const d = machDom(LEUTE, 'alle', '');
  const f = lade(d);
  f.talkOvSetzeFilter('2627_1', 'ok');
  pruefe('F7 ein Klick setzt den Filter', d.tools.dataset.filter === 'ok' && sichtbar(d).join(',') === 'ben');
  pruefe('F7b und hebt genau einen Knopf hervor',
    d.chips.filter(c => c.an).map(c => c.dataset.w).join(',') === 'ok');
  f.talkOvSetzeFilter('2627_1', 'ok');
  pruefe('F8 nochmal derselbe Knopf hebt den Filter auf',
    d.tools.dataset.filter === 'alle' && sichtbar(d).length === 5);
  f.talkOvSetzeFilter('2627_1', 'alle');
  pruefe('F8b "Alle" bleibt "Alle", auch zweimal geklickt', d.tools.dataset.filter === 'alle');
}

// --- Verdrahtung im Markup ------------------------------------------------
{
  const teil = schneide('function renderTalkingOverview(slots, roster) {');
  pruefe('V1 jede Zeile traegt Name und Status zum Filtern',
    teil.includes('data-name="${escHtml(stu.username.toLowerCase())}" data-st="${st}"'), '');
  pruefe('V2 die Knoepfe zeigen die Anzahl je Status',
    teil.includes("knopf('ok', '✅ Soll komplett', z.ok)") && teil.includes('zaehler[st]++'), '');
  pruefe('V3 jedes Halbjahr hat eine eigene Leiste (eigene Vorgaben!)',
    teil.includes('id="tov-tools-${hj}"') && teil.includes('id="tov-body-${hj}"'), '');
  pruefe('V4 auch laufende Halbjahre sind aufklappbar',
    (teil.match(/<details class="hj-rubrik"/g) || []).length === 2 && teil.includes('hj-rubrik" open'), '');
  pruefe('V5 die Suche zeichnet nicht neu (Fokus bleibt im Feld)',
    teil.includes('oninput="talkOvFiltern(') && !teil.includes('oninput="renderTalking'), '');
  pruefe('V6 ausgeblendete Zeilen verschwinden auch wirklich',
    html.includes('.tov-table tr[hidden]{display:none;}'), '');
}
console.log('\n' + ok + ' Pruefungen bestanden.');
