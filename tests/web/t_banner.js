const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };
const FAECHER = { 1: { name: 'Mathe' }, 2: { name: 'Englisch' } };
const stubs = `const escHtml = t => String(t == null ? '' : t);
  const subjectById = id => FAECHER[id] || { name: '?' };`;
const HEUTE = new Date().toISOString().slice(0, 10);
const code = schneide('function slotVorbei(s) {') + schneide('function awMeinTermin(s) {')
           + schneide('function adminAnfragenHtml() {') + schneide('function adminLzkAnfragenHtml() {') + schneide('function adminSlotAnfragenHtml() {') + schneide('function lzkTitel(l) {');
const bauen = (me, slots) => new Function('FAECHER', 'me', 'calData',
  stubs + code + '\nreturn adminAnfragenHtml;')(FAECHER, me, { slots })();

const anfrage = { id: 12, username: 'joshua', status: 'angefragt' };
const slot = z => Object.assign({ id: 5, subjectId: 1, typ: 'input', datum: HEUTE, uhrzeit: '10:45',
  thema: 'Brüche', presentedStatus: 'ausstehend', invitees: [anfrage] }, z);

const matheLB = { role: 'admin', userId: 7, superAdmin: false };
const superLB = { role: 'admin', userId: 7, superAdmin: true };

pruefe('B1 eigener Termin: die Anfrage steht im Banner',
  bauen(matheLB, [slot({ teacherId: 7 })]).includes('joshua'));
pruefe('B2 Termin einer anderen Lernbegleitung: nicht in meiner Liste',
  bauen(matheLB, [slot({ teacherId: 9, subjectId: 2 })]) === '');
pruefe('B3 auch als Super-Admin nicht - der Banner ist eine To-do-Liste, keine Vollmacht',
  bauen(superLB, [slot({ teacherId: 9, subjectId: 2 })]) === '', 'Englisch-Anfragen landeten beim Mathe-Konto');
pruefe('B4 Altbestand ohne zuständige Person taucht bei niemandem auf',
  bauen(superLB, [slot({ teacherId: null })]) === '');
pruefe('B5 mehrere eigene Termine werden gezählt',
  bauen(matheLB, [slot({ teacherId: 7 }), slot({ id: 6, teacherId: 7 })]).includes('(2)'));
pruefe('B6 fremde Termine zählen nicht mit',
  bauen(superLB, [slot({ teacherId: 7 }), slot({ id: 6, teacherId: 9 })]).includes('(1)'));
pruefe('B7 beim Talk steht das Talk-Symbol, nicht das Fachbüro-Symbol',
  bauen(matheLB, [slot({ teacherId: 7, typ: 'talk' })]).includes('🎤'));
console.log('\n' + ok + ' Pruefungen bestanden.');
