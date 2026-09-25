// Freie LZK (lerntheke NULL, seit c7e5b18 auch Basis/Aufbau) duerfen in der Lerntheken-Uebersicht
// nie als verwaiste Lerntheken-LZK gelten: nicht kopieren, nicht in der Zelle zeigen, nicht vorbelegen.
// Und das Ansehen der Uebersicht schreibt ueberhaupt nichts mehr (autoMigrateLzk ist entfernt).
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => {
  if (!b) { console.error('FAIL: ' + n + (e !== undefined ? '\n      ' + JSON.stringify(e) : '')); process.exit(1); }
  ok++; console.log('OK  ' + n);
};
const schneide = kopf => { const a = html.indexOf(kopf); if (a < 0) throw new Error('fehlt: ' + kopf); return html.slice(a, html.indexOf('\n}\n', a) + 2); };
const escHtml = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ltMeta = [{ key: 'lerntheke_kreise_v11', groups: { Basis: 1, Aufbau: 1 } }, { key: 'lerntheke_lf_v1', groups: { Basis: 1, Aufbau: 1 } }];
const KREISE = ltMeta[0];
const frei = (extra = {}) => ({ id: 501, typ: 'Basis', lerntheke: null, datum: '2026-09-30', status: 'ausstehend', pokale: 0, thema: 'Kreise', fach: 'mathe', anfrage: null, ...extra });
const verwaist = (extra = {}) => ({ id: 9, typ: 'Basis', lerntheke: 'lerntheke_kreise_v3', datum: '2025-05-02', status: 'bestanden', pokale: 2, ...extra });
const andereLt = (extra = {}) => ({ id: 11, typ: 'Basis', lerntheke: 'lerntheke_lf_v1', datum: '2026-10-07', status: 'ausstehend', pokale: 0, ...extra });

(async () => {
  // ── 1) Ansehen schreibt nie ─────────────────────────────────────────────────
  // Frueher legte autoMigrateLzk() bei jedem Laden (alle 30 s) LZK an - und kopierte so
  // auch freie LZK als Lerntheken-LZK (Fehler bis 7ba7a50). Die Funktion ist entfernt.
  pruefe('M1 autoMigrateLzk gibt es nicht mehr', !/function autoMigrateLzk/.test(html) && !/autoMigrateLzk\(all/.test(html));
  const laden = schneide('async function loadStudents() {');
  pruefe('M2 das Laden der Lerntheken-Uebersicht schreibt nichts (nur GET)',
    !/method\s*:\s*['"](POST|PATCH|PUT|DELETE)/i.test(laden) && laden.includes("fetch('/api/admin/students')"), laden.slice(0, 200));
  pruefe('M3 und laedt nach dem Laden nicht noch einmal nach (das gab es nur fuer die Migration)',
    (laden.match(/fetch\('\/api\/admin\/students'\)/g) || []).length === 1, '');

  // ── 2) Die Zelle der Lerntheken-Tabelle ────────────────────────────────────
  const zelle = new Function('ltMeta', 'escHtml', schneide('function lzkCellHtml(studentLzk, s, lt) {') + '\nreturn lzkCellHtml;')(ltMeta, escHtml);
  const s = { id: 7, username: 'ga.em' };
  let z = zelle([frei()], s, KREISE);
  pruefe('C1 eine freie LZK erscheint nicht in der Lerntheken-Zelle', !z.includes('30.09') && !z.includes('⚠') && z.includes('+ Eintragen'), z);
  z = zelle([verwaist()], s, KREISE);
  pruefe('C2 ein Altfall erscheint weiter, mit Warnzeichen', z.includes('⚠') && z.includes('02.05'), z);

  // ── 3) Der Bearbeiten-Dialog ───────────────────────────────────────────────
  const el = {};
  const document = {
    getElementById: id => (el[id] = el[id] || { value: '', textContent: '', classList: { toggle() {} }, dataset: {} }),
    querySelectorAll: () => [],
  };
  let offen = null;
  const oeffne = (studenten) => {
    for (const k of Object.keys(el)) delete el[k];
    const f = new Function('document', 'allStudents', 'ltMeta', 'openModal',
      'let _lzkModal = {};\n' + schneide('function openLzkModal(userId, username, lerntheke, typ) {') + '\nreturn [openLzkModal, () => _lzkModal];')(
      document, studenten, ltMeta, id => { offen = id; });
    return f;
  };
  let [dlg, zustand] = oeffne([{ id: 7, lzk: [frei({ anfrage: 'offen' })] }]);
  dlg(7, 'ga.em', 'lerntheke_kreise_v11', 'Basis');
  pruefe('O1 nur eine freie LZK da: der Dialog bleibt leer (keine Kopie beim Speichern)',
    offen === 'modal-lzk' && el['lzk-modal-datum'].value === '' && zustand().id === null, zustand());
  pruefe('O1b und eine freie ANFRAGE wird hier nicht angenommen', zustand().anfrage === null, zustand());
  [dlg, zustand] = oeffne([{ id: 7, lzk: [andereLt()] }]);
  dlg(7, 'ga.em', 'lerntheke_kreise_v11', 'Basis');
  pruefe('O2 die LZK einer anderen Lerntheke wird nicht vorbelegt', el['lzk-modal-datum'].value === '' && zustand().id === null, zustand());
  [dlg, zustand] = oeffne([{ id: 7, lzk: [verwaist()] }]);
  dlg(7, 'ga.em', 'lerntheke_kreise_v11', 'Basis');
  pruefe('O3 ein Altfall wird weiter vorbelegt (Bearbeiten korrigiert ihn)', el['lzk-modal-datum'].value === '2025-05-02' && zustand().id === 9, zustand());
  [dlg, zustand] = oeffne([{ id: 7, lzk: [frei(), { ...frei(), id: 600, lerntheke: 'lerntheke_kreise_v11', datum: '2026-10-01' }] }]);
  dlg(7, 'ga.em', 'lerntheke_kreise_v11', 'Basis');
  pruefe('O4 die eigene Lerntheken-LZK geht immer vor', zustand().id === 600 && el['lzk-modal-datum'].value === '2026-10-01', zustand());

  console.log('\n' + ok + ' Pruefungen bestanden.');
})().catch(e => { console.error('FEHLER: ' + e.stack); process.exit(1); });
