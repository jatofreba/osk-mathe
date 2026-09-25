// Prueft die aufklappbaren Rubriken in der Halbjahr-Auswertung.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };

const FAECHER = [{ key: 'mathe', name: 'Mathe', color: '#2563eb' }];
const code = schneide('function hjDetailHtml(s, subjectKey) {');
const bauen = (b, subjectKey) => new Function('hjSelected', 'orderedSubjects', 'subjectByKey', `
  const escHtml = t => String(t == null ? '' : t);
  const hjFmtDate = d => d || '';
  const hjLtTitle = k => k || '';
` + code + '\nreturn hjDetailHtml;')('2627_1', () => FAECHER, k => FAECHER[0])(
  { byHalbjahr: { '2627_1': b } }, subjectKey);

const fabue = n => Array.from({ length: n }, (_, i) => ({ datum: '2026-09-0' + (i + 1), thema: 'Kreise', status: 'erledigt', role: 'angemeldet' }));

// --- 1: Rubriken sind aufklappbar ------------------------------------------
{
  const h = bauen({ bySubject: { mathe: { talkDetails: [], inputDetails: fabue(5) } }, lzk: [], stationDetails: [], stationsCompleted: 0 }, 'mathe');
  pruefe('R1 jede Rubrik ist ein <details>', (h.match(/<details class="hj-rubrik"/g) || []).length === 4, h.slice(0, 300));
  pruefe('R1b die Ueberschrift ist das <summary> zum Anklicken',
    h.includes('<summary class="admin-title"'), '');
  pruefe('R2 die Anzahl steht weiterhin im Titel',
    h.includes('📘 FaBü-Teilnahmen (5)') && h.includes('🎤👂 Talks (0)'), '');
  // Voreinstellung wurde von der zweiten Session geaendert: ALLE Rubriken starten
  // zugeklappt, die Anzahl in der Ueberschrift sagt ja schon, ob etwas da ist.
  pruefe('R3 alle Rubriken starten zugeklappt',
    !h.includes('<details class="hj-rubrik" open>'), h.slice(0, 200));
  pruefe('R4 auch die mit Eintraegen - aufklappbar bleiben sie',
    (h.match(/<details class="hj-rubrik">/g) || []).length === 4, '');
  pruefe('R4b ihr Inhalt ist aber da, wenn man aufklappt',
    h.includes('Keine Talks in diesem Halbjahr.'), '');
}

// --- 2: Stationen zaehlen den Gesamtstand, nicht die Listenlaenge -----------
{
  const h = bauen({ bySubject: { mathe: { talkDetails: [], inputDetails: [] } },
    lzk: [], stationDetails: [{ progress_key: 'a', datum: '2026-09-01' }], stationsCompleted: 7 }, 'mathe');
  pruefe('R5 die Stationen-Rubrik zeigt den Gesamtstand', h.includes('📚 Stationen (7)'), '');
  pruefe('R5b und startet wie alle zugeklappt',
    !h.includes('<details class="hj-rubrik" open>'), '');
}

// --- 3: LZK/Stationen nur im Mathe-Abschnitt --------------------------------
{
  const FZWEI = [{ key: 'englisch', name: 'Englisch', color: '#ca8a04' }];
  const h = new Function('hjSelected', 'orderedSubjects', 'subjectByKey', `
    const escHtml = t => String(t == null ? '' : t);
    const hjFmtDate = d => d || ''; const hjLtTitle = k => k || '';
  ` + code + '\nreturn hjDetailHtml;')('2627_1', () => FZWEI, k => FZWEI[0])(
    { byHalbjahr: { '2627_1': { bySubject: { englisch: { talkDetails: [], inputDetails: fabue(2) } }, lzk: [], stationDetails: [], stationsCompleted: 0 } } }, 'englisch');
  // Seit 2026-09-24 gibt es LZK in jedem Fach; Stationen bleiben Mathe vorbehalten.
  pruefe('R6 ausserhalb von Mathe: Talks, FaBü und LZK - keine Stationen',
    (h.match(/<details class="hj-rubrik"/g) || []).length === 3 && h.includes('LZK') && !h.includes('Stationen'), '');
}

// --- 4: Optik ---------------------------------------------------------------
pruefe('R7 eigenes Dreieck statt des Browser-Markers',
  html.includes('.hj-rubrik>summary::-webkit-details-marker{display:none;}')
  && html.includes(".hj-rubrik[open]>summary::before{content:'▾';}"), '');
pruefe('R8 mit Tastatur bedienbar (Fokus sichtbar)',
  html.includes('.hj-rubrik>summary:focus-visible'), '');
pruefe('R9 kein eigenes JavaScript noetig - natives <details>',
  !html.includes('hjRubrikToggle') && !html.includes('hj-rubrik" onclick'), '');

console.log('\n' + ok + ' Pruefungen bestanden.');
