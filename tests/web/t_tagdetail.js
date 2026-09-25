// Prueft das Tagesdetail im Kalender: Schueler:innen sehen nur Termine, bei denen
// sie noch etwas tun koennen - oder die ihnen selbst gehoeren. Ein Fachbuero bleibt
// anfragbar, solange es laeuft und offen ist; vorbei oder fuer weitere Anmeldungen
// geschlossen faellt es weg, genau wie ein fremder, schon gebuchter Talk.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');

let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); if (a < 0) throw new Error('nicht gefunden: ' + k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };

const HEUTE = new Date().toISOString().slice(0, 10);
const versatz = n => { const d = new Date(HEUTE + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const MORGEN = versatz(1), GESTERN = versatz(-1);

const FAECHER = {
  1: { name: 'Mathe', color: '#2563eb', nurZugewiesen: false },
  2: { name: 'Englisch', color: '#eab308', nurZugewiesen: false },
};

const stubs = [
  "const escHtml = t => String(t == null ? '' : t);",
  "const subjectById = id => FAECHER[id] || { name: '?', color: '#999', nurZugewiesen: false };",
  "const formatTeacherShort = u => u;",
  "const lwIcon = () => '<svg></svg>';",
  "const calInviteeListHtml = () => '';",
  "const calItemsByDay = () => TAGE;",
].join('\n') + '\n';

function baue(rolle, items, tag) {
  const el = { innerHTML: '' };
  const code = schneide('function calDateStr(d) {') + schneide('function slotVorbei(s) {') + schneide('function calGehoertMir(it) {')
             + schneide('function invEingeteilt(iv) {') + schneide('function talkVortragendeText(praesentierend, weitere) {')
             + schneide('function renderCalDetail() {');
  const wann = tag || HEUTE;
  const tage = {}; tage[wann] = items;
  new Function('FAECHER', 'TAGE', 'me', 'calSelected', 'document',
    stubs + code + '\nreturn renderCalDetail;')(
      FAECHER, tage, rolle, wann, { getElementById: () => el })();
  return el.innerHTML;
}

const SCHUELI = { role: 'student', userId: 3 };
const ADMIN   = { role: 'admin', userId: 7, superAdmin: true };

const slot = z => Object.assign({
  id: 1, kind: 'slot', subjectId: 1, typ: 'input', datum: HEUTE, uhrzeit: '11:45',
  dauer: 15, ort: 'Mathe-Fachbuero', booked: false, presentedStatus: 'ausstehend',
}, z);

// --- 1) Der gemeldete Fall: fremder, schon gebuchter Talk ----------------
{
  const fremd = slot({ id: 9, subjectId: 2, typ: 'talk', booked: true,
                       presenterUsername: 'ilayra', thema: 'Mobbing' });
  const h = baue(SCHUELI, [fremd]);
  pruefe('T1 ein fremder, gebuchter Talk taucht nicht mehr auf',
    !h.includes('Mobbing') && !h.includes('Englisch-Talk'), h.slice(0, 260));
  pruefe('T1b stattdessen steht da, dass nichts dabei ist',
    h.includes('nichts für dich dabei'), h.slice(0, 260));
  pruefe('T1c die Lernbegleitung sieht ihn weiterhin',
    baue(ADMIN, [fremd]).includes('Mobbing'), '');
}

// --- 2) Was bleiben MUSS -------------------------------------------------
{
  const frei = slot({ id: 2, datum: MORGEN });
  pruefe('T2 ein freier, buchbarer Termin bleibt',
    baue(SCHUELI, [frei], MORGEN).includes('buchen'), '');

  const ausgeschrieben = slot({ id: 3, datum: MORGEN, slotThema: 'Brueche' });
  pruefe('T2b ein ausgeschriebenes Fachbuero bleibt (anfragen)',
    baue(SCHUELI, [ausgeschrieben], MORGEN).includes('Mitmachen anfragen'), '');

  const eingeladen = slot({ id: 4, booked: true, mineAsListener: true,
    myInvitationStatus: 'eingeladen', myInvitationId: 44, thema: 'Kreise' });
  const h4 = baue(SCHUELI, [eingeladen]);
  pruefe('T2c eine offene Einladung bleibt samt Knoepfen',
    h4.includes('Annehmen') && h4.includes('Ablehnen'), h4.slice(0, 200));

  const angefragt = slot({ id: 5, booked: true, mineAsListener: true,
    myInvitationStatus: 'angefragt', myInvitationId: 55 });
  pruefe('T2d eine laufende eigene Anfrage bleibt',
    baue(SCHUELI, [angefragt]).includes('ckziehen'), '');

  // Der heikle Fall: eigener zugesagter Termin OHNE Knopf
  const zugesagt = slot({ id: 6, booked: true, mineAsListener: true,
    myInvitationStatus: 'angenommen', myInvitationHerkunft: 'selbst',
    myInvitationGesehen: true, thema: 'Prozente' });
  const h6 = baue(SCHUELI, [zugesagt]);
  pruefe('T2e ein eigener zugesagter Termin bleibt, obwohl es dort keinen Knopf gibt',
    h6.includes('Prozente') && h6.includes('zugesagt'), h6.slice(0, 260));

  const haelt = slot({ id: 7, typ: 'talk', booked: true, mineAsPresenter: true, thema: 'Mein Vortrag' });
  pruefe('T2f ein Termin, den ich selbst halte, bleibt',
    baue(SCHUELI, [haelt]).includes('Mein Vortrag'), '');

  const abgelehnt = slot({ id: 8, booked: true, mineAsListener: true,
    myInvitationStatus: 'abgelehnt', thema: 'Abgesagt' });
  pruefe('T2g auch ein selbst abgelehnter Termin bleibt sichtbar',
    baue(SCHUELI, [abgelehnt]).includes('Abgesagt'), '');
}

// --- 3) Fachbueros: offen und noch nicht gewesen -> sichtbar ------------
{
  // Der Fall, den der Nutzer ausdruecklich genannt hat: schon gebucht, aber weiter
  // anfragbar - darf NICHT verschwinden.
  const fremdGebucht = slot({ id: 12, booked: true, presenterUsername: 'nele', thema: 'Heute' });
  const h12 = baue(SCHUELI, [fremdGebucht]);
  pruefe('T3 ein schon gebuchtes Fachbuero bleibt samt Anfrage-Knopf',
    h12.includes('Heute') && h12.includes('Mitmachen anfragen'), h12.slice(0, 260));

  const freiMorgen = slot({ id: 13, datum: MORGEN });
  pruefe('T3b ein freies Fachbuero in der Zukunft bleibt',
    baue(SCHUELI, [freiMorgen], MORGEN).includes('buchen'), '');
}

// --- 3b) Fachbueros: vorbei oder geschlossen -> weg ---------------------
{
  const freiVorbei = slot({ id: 14, datum: GESTERN });
  pruefe('T3c ein vergangenes freies Fachbuero verschwindet',
    !baue(SCHUELI, [freiVorbei], GESTERN).includes('FaB'), '');

  const fremdVorbei = slot({ id: 15, booked: true, datum: GESTERN,
    presenterUsername: 'nele', thema: 'Altes Thema' });
  pruefe('T3d ein fremdes, vergangenes Fachbuero verschwindet',
    !baue(SCHUELI, [fremdVorbei], GESTERN).includes('Altes Thema'), '');

  // Geschlossen: der Server liefert es Unbeteiligten gar nicht erst aus. Kommt es
  // aus einem veralteten Browserstand doch an, darf hier kein Knopf stehen.
  const zuFrei = slot({ id: 16, datum: MORGEN, geschlossen: true });
  const h16 = baue(SCHUELI, [zuFrei], MORGEN);
  pruefe('T3e ein geschlossenes freies Fachbuero verschwindet',
    !h16.includes('buchen') && !h16.includes('Mitmachen anfragen'), h16.slice(0, 260));

  const zuGebucht = slot({ id: 17, booked: true, geschlossen: true,
    presenterUsername: 'nele', thema: 'Zu' });
  pruefe('T3f ein geschlossenes gebuchtes Fachbuero verschwindet',
    !baue(SCHUELI, [zuGebucht]).includes('Zu'), '');

  // Eigener Termin sticht auch das: wer drin ist, behaelt ihn
  const meinsZu = slot({ id: 18, booked: true, geschlossen: true, mineAsListener: true,
    myInvitationStatus: 'angenommen', myInvitationHerkunft: 'selbst',
    myInvitationGesehen: true, thema: 'Mein geschlossener Termin' });
  pruefe('T3g ein eigener Termin bleibt, auch wenn er geschlossen ist',
    baue(SCHUELI, [meinsZu]).includes('Mein geschlossener Termin'), '');
}

// --- 3c) Talks -----------------------------------------------------------
{
  const talkVorbei = { id: 19, kind: 'slot', subjectId: 2, typ: 'talk', datum: GESTERN,
    uhrzeit: '09:00', dauer: 15, booked: false, presentedStatus: 'ausstehend' };
  pruefe('T3h ein freier Talk in der Vergangenheit verschwindet',
    !baue(SCHUELI, [talkVorbei], GESTERN).includes('Englisch-Talk'), '');

  const talkFrei = { id: 20, kind: 'slot', subjectId: 2, typ: 'talk', datum: MORGEN,
    uhrzeit: '09:00', dauer: 15, booked: false, presentedStatus: 'ausstehend' };
  pruefe('T3i ein freier Talk in der Zukunft bleibt (anmeldbar)',
    baue(SCHUELI, [talkFrei], MORGEN).includes('Talk anmelden'), '');
}

// --- 3d) Die Lernbegleitung sieht alles, samt Schalter ------------------
{
  const zu = slot({ id: 21, booked: true, geschlossen: true, presenterUsername: 'nele', thema: 'Zu' });
  const h = baue(ADMIN, [zu]);
  pruefe('T3j die Lernbegleitung sieht auch geschlossene Termine',
    h.includes('Zu'), h.slice(0, 200));
  pruefe('T3k sie sind als geschlossen gekennzeichnet',
    h.includes('keine weiteren Anmeldungen'), h.slice(0, 400));
  pruefe('T3l und lassen sich wieder oeffnen',
    h.includes('calSlotGeschlossen(21, false)') && h.includes('Wieder'), h.slice(0, 500));

  const offen = slot({ id: 22, datum: MORGEN });
  const h2 = baue(ADMIN, [offen], MORGEN);
  pruefe('T3m ein offenes Fachbuero laesst sich schliessen',
    h2.includes('calSlotGeschlossen(22, true)'), h2.slice(0, 500));

  const talk = { id: 23, kind: 'slot', subjectId: 2, typ: 'talk', datum: MORGEN,
    uhrzeit: '09:00', dauer: 15, booked: false, presentedStatus: 'ausstehend' };
  pruefe('T3n bei einem Talk gibt es den Schalter nicht',
    !baue(ADMIN, [talk], MORGEN).includes('calSlotGeschlossen'), '');
}

// --- 4) Deadlines bleiben immer -----------------------------------------
{
  const dl = { kind: 'deadline', id: 3, titel: 'Abgabe Plakat', datum: HEUTE };
  const h = baue(SCHUELI, [dl]);
  pruefe('T4 Deadlines bleiben sichtbar, obwohl es dort keinen Knopf gibt',
    h.includes('Abgabe Plakat'), h.slice(0, 220));
  pruefe('T4b und ohne Loeschen-Knopf fuer Schueler:innen', !h.includes('deleteDeadline'), '');
}

// --- 5) Leerer Tag -------------------------------------------------------
pruefe('T5 ein Tag ganz ohne Termine sagt das auch so',
  baue(SCHUELI, []).includes('Keine Termine an diesem Tag'), '');

// --- 6) Mischung: nur das Brauchbare bleibt ------------------------------
{
  const h = baue(SCHUELI, [
    slot({ id: 20, subjectId: 2, typ: 'talk', booked: true, presenterUsername: 'ilayra', thema: 'Mobbing' }),
    slot({ id: 21, slotThema: 'Rechtschreibung' }),
  ]);
  pruefe('T6 aus einer Mischung faellt nur der fremde Talk weg',
    !h.includes('Mobbing') && h.includes('Rechtschreibung'), h.slice(0, 300));
}

console.log('\n' + ok + ' Pruefungen bestanden.');
