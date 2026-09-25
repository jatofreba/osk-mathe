// Prueft den Einladen-Knopf in der Wochenleiste und die einheitliche Wortwahl.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };
const FAECHER = { 1: { name: 'Mathe', color: '#2563eb', colorBg: '#eff6ff', nurZugewiesen: false },
                  2: { name: 'Lernberatung', color: '#999', colorBg: '#eee', nurZugewiesen: true } };
const stubs = `
  const escHtml = t => String(t == null ? '' : t);
  const subjectById = id => FAECHER[id] || { name: '?', color: '#999', colorBg: '#eee', nurZugewiesen: false };
  const lwFmtDay = d => d; const lwTimeRange = u => u || '';
`;
const HEUTE = new Date().toISOString().slice(0, 10);
const versatz = n => { const d = new Date(HEUTE + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const code = schneide('function slotVorbei(s) {') + schneide('function invEingeteilt(iv) {')
           + schneide('function invStatusText(iv) {') + schneide('function awDarfVerwalten(s) {')
           + schneide('function awRenderBar() {');

function bau(me, z) {
  const bar = { innerHTML: '', style: {} };
  const dok = { getElementById: id => (id === 'aw-actionbar' ? bar : null), querySelectorAll: () => [] };
  const slot = Object.assign({ id: 5, subjectId: 1, typ: 'input', datum: versatz(1), uhrzeit: '11:30',
    thema: 'Einzelgespräche in M4', teacherId: 7, session_id: 55, booked: true,
    presentedStatus: 'ausstehend', invitees: [] }, z);
  new Function('FAECHER', 'me', 'calData', 'document', '_awPicked', stubs + code + '\nreturn awRenderBar;')(
    FAECHER, me, { slots: [slot] }, dok, 5)();
  return bar.innerHTML;
}
const LB = { role: 'admin', userId: 7, superAdmin: false };
const FREMD = { role: 'admin', userId: 9, superAdmin: false };

pruefe('E1 am gebuchten Fachbüro gibt es "+ weitere einladen"',
  bau(LB, {}).includes('openInputAssignModal(5)') && bau(LB, {}).includes('+ weitere einladen'), bau(LB, {}));
pruefe('E2 am noch leeren Termin heisst es "+ einladen"',
  bau(LB, { booked: false, session_id: null }).includes('>+ einladen<'), bau(LB, { booked: false, session_id: null }));
pruefe('E3 bei einer Lernberatung ebenso (die vergibt die Lernbegleitung ja)',
  bau(LB, { subjectId: 2 }).includes('openInputAssignModal(5)'));
pruefe('E4 bei einem Talk nicht - dort laedt die vortragende Person ein',
  !bau(LB, { typ: 'talk' }).includes('openInputAssignModal('));
pruefe('E5 an einem vergangenen Termin nicht mehr',
  !bau(LB, { datum: versatz(-1) }).includes('openInputAssignModal('));
pruefe('E6 an einem abgeschlossenen Termin nicht mehr',
  !bau(LB, { presentedStatus: 'erledigt' }).includes('openInputAssignModal('));
pruefe('E7 an fremden Terminen nicht',
  !bau(FREMD, {}).includes('openInputAssignModal('));
pruefe('E8 Bearbeiten und Stornieren bleiben daneben',
  bau(LB, {}).includes('openTalkingSlotEditModal(5') && bau(LB, {}).includes('calCancelSession(55)'));
pruefe('E9 der Knopf hat eine eigene Farbe', html.includes('.mw-bar-btn.mw-bar-btn-blau'));

// Wortwahl
for (const alt of ['Wen zuweisen?', '>Zuweisen<', '+ weitere zuweisen', '+ zuweisen',
                   'Schüler:innen zuweisen', 'bereits zugewiesen', 'Fehler beim Zuweisen',
                   'Nicht zugewiesen wegen'])
  pruefe('W: "' + alt + '" kommt nicht mehr vor', !html.includes(alt));
for (const neu of ['Wen einladen?', '>Einladen<', '+ weitere einladen', 'Schüler:innen einladen',
                   'Fehler beim Einladen'])
  pruefe('W: "' + neu + '" ist da', html.includes(neu));
pruefe('W: der Hinweis beim Anlegen spricht auch vom Einladen',
  html.includes('einladen musst du dann niemanden'));
console.log('\n' + ok + ' Pruefungen bestanden.');
