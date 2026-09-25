// "Termin löschen" in der Aktionsleiste der Wochenuebersicht: nur am
// unbebuchten Termin, weil der Server einen gebuchten ablehnt (409).
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
const srv = lies('server.js');

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

const slot = z => Object.assign({
  id: 3, subjectId: 1, typ: 'input', datum: MORGEN, uhrzeit: '11:30', dauer: 45,
  ort: 'Basis M4', booked: false, presentedStatus: 'ausstehend', invitees: [],
}, z);

// --- 1) Der Server gibt die Regel vor ------------------------------------
{
  const teil = srv.slice(srv.indexOf("app.delete('/api/admin/talking-slots/:id'"),
                         srv.indexOf('\n});\n', srv.indexOf("app.delete('/api/admin/talking-slots/:id'")));
  pruefe('L1 der Server lehnt das Loeschen eines gebuchten Termins ab',
    teil.includes("'Termin ist bereits gebucht'") && teil.includes('409'), teil.slice(0, 400));
  pruefe('L1b und prueft vorher die Zustaendigkeit',
    teil.includes('mayManageSlot(req, req.params.id)'), '');
}

// --- 2) Unbebuchter Termin: Loeschen steht da ----------------------------
{
  const h = bar(slot({}));
  pruefe('L2 ein freier Termin laesst sich aus der Leiste loeschen',
    h.includes('calDeleteSlot(3)') && h.includes('Termin löschen'), h.slice(-500));
  pruefe('L2b ohne Stornieren-Knopf', !h.includes('calCancelSession'), h.slice(-500));

  const alt = bar(slot({ datum: GESTERN }));
  pruefe('L2c auch ein alter, nie gebuchter Termin laesst sich aufraeumen',
    alt.includes('calDeleteSlot(3)'), alt.slice(-400));
}

// --- 3) Gebuchter Termin: erst stornieren --------------------------------
{
  const h = bar(slot({ booked: true, session_id: 8, thema: 'Einzelgespräche' }));
  pruefe('L3 ein gebuchter Termin bietet Stornieren',
    h.includes('calCancelSession(8)'), h.slice(-500));
  pruefe('L3b und KEIN Loeschen, das der Server ohnehin ablehnen wuerde',
    !h.includes('calDeleteSlot'), h.slice(-500));
  pruefe('L3c der Hinweis erklaert die Reihenfolge',
    h.includes('erst stornieren'), h.slice(0, 900));
}

// --- 4) Fremde Termine bleiben unantastbar -------------------------------
{
  const h = bar(slot({}), false);
  pruefe('L4 bei einem fremden Termin gibt es kein Loeschen',
    !h.includes('calDeleteSlot'), h.slice(-400));
  pruefe('L4b und der Hinweis sagt warum',
    h.includes('anderen Lernbegleitung'), h.slice(0, 400));
}

// --- 5) Die uebrigen Knoepfe bleiben -------------------------------------
{
  const h = bar(slot({}));
  pruefe('L5 Einladen, Bearbeiten und Schliessen stehen weiterhin da',
    h.includes('openInputAssignModal(3)') && h.includes('openTalkingSlotEditModal(3')
    && h.includes('calSlotGeschlossen(3'), h.slice(-600));
}

console.log('\n' + ok + ' Pruefungen bestanden.');
