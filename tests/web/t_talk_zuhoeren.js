// Zuhoeren auf der Seite der Schueler:innen (2026-10-14): es zaehlt, wer zugesagt hat - oder von
// der Lernbegleitung als "hat stattgefunden" bewertet ist, auch ohne Antwort auf die Einladung
// (wie talkZuhoerenZaehlt auf dem Server). Ein ✗ ohne Zusage zaehlt nicht.
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); if (a < 0) throw new Error('fehlt: ' + k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };
const api = new Function(schneide('function talkingGroupByHalbjahr(') + schneide('function talkingGroupByHalbjahrFull(')
  + '\nreturn { talkingGroupByHalbjahr, talkingGroupByHalbjahrFull };')();

const e = (name, status, attendedStatus) => ({ name, status, attendedStatus, halbjahr: '2627_1', datum: '2026-10-0' + (name.length % 9 + 1) });
const einladungen = [
  e('zugesagt', 'angenommen', 'ausstehend'),
  e('ohne-antwort-da', 'eingeladen', 'erledigt'),
  e('ohne-antwort-nicht-da', 'eingeladen', 'nicht_erledigt'),
  e('ohne-antwort-offen', 'eingeladen', 'ausstehend'),
  e('abgesagt-doch-da', 'abgelehnt', 'erledigt'),
  e('abgesagt', 'abgelehnt', 'ausstehend'),
];
const namen = gruppen => gruppen.flatMap(g => g.listening.map(i => i.name)).sort().join(',');

pruefe('Z1 Flammen-Zaehlung: zugesagt + nachweislich da (auch ohne Antwort oder trotz Absage)',
  namen(api.talkingGroupByHalbjahr([], einladungen)) === 'abgesagt-doch-da,ohne-antwort-da,zugesagt',
  namen(api.talkingGroupByHalbjahr([], einladungen)));
pruefe('Z2 Detailtabelle: alle ausser Absagen - wer trotz Absage da war, steht drin',
  namen(api.talkingGroupByHalbjahrFull([], einladungen)) === 'abgesagt-doch-da,ohne-antwort-da,ohne-antwort-nicht-da,ohne-antwort-offen,zugesagt',
  namen(api.talkingGroupByHalbjahrFull([], einladungen)));
pruefe('Z3 eine offene Anfrage bleibt draussen', !namen(api.talkingGroupByHalbjahrFull([], [e('anfrage', 'angefragt', 'ausstehend')])));

console.log('\n' + ok + ' Pruefungen bestanden.');
