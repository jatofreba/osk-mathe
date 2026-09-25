// Prueft die Kursung in der Halbjahr-Auswertung (eigene Ansicht + Detail-Fenster).
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
const srv = lies('server.js');
let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };

const FAECHER = [
  { key: 'mathe', name: 'Mathe', color: '#2563eb', nurZugewiesen: false },
  { key: 'englisch', name: 'Englisch', color: '#ca8a04', nurZugewiesen: false },
  { key: 'beratung', name: 'Lernberatung', color: '#7c3aed', nurZugewiesen: true },
];
const code = schneide('function hjDetailHtml(s, subjectKey) {');
const bau = (student, subjectKey) => new Function('hjSelected', 'orderedSubjects', 'subjectByKey', `
  const escHtml = t => String(t == null ? '' : t);
  const hjFmtDate = d => d || ''; const hjLtTitle = k => k || '';
` + code + '\nreturn hjDetailHtml;')('2627_1', () => FAECHER, k => FAECHER.find(f => f.key === k))(student, subjectKey);

const leer = { bySubject: {}, lzk: [], stationDetails: [], stationsCompleted: 0 };
const ich = k => ({ subjectKurs: k, byHalbjahr: { '2627_1': leer } });

let h = bau(ich({ mathe: 'E', englisch: 'G' }), null);
pruefe('H1 die Kursung steht neben dem Fach',
  h.includes('>E-Kurs<') && h.includes('>G-Kurs<'), h.slice(0, 600));
pruefe('H1b E gruen, G gelb - wie sonst auch im Projekt',
  h.includes('pill-green" style="font-size:10px;">E-Kurs') && h.includes('pill-yellow" style="font-size:10px;">G-Kurs'), '');
pruefe('H2 Lernberatung ist nicht gekurst und bekommt keine Marke',
  (h.match(/-Kurs</g) || []).length === 2, h);

h = bau(ich({ mathe: 'E' }), null);
pruefe('H3 ein Fach ohne Wert bekommt nichts - kein geratenes E',
  (h.match(/-Kurs</g) || []).length === 1, h);
pruefe('H4 ganz ohne Kursungen bleibt alles wie bisher',
  !bau(ich({}), null).includes('-Kurs<'), '');
pruefe('H5 auch ohne das Feld kein Absturz',
  !bau({ byHalbjahr: { '2627_1': leer } }, null).includes('-Kurs<'), '');

h = bau(ich({ mathe: 'G', englisch: 'E' }), 'mathe');
pruefe('H6 im Detail-Fenster (nur ein Fach) steht dessen Kursung',
  h.includes('>G-Kurs<') && !h.includes('>E-Kurs<'), h);

// Server
pruefe('S1 die Halbjahr-Uebersicht liefert die Kursung je Fach',
  srv.includes('subjectKurs: s.subject_kurs || {},'), '');
pruefe('S1b aus user_subject_kurs',
  srv.slice(srv.indexOf('const aktivFilter')).slice(0, 700).includes('FROM user_subject_kurs usk JOIN subjects s ON s.id = usk.subject_id'), '');
pruefe('S2 /api/my-halbjahr reicht sie durch',
  srv.includes('subjectKurs: meRow.subjectKurs || {}'), '');
pruefe('S3 der Aktiv-Filter ist mit dem Alias noch da (NICHT entfernen!)',
  srv.includes("const aktivFilter = onlyUid ? '' : ' AND u.aktiv=true';")
  && srv.includes('${aktivFilter}${onlyUid'), '');
pruefe('S3b und der Selbst-Aufruf bleibt davon ausgenommen',
  srv.includes("onlyUid ? '' :"), '');

// Frontend-Verdrahtung
pruefe('V1 die eigene Ansicht reicht die Kursung an die Auswertung weiter',
  html.includes('subjectKurs: d.subjectKurs || me.subjectKurs || {},'), '');
console.log('\n' + ok + ' Pruefungen bestanden.');
