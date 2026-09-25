// Prueft den Schliessen-Schalter in der Aktionsleiste der Lernbegleitung
// ("Meine Woche"), die beim Antippen eines Termins unten erscheint.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');

let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); if (a < 0) throw new Error('nicht gefunden: ' + k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };

const HEUTE = new Date().toISOString().slice(0, 10);
const versatz = n => { const d = new Date(HEUTE + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const MORGEN = versatz(1), GESTERN = versatz(-1);

const FAECHER = { 1: { name: 'Mathe', color: '#2563eb', nurZugewiesen: false } };
const stubs = [
  "const escHtml = t => String(t == null ? '' : t);",
  "const subjectById = id => FAECHER[id] || { name: '?', color: '#999' };",
  "const lwFmtDay = d => d;",
  "const lwTimeRange = (u, d) => u || '';",
  "const formatTeacherShort = u => u;",
  "const awDarfVerwalten = s => DARF;",
].join('\n') + '\n';

function bar(s, darf) {
  const el = { innerHTML: '', style: {} };
  const code = schneide('function slotVorbei(s) {') + schneide('function invEingeteilt(iv) {')
             + schneide('function invStatusText(iv) {') + schneide('function awRenderBar() {');
  new Function('FAECHER', 'DARF', 'calData', '_awPicked', 'document',
    stubs + code + '\nreturn awRenderBar;')(
      FAECHER, darf !== false, { slots: [s] }, s.id, { getElementById: () => el })();
  return el.innerHTML;
}

const fabue = z => Object.assign({
  id: 3, subjectId: 1, typ: 'input', datum: MORGEN, uhrzeit: '11:30', dauer: 45,
  ort: 'Basis M4', booked: true, session_id: 8, presentedStatus: 'ausstehend',
  thema: 'Einzelgespräche in M4', invitees: [],
}, z);

// --- 1) Der Schalter ist da und zeigt in die richtige Richtung ----------
{
  const h = bar(fabue({}));
  pruefe('A1 ein offenes Fachbuero laesst sich hier schliessen',
    h.includes('calSlotGeschlossen(3, true)') && h.includes('Keine weiteren Anmeldungen'), h.slice(-500));

  const h2 = bar(fabue({ geschlossen: true }));
  pruefe('A2 ein geschlossenes laesst sich wieder oeffnen',
    h2.includes('calSlotGeschlossen(3, false)') && h2.includes('Wieder'), h2.slice(-500));
  pruefe('A2b und ist in der Kopfzeile gekennzeichnet',
    h2.includes('keine weiteren Anmeldungen'), h2.slice(0, 400));
  pruefe('A2c ohne Kennzeichnung, solange er offen ist',
    !bar(fabue({})).includes('🔒'), '');
}

// --- 2) Nur dort, wo es etwas zu schliessen gibt ------------------------
{
  const talk = fabue({ id: 4, typ: 'talk' });
  pruefe('A3 bei einem Talk gibt es den Schalter nicht',
    !bar(talk).includes('calSlotGeschlossen'), '');

  pruefe('A4 bei einem fremden Termin gibt es ihn auch nicht',
    !bar(fabue({}), false).includes('calSlotGeschlossen'), '');
}

// --- 3) Vergangene Termine: Schalter bleibt, Einladen faellt weg -------
{
  const h = bar(fabue({ datum: GESTERN }));
  pruefe('A5 auch an einem vergangenen Fachbuero bleibt der Schalter bedienbar',
    h.includes('calSlotGeschlossen'), '');
  pruefe('A5b waehrend Einladen dort schon vorher entfaellt',
    !h.includes('openInputAssignModal'), h.slice(-400));
}

// --- 4) Einladen bleibt trotz geschlossenem Termin moeglich ------------
{
  const h = bar(fabue({ geschlossen: true }));
  pruefe('A6 die Lernbegleitung darf weiterhin selbst einladen',
    h.includes('openInputAssignModal(3)'), h.slice(-500));
  pruefe('A6b Bearbeiten und Stornieren bleiben ebenfalls',
    h.includes('openTalkingSlotEditModal(3') && h.includes('calCancelSession(8)'), h.slice(-500));
}

// --- 5) Die Leiste der Schueler:innen bleibt unberuehrt ----------------
{
  const mw = html.slice(html.indexOf('function mwRenderBar() {'),
                        html.indexOf('\n}\n', html.indexOf('function mwRenderBar() {')));
  pruefe('A7 in mwRenderBar steht kein Schliessen-Schalter',
    !mw.includes('calSlotGeschlossen'), '');
  pruefe('A7b und keine Schloss-Kennzeichnung', !mw.includes('🔒'), '');
}

console.log('\n' + ok + ' Pruefungen bestanden.');
