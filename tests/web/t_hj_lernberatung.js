// Prueft die Halbjahr-Uebersicht fuer die Lernberatung: keine Talks, kein Fachbuero -
// nur "teilgenommen", und nur die Eingeteilten.
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); if (a < 0) throw new Error('nicht gefunden: ' + k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };

const HJ = '2627_1';
const SUBJ = [{ key: 'mathe', id: 1, name: 'Mathe', color: '#2563eb' },
  { key: 'lb', id: 4, name: 'Lernberatung', color: '#7c3aed', nurZugewiesen: true }];
const bau = (studenten, zaehlt = true) => {
  const el = { innerHTML: '' };
  const f = new Function('hjData', 'el', 'ZAEHLT', `
    const escHtml = x => String(x == null ? '' : x); const hjFmtDate = d => d; const hjLtTitle = x => x;
    const hjNurEigene = () => false; const orderedSubjects = () => SUBJ_; const hjCountsForUser = () => ZAEHLT;
    let hjSort = null, hjSortAb = false; const hjSelected = '${HJ}';
    const document = { getElementById: () => el };
    const SUBJ_ = ${JSON.stringify(SUBJ)};
    ${schneide('function renderHalbjahr() {')}
    ${schneide('function hjDetailHtml(s, subjectKey) {')}
    return { renderHalbjahr, hjDetailHtml };`);
  return { api: f({ students: studenten }, el, zaehlt), el };
};
const person = (id, name, lb) => ({ id, username: name,
  byHalbjahr: { [HJ]: { lzk: [], stationDetails: [], stationsCompleted: 0, bySubject: lb ? { lb } : {} } } });

const ada = person(1, 'Ada', { inputParticipated: 2, inputMissed: 1,
  inputDetails: [{ thema: 'Ziele', status: 'erledigt', datum: '2026-09-01', presenter: 'Frau X' }] });
const bo = person(2, 'Bo', null);

{
  const w = bau([ada, bo]);
  w.api.renderHalbjahr();
  const [mathe, lb] = w.el.innerHTML.split('Lernberatung');
  pruefe('L1 Lernberatung: nur Name und "Teilgenommen"', lb.includes('✓ Teilgenommen') && !lb.includes('Gehalten') && !lb.includes('FaBü'), lb);
  pruefe('L2 nur, wer eingeteilt war', lb.includes('Ada') && !lb.includes('>Bo<'), lb);
  pruefe('L3 gefehlt steht dabei', lb.includes('✗1'), lb);
  pruefe('L4 Mathe bleibt wie bisher', mathe.includes('🎤 Gehalten') && mathe.includes('📘 FaBü') && mathe.includes('Bo'), mathe);
  const d = w.api.hjDetailHtml(ada, 'lb');
  pruefe('L5 Detail: nur die Rubrik Teilnahmen', d.includes('✓ Teilnahmen') && d.includes('✓ teilgenommen') && !d.includes('Talks') && !d.includes('FaBü'), d);
  pruefe('L6 eigene Uebersicht: Lernberatung nur, wenn man eingeteilt war',
    !w.api.hjDetailHtml(bo, null).includes('Lernberatung') && w.api.hjDetailHtml(ada, null).includes('Lernberatung'));
}
{
  // Niemand zaehlt fuer das Halbjahr (z.B. alle erst spaeter angelegt): bei der Lernberatung
  // ein Hinweis - bei den anderen Faechern NICHT (dort hiess es vorher faelschlich
  // "Niemand war in diesem Halbjahr eingeteilt").
  const w = bau([ada, bo], false);
  w.api.renderHalbjahr();
  const [mathe, lb] = w.el.innerHTML.split('Lernberatung');
  pruefe('L7 Lernberatung ohne Eingeteilte: Hinweis', lb.includes('Niemand war in diesem Halbjahr eingeteilt'), lb);
  pruefe('L8 Mathe zeigt ihn nicht', !mathe.includes('Niemand war'), mathe);
}
{
  const w = bau([]);
  w.api.renderHalbjahr();
  pruefe('L9 ganz ohne Personen: der Hinweis steht nur einmal (Lernberatung)',
    (w.el.innerHTML.match(/Niemand war/g) || []).length <= 1, w.el.innerHTML);
}
console.log('\n' + ok + ' Pruefungen bestanden.');
