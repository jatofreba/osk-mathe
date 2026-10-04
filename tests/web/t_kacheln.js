// Prueft die entschlackten Wochenkacheln: Namen als Text, Symbol nur wo etwas aussteht,
// ab 6 Personen nur noch die Zahl.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };
const FAECHER = { 1: { name: 'Mathe', color: '#2563eb', colorBg: '#eff6ff', nurZugewiesen: false },
                  2: { name: 'Lernberatung', color: '#7c3aed', colorBg: '#f5f3ff', nurZugewiesen: true } };
const stubs = `
  const escHtml = t => String(t == null ? '' : t);
  const subjectById = id => FAECHER[id] || { name: '?', color: '#999', colorBg: '#eee' };
  const formatTeacherShort = u => u; const lwIcon = () => ''; const lwTimeRange = u => u || '';
`;
const code = schneide('const LW_TALK_TEXT') + schneide('function lwBadge(typ, buchstabe, farbe) {') + schneide('function invEingeteilt(iv) {') + schneide('const AW_NAMEN_MAX')
           + schneide('function awPersonenHtml(leute) {') + schneide('function slotVorbei(s) {')
           + schneide('function lwBuchbar(s) {') + schneide('function lwPlaetzeFrei(s) {') + schneide('function lwFreiKlasse(s) {')
           + schneide('function lwStandText(s, sonst) {') + schneide('function awChip(s) {');
const bau = (me, s) => new Function('FAECHER', 'me', stubs + code + '\nreturn awChip;')(FAECHER, me)(s);
const LB = { role: 'admin', userId: 7, username: 'herf' };
const slot = inv => ({ id: 5, subjectId: 1, typ: 'input', datum: '2026-09-18', uhrzeit: '08:45',
  booked: true, teacherUsername: 'herf', thema: 'Begrüßung', invitees: inv });
const p = (name, z) => Object.assign({ id: 1, username: name, status: 'angenommen',
  herkunft: 'zugewiesen', gesehen: true }, z);

// --- frei = gruen, vergeben/vorbei = grau -----------------------------------
{
  const zukunft = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const frei = bau(LB, { id: 6, subjectId: 1, typ: 'talk', datum: zukunft, uhrzeit: '10:00', booked: false, invitees: [] });
  pruefe('F1 freier, kuenftiger Termin ist gruen und sagt "frei"',
    frei.includes('ist-frei') && frei.includes('lw-frei">frei<'), frei);
  const vorbei = bau(LB, { id: 7, subjectId: 1, typ: 'talk', datum: '2020-01-01', uhrzeit: '10:00', booked: false, invitees: [] });
  pruefe('F2 frei, aber vorbei: grau und nicht "frei"',
    vorbei.includes('ist-vergeben') && !vorbei.includes('>frei<') && vorbei.includes('nicht gebucht'), vorbei);
  const zu = bau(LB, { id: 8, subjectId: 1, typ: 'input', datum: zukunft, uhrzeit: '10:00', booked: false, geschlossen: true, invitees: [] });
  pruefe('F3 geschlossen: grau', zu.includes('ist-vergeben') && !zu.includes('ist-frei'), zu);
  const gebucht = bau(LB, slot([p('merle')]));
  pruefe('F4 gebucht und vorbei: grau, Namen bleiben lesbar', gebucht.includes('ist-vergeben') && gebucht.includes('merle'), gebucht);

  // Seit 2026-10-04: ein gebuchtes Fachbuero, bei dem man noch mitmachen anfragen kann, ist gruen.
  const offen = z => Object.assign(slot([p('merle')]), { datum: zukunft, presentedStatus: 'ausstehend' }, z);
  const plaetze = bau(LB, offen({}));
  pruefe('F5 gebuchtes, offenes Fachbuero: gruen und "noch Plätze frei"',
    plaetze.includes('ist-frei') && plaetze.includes('noch Plätze frei'), plaetze);
  pruefe('F6 keine weiteren Anmeldungen: grau', bau(LB, offen({ geschlossen: true })).includes('ist-vergeben')
    && !bau(LB, offen({ geschlossen: true })).includes('noch Plätze frei'));
  // Seit Fachbueros ohne Zusage laufen (2026-10-04), schliesst ein frueheres "war da" die Runde nicht mehr.
  pruefe('F7 auch mit alt eingetragenem "war da" der buchenden Person: weiter gruen',
    bau(LB, offen({ presentedStatus: 'erledigt' })).includes('ist-frei'));
  pruefe('F8 gebuchter Talk: grau - einen Talk kann man nicht mitbuchen',
    bau(LB, offen({ typ: 'talk' })).includes('ist-vergeben') && !bau(LB, offen({ typ: 'talk' })).includes('noch Plätze frei'));
  pruefe('F9 Lernberatung: grau - die vergibt die Lernbegleitung',
    bau(LB, offen({ subjectId: 2 })).includes('ist-vergeben'));
}

// --- Stand in Worten (fuer alle Kacheln gleich) ------------------------------
{
  const zukunft = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const lwStandText = new Function('FAECHER', 'me', stubs + code + '\nreturn lwStandText;')(FAECHER, LB);
  const t = z => lwStandText(Object.assign({ id: 9, subjectId: 1, typ: 'input', datum: zukunft, booked: false }, z), 'sonst');
  pruefe('T1 frei', t({}) === 'frei');
  pruefe('T2 gebucht, offen: noch Plätze frei', t({ booked: true, presentedStatus: 'ausstehend' }) === 'noch Plätze frei');
  pruefe('T3 gebucht, keine weiteren Anmeldungen: voll', t({ booked: true, presentedStatus: 'ausstehend', geschlossen: true }) === 'voll');
  pruefe('T4 gebuchter Talk: vergeben', t({ booked: true, typ: 'talk' }) === 'vergeben');
  pruefe('T5 gebucht und vorbei: vergeben (nicht "voll")', t({ booked: true, geschlossen: true, datum: '2020-01-01' }) === 'vergeben');
  pruefe('T6 nicht gebucht und nicht buchbar: Text der Ansicht', t({ geschlossen: true }) === 'sonst');
  pruefe('T7 oeffentliche Woche (ohne presentedStatus): gebucht und offen heisst noch Plätze frei',
    t({ booked: true }) === 'noch Plätze frei');
}

// --- klein: Namen als Text -------------------------------------------------
{
  const h = bau(LB, slot([p('merle'), p('valentyn')]));
  pruefe('K1 wenige Personen stehen namentlich da', h.includes('merle') && h.includes('valentyn'), h);
  pruefe('K1b als Fliesstext mit Komma, nicht als Kapselreihe',
    h.includes('</span>, <span'), h);
  pruefe('K1c wer erledigt ist, bekommt KEIN Symbol mehr',
    !h.includes('merle 📋') && !h.includes('👥'), h);
}
{
  const h = bau(LB, slot([p('merle', { gesehen: false }), p('valentyn')]));
  pruefe('K2 nur wer noch nichts weiss, traegt ein Symbol',
    h.includes('merle 📋') && !h.includes('valentyn 📋'), h);
  pruefe('K2b und wird kursiv hervorgehoben', h.includes('aw-person-pending'), h);
}
{
  const h = bau(LB, slot([p('be.ja', { status: 'angefragt' }), p('ma.ba', { status: 'eingeladen' })]));
  pruefe('K3 die drei offenen Arten haben eigene Symbole',
    h.includes('be.ja ❓') && h.includes('ma.ba ⏳'), h);
}

// --- gross: nur noch die Zahl ---------------------------------------------
{
  const zehn = ['vicco','hüseyin','joshua','nele','sophie','carl','leopold-n','liam','oliver','oskar'];
  const h = bau(LB, slot(zehn.map(n => p(n))));
  pruefe('K4 ab sieben Personen steht nur noch die Zahl',
    h.includes('👥 10') && !h.includes('vicco'), h);
  pruefe('K4b und kein Symbol, wenn nichts aussteht', !h.includes('📋'), h);

  const h2 = bau(LB, slot(zehn.map(n => p(n, { gesehen: false }))));
  pruefe('K5 was aussteht, wird nach Art zusammengefasst',
    h2.includes('👥 10') && h2.includes('📋 10'), h2);

  const gemischt = zehn.map((n, i) => p(n, i < 2 ? { status: 'angefragt' } : i < 5 ? { gesehen: false } : {}));
  const h3 = bau(LB, slot(gemischt));
  pruefe('K6 mehrere Arten nebeneinander',
    h3.includes('❓ 2') && h3.includes('📋 3') && h3.includes('👥 10'), h3);
  pruefe('K6b Anfragen stehen vorn - die warten auf dich',
    h3.indexOf('❓ 2') < h3.indexOf('📋 3'), h3);
}

// --- Grenze und Sonderfaelle ----------------------------------------------
{
  const sechs = ['a','b','c','d','e','f'].map(n => p(n));
  pruefe('K7 genau sechs bleiben namentlich', bau(LB, slot(sechs)).includes('>a<'));
  pruefe('K7b sieben kippen in die Zahl', bau(LB, slot(sechs.concat([p('g')]))).includes('👥 7'));
  pruefe('K8 Abgesagte zaehlen nicht mit',
    bau(LB, slot([p('x'), p('y', { status: 'abgelehnt' })])).includes('>x<')
    && !bau(LB, slot([p('x'), p('y', { status: 'abgelehnt' })])).includes('>y<'));
  pruefe('K9 die buchende Person steht vorn und fett',
    bau(LB, Object.assign(slot([p('x')]), { presenterUsername: 'be.ja' })).includes('aw-person-main" title="hat gebucht">be.ja'));
  pruefe('K10 ohne Teilnehmende bleibt die Zeile weg',
    !bau(LB, slot([])).includes('aw-people'));
}

// --- Optik ------------------------------------------------------------------
pruefe('K11 die Namen sind keine Kapseln mehr (kein Rahmen, kein Radius)',
  !html.includes('.aw-person{\n  font-size:10px;line-height:1.3;padding:1px 6px;border-radius:99px;'), '');
pruefe('K11b und die Reihe ist kein Flex-Container mehr',
  !html.includes('.aw-people{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;}'), '');
pruefe('K12 die Schwelle steht als benannte Konstante', html.includes('const AW_NAMEN_MAX = 6;'));
console.log('\n' + ok + ' Pruefungen bestanden.');
