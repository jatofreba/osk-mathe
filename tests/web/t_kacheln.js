// Prueft die entschlackten Wochenkacheln: Namen als Text, Symbol nur wo etwas aussteht,
// ab 6 Personen nur noch die Zahl.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };
const FAECHER = { 1: { name: 'Mathe', color: '#2563eb', colorBg: '#eff6ff', nurZugewiesen: false } };
const stubs = `
  const escHtml = t => String(t == null ? '' : t);
  const subjectById = id => FAECHER[id] || { name: '?', color: '#999', colorBg: '#eee' };
  const formatTeacherShort = u => u; const lwIcon = () => ''; const lwTimeRange = u => u || '';
`;
const code = schneide('const LW_TALK_TEXT') + schneide('function lwBadge(typ, buchstabe, farbe) {') + schneide('function invEingeteilt(iv) {') + schneide('const AW_NAMEN_MAX')
           + schneide('function awPersonenHtml(leute) {') + schneide('function awChip(s) {');
const bau = (me, s) => new Function('FAECHER', 'me', stubs + code + '\nreturn awChip;')(FAECHER, me)(s);
const LB = { role: 'admin', userId: 7, username: 'herf' };
const slot = inv => ({ id: 5, subjectId: 1, typ: 'input', datum: '2026-09-18', uhrzeit: '08:45',
  booked: true, teacherUsername: 'herf', thema: 'Begrüßung', invitees: inv });
const p = (name, z) => Object.assign({ id: 1, username: name, status: 'angenommen',
  herkunft: 'zugewiesen', gesehen: true }, z);

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
