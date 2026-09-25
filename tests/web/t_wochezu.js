// Ein geschlossenes Fachbuero bleibt in der Wochenuebersicht stehen (man sieht,
// dass da etwas laeuft), ist dort aber nicht mehr buchbar. Aus dem Tagesdetail
// faellt es weiter heraus, weil es dort keinen Knopf mehr gibt.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
const srv = lies('server.js');

let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); if (a < 0) throw new Error('nicht gefunden: ' + k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };

const HEUTE = new Date().toISOString().slice(0, 10);
const versatz = n => { const d = new Date(HEUTE + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const MORGEN = versatz(1);

// --- 1) Der Server liefert geschlossene Termine weiterhin aus ------------
{
  const kal = srv.slice(srv.indexOf("app.get('/api/calendar'"), srv.indexOf('async function halbjahrOverview'));
  pruefe('W1 der Zustand kommt weiterhin mit', kal.includes('s.geschlossen,'), '');
  pruefe('W1b aber der Termin wird nicht mehr weggefiltert',
    !/if \(s\.geschlossen\) return false;/.test(kal), '');

  const a = kal.indexOf('    })).filter(s => {');
  const filterRoh = kal.slice(kal.indexOf('{', a) + 1, kal.indexOf('\n    });', a));
  const filter = new Function('req', 'nurZugewiesenIds', 's', filterRoh);
  const schueli = { session: { role: 'student' } };
  const fabue = z => Object.assign({ subjectId: 1, geschlossen: false,
    mineAsPresenter: false, mineAsListener: false }, z);
  pruefe('W1c ein geschlossenes Fachbuero erreicht die Schueler:innen',
    filter(schueli, new Set([9]), fabue({ geschlossen: true })) === true, '');
  pruefe('W1d die Lernberatungs-Regel gilt unveraendert weiter',
    filter(schueli, new Set([9]), fabue({ subjectId: 9 })) === false
    && filter(schueli, new Set([9]), fabue({ subjectId: 9, mineAsListener: true })) === true, '');
}

// --- 2) Wochenkachel: sichtbar, aber ohne Anmeldung ---------------------
const FAECHER = { 1: { name: 'Mathe', color: '#2563eb', nurZugewiesen: false } };
const stubs = [
  "const escHtml = t => String(t == null ? '' : t);",
  "const subjectById = id => FAECHER[id] || { name: '?', color: '#999', nurZugewiesen: false };",
  "const formatTeacherShort = u => u;",
  "const lwIcon = () => '<svg></svg>';",
  "const lwTimeRange = (u) => u || '';",
  "const lwFmtDay = d => d;",
].join('\n') + '\n';

const basis = schneide('const LW_TALK_TEXT') + schneide('function lwBadge(typ, buchstabe, farbe) {')
            + schneide('function lwThemaOhneFrei(text) {') + schneide('function lwOrtAbweichend(s) {')
            + schneide('function slotVorbei(s) {') + schneide('function invEingeteilt(iv) {')
            + schneide('function invStatusText(iv) {') + schneide('function invStatusIcon(iv) {')
            + schneide('function mwState(s) {');

const mach = (name, extra) =>
  new Function('FAECHER', stubs + basis + extra + '\nreturn ' + name + ';')(FAECHER);

const mwState  = mach('mwState', '');
const mwChip   = mach('mwChip', schneide('function mwChip(s) {'));
const mwAktion = mach('mwAktion', schneide('function mwChip(s) {') + schneide('function mwAktion(s) {'));

const fabue = z => Object.assign({
  id: 3, subjectId: 1, typ: 'input', datum: MORGEN, uhrzeit: '11:30', dauer: 45,
  booked: false, presentedStatus: 'ausstehend', slotThema: 'Brueche',
}, z);

{
  pruefe('W2 ein geschlossener Termin bekommt einen eigenen Zustand',
    mwState(fabue({ geschlossen: true })) === 'zu', mwState(fabue({ geschlossen: true })));
  pruefe('W2b ein offener bleibt frei', mwState(fabue({})) === 'free');

  const h = mwChip(fabue({ geschlossen: true }));
  pruefe('W3 die Kachel bleibt in der Woche stehen',
    h.includes('lw-chip') && h.includes('11:30'), h.slice(0, 200));
  pruefe('W3b und sagt, dass keine Anmeldung mehr geht',
    h.includes('keine Anmeldung mehr'), h.slice(0, 400));
  pruefe('W3c das Thema steht weiter da - man sieht, was laeuft',
    h.includes('Brueche'), h.slice(0, 400));
  pruefe('W3d sie ist nicht mehr in Fachfarbe eingefasst',
    !h.includes('border-left-color:#2563eb'), h.slice(0, 200));
  pruefe('W3e und traegt die Zustandsklasse', h.includes('mw-zu'), h.slice(0, 200));
}

// --- 3) Keine Aktion mehr ------------------------------------------------
{
  const a = mwAktion(fabue({ geschlossen: true }));
  pruefe('W4 es wird kein Knopf mehr angeboten', !a.ruf && !a.text, JSON.stringify(a));
  pruefe('W4b sondern ein Hinweis', /keine weiteren Anmeldungen/i.test(a.hinweis || ''), JSON.stringify(a));

  const offen = mwAktion(fabue({}));
  pruefe('W4c ein offenes Fachbuero bleibt buchbar', !!offen.ruf, JSON.stringify(offen));

  // Eigener Termin sticht auch hier: wer drin ist, sieht seinen Termin als solchen
  const meins = mwAktion(fabue({ geschlossen: true, booked: true, mineAsListener: true,
    myInvitationStatus: 'angenommen', myInvitationHerkunft: 'selbst', myInvitationGesehen: true }));
  pruefe('W5 ein eigener Termin bleibt als eigener erkennbar',
    /schon/.test(meins.hinweis || ''), JSON.stringify(meins));
}

// --- 4) Monatsraster faerbt ihn nicht mehr als buchbar ------------------
{
  const calSlotState = new Function('me', 'FAECHER',
    stubs + schneide('function slotVorbei(s) {') + schneide('function calSlotState(it) {')
    + '\nreturn calSlotState;')({ role: 'student' }, FAECHER);
  pruefe('W6 im Monatsraster gilt ein geschlossener Termin als zu',
    calSlotState(fabue({ geschlossen: true })) === 'closed', calSlotState(fabue({ geschlossen: true })));
  pruefe('W6b ein offener bleibt frei', calSlotState(fabue({})) === 'join');
}

console.log('\n' + ok + ' Pruefungen bestanden.');
