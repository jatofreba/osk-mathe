// Prueft das Sortieren der Halbjahr-Tabellen.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };

// --- Umschalt-Logik ---------------------------------------------------------
{
  const code = schneide('function hjSortieren(spalte) {');
  const f = new Function('let hjSort = null, hjSortAb = false; const renderHalbjahr = () => {};'
    + code + '\nreturn (sp) => { hjSortieren(sp); return [hjSort, hjSortAb]; };')();
  let z = f('fabue');
  pruefe('S1 erster Klick sortiert aufsteigend (Nullen oben)', z[0] === 'fabue' && z[1] === false, z);
  z = f('fabue');
  pruefe('S2 zweiter Klick dreht um', z[0] === 'fabue' && z[1] === true, z);
  z = f('fabue');
  pruefe('S3 dritter Klick stellt die Standardreihenfolge her', z[0] === null && z[1] === false, z);
  f('name'); z = f('lzk');
  pruefe('S4 andere Spalte faengt wieder aufsteigend an', z[0] === 'lzk' && z[1] === false, z);
}

// --- Sortierwerte + Reihenfolge --------------------------------------------
{
  const rh = schneide('function renderHalbjahr() {');
  // Die LZK-Helfer stehen vor sortWert und gehoeren mit in den Schnitt.
  const a = rh.indexOf('  const lzkDesFachs =');
  const wertCode = rh.slice(a, rh.indexOf('  const isSubjNothing =', a))
    + rh.slice(rh.indexOf('  const sortWert =', a), rh.indexOf('  const sections =', a));
  const f = new Function('bucketOf', 'emptySubj', wertCode + '\nreturn sortWert;')(
    s => s.b, { talksPresented: 0, talksListened: 0, inputParticipated: 0 });
  const mathe = { key: 'mathe' };
  const s = (name, z) => ({ username: name, b: { bySubject: { mathe: z.sd || {} },
    lzk: z.lzk || [], stationsCompleted: z.st || 0 } });

  pruefe('W1 Name klein geschrieben (damit A und a zusammen sortieren)',
    f(s('Alva', {}), mathe, 'name') === 'alva');
  pruefe('W2 gehalten', f(s('x', { sd: { talksPresented: 3 } }), mathe, 'gehalten') === 3);
  pruefe('W3 zugehoert', f(s('x', { sd: { talksListened: 2 } }), mathe, 'zugehoert') === 2);
  pruefe('W4 FaBü zaehlt die bestaetigten Teilnahmen',
    f(s('x', { sd: { inputParticipated: 4, inputOpen: 9 } }), mathe, 'fabue') === 4);
  pruefe('W5 LZK zaehlt nur die bestandenen',
    f(s('x', { lzk: [{ status: 'bestanden' }, { status: 'nicht_bestanden' }] }), mathe, 'lzk') === 1);
  pruefe('W6 Stationen', f(s('x', { st: 7 }), mathe, 'stationen') === 7);
  pruefe('W7 fehlende Werte sind 0, nicht undefined',
    f(s('x', {}), mathe, 'gehalten') === 0 && f(s('x', {}), mathe, 'fabue') === 0);

  // Reihenfolge nachstellen
  const sortiere = (leute, spalte, ab) => [...leute].sort((p, q) => {
    const va = f(p, mathe, spalte), vb = f(q, mathe, spalte);
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return (ab ? -cmp : cmp) || p.username.toLowerCase().localeCompare(q.username.toLowerCase());
  });
  const leute = [s('carl', { sd: { inputParticipated: 2 } }), s('alva', {}), s('berta', { sd: { inputParticipated: 2 } })];
  pruefe('R1 aufsteigend: wer nichts hat, steht oben',
    sortiere(leute, 'fabue', false).map(p => p.username).join(',') === 'alva,berta,carl');
  pruefe('R2 absteigend dreht um',
    sortiere(leute, 'fabue', true).map(p => p.username).join(',') === 'berta,carl,alva');
  pruefe('R3 bei Gleichstand alphabetisch - sonst springen die Zeilen',
    sortiere(leute, 'fabue', false).slice(1).map(p => p.username).join(',') === 'berta,carl');
}

// --- Verdrahtung ------------------------------------------------------------
{
  const rh = schneide('function renderHalbjahr() {');
  pruefe('V1 alle sechs Spalten sind anklickbar',
    ["th('name'", "th('gehalten'", "th('zugehoert'", "th('fabue'", "th('lzk'", "th('stationen'"]
      .every(t => rh.includes(t)), '');
  pruefe('V2 der Pfeil zeigt Richtung und Spalte',
    rh.includes("hjSort === spalte ? (hjSortAb ? ' ▾' : ' ▴') : ''"), '');
  pruefe('V3 ohne Sortierung bleibt die Reihenfolge des Servers',
    rh.includes('!hjSort ? personen :'), '');
  pruefe('V4 sortiert wird auf einer Kopie, nicht im Original',
    rh.includes('[...personen].sort('), '');
  pruefe('V5 jeder Fach-Abschnitt sortiert nach seinen eigenen Zahlen',
    rh.includes('sortWert(a, subj, hjSort)'), '');
  pruefe('V6 der Hinweistext erklaert das Sortieren',
    rh.includes('Spaltenkopf anklicken sortiert'), '');
  pruefe('V7 die Zeile bleibt anklickbar (Details)', rh.includes('onclick="openHjDetail('));
}
console.log('\n' + ok + ' Pruefungen bestanden.');
