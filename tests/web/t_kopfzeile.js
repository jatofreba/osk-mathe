// Prueft die Kursung je Fach in der Kopfzeile.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
const srv = lies('server.js');
let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };

const FAECHER = [
  { key: 'mathe', name: 'Mathe', color: '#2563eb', nurZugewiesen: false },
  { key: 'englisch', name: 'Englisch', color: '#ca8a04', nurZugewiesen: false },
  { key: 'deutsch', name: 'Deutsch', color: '#dc2626', nurZugewiesen: false },
  { key: 'beratung', name: 'Lernberatung', color: '#999', nurZugewiesen: true },
];
const a = html.indexOf("  if (me.role === 'student') {");
const code = html.slice(a, html.indexOf('\n  }\n', a) + 4);
function bau(me) {
  const el = { innerHTML: '', className: '', style: {} };
  new Function('me', 'angebotsFaecher', 'document', `
    const escHtml = t => String(t == null ? '' : t);
  ` + code)(me, () => FAECHER, { getElementById: () => el });
  return el;
}

let el = bau({ role: 'student', kurs: 'E', subjectKurs: { mathe: 'E', englisch: 'G', deutsch: 'E' } });
pruefe('K1 jedes Angebotsfach steht mit seiner eigenen Kursung da',
  (el.innerHTML.match(/bar-kurs-fach/g) || []).length === 3, el.innerHTML);
pruefe('K1b mit Fach-Badge in Fachfarbe',
  el.innerHTML.includes('background:#2563eb') && el.innerHTML.includes('background:#ca8a04'), el.innerHTML);
pruefe('K2 die Kursung steht je Fach richtig',
  el.innerHTML.includes('Mathe: E-Kurs') && el.innerHTML.includes('Englisch: G-Kurs'), el.innerHTML);
pruefe('K3 Lernberatung ist nicht gekurst und taucht nicht auf',
  !el.innerHTML.includes('Lernberatung'), el.innerHTML);
pruefe('K4 kein einzelnes "E-Kurs" mehr, das fuer alles gilt',
  !/>[EG]-Kurs</.test(el.innerHTML), el.innerHTML);

el = bau({ role: 'student', kurs: 'G', subjectKurs: {} });
pruefe('K5 ohne fachbezogene Werte faellt Mathe auf users.kurs zurueck',
  el.innerHTML.includes('Mathe: G-Kurs') && (el.innerHTML.match(/bar-kurs-fach/g) || []).length === 1, el.innerHTML);

el = bau({ role: 'student', subjectKurs: {} });
pruefe('K6 ohne jede Kursung bleibt die Marke unsichtbar', el.style.display === 'none', JSON.stringify(el));

el = bau({ role: 'student', kurs: 'E', subjectKurs: { mathe: 'E', englisch: 'G' } });
pruefe('K7 ein Fach ohne Wert wird ausgelassen, nicht erfunden',
  (el.innerHTML.match(/bar-kurs-fach/g) || []).length === 2 && !el.innerHTML.includes('Deutsch'), el.innerHTML);

// Server
pruefe('S1 /api/me liefert die Kursung je Fach', srv.includes('subjectKurs,'), '');
pruefe('S1b aus user_subject_kurs', srv.includes('FROM user_subject_kurs usk JOIN subjects s ON s.id = usk.subject_id'), '');
pruefe('S2 users.kurs bleibt als Mathe-Spiegel erhalten',
  srv.includes("kurs: kr.rows[0]?.kurs || 'E',"), '');
pruefe('S3 ein Fehler beim Lesen kippt /api/me nicht', srv.slice(srv.indexOf('const skr =')).slice(0, 400).includes('.catch('), '');
console.log('\n' + ok + ' Pruefungen bestanden.');
