#!/usr/bin/env node
// Fuehrt alle Tests aus:  npm test   (oder: node tests/run.js [Filter])
//
//   tests/web/*.js    Oberflaeche und Server-Code: Funktionen aus public/index.html,
//                     lerntheke.js/.css und server.js werden herausgeschnitten und mit
//                     Attrappen ausgefuehrt (kein Browser, kein Server noetig)
//   tests/db/*.mjs    server.js gegen ein echtes Postgres im Prozess (pglite)
//   tests/tool/*.py   das Python-Tool tools/arbeitsstaende (dazu dessen eigener Test)
//
// Jede Suite laeuft in einem eigenen Prozess; Ergebnis ist ihr Exit-Code. Fehlt eine
// Voraussetzung (pglite nicht installiert, kein Python mit openpyxl/tkinter), wird der
// Teil uebersprungen und gemeldet - mit CI=true zaehlt das als Fehler.
// Ein Filter (Teil des Dateinamens) fuehrt nur passende Suiten aus.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HIER = __dirname;
const WURZEL = path.resolve(HIER, '..');
const filter = process.argv[2] || '';
const imCi = !!process.env.CI;

function suiten(ordner, muster) {
  const dir = path.join(HIER, ordner);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => muster.test(f)).sort().map(f => path.join(dir, f));
}

function pythonFinden() {
  for (const kandidat of [['python3'], ['python'], ['py', '-3']]) {
    const r = spawnSync(kandidat[0], [...kandidat.slice(1), '-c', 'import openpyxl, tkinter'], { encoding: 'utf8' });
    if (r.status === 0) return kandidat;
  }
  return null;
}

function pgliteDa() {
  try { require.resolve('@electric-sql/pglite', { paths: [HIER] }); return true; } catch { return false; }
}

const teile = [];
teile.push({ name: 'web', dateien: suiten('web', /^t_.*\.js$/), befehl: ['node'] });
teile.push({ name: 'db', dateien: suiten('db', /^t_.*\.mjs$/), befehl: pgliteDa() ? ['node'] : null,
  fehlt: 'pglite fehlt - einmal "npm install --prefix tests" ausfuehren' });
const py = pythonFinden();
teile.push({ name: 'tool', dateien: [...suiten('tool', /^test_.*\.py$/),
  path.join(WURZEL, 'tools', 'arbeitsstaende', 'app', 'test_arbeitsstaende_data.py')],
  befehl: py, fehlt: 'kein Python 3 mit openpyxl und tkinter gefunden' });

let gruen = 0, rot = 0, uebersprungen = 0;
const fehlerListe = [];
for (const teil of teile) {
  const dateien = teil.dateien.filter(d => !filter || path.basename(d).includes(filter));
  if (!dateien.length) continue;
  console.log(`\n── ${teil.name} (${dateien.length}) ${'─'.repeat(40)}`);
  if (!teil.befehl) {
    console.log(`   übersprungen: ${teil.fehlt}`);
    uebersprungen += dateien.length;
    continue;
  }
  for (const datei of dateien) {
    const r = spawnSync(teil.befehl[0], [...teil.befehl.slice(1), datei], {
      cwd: path.dirname(datei), encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
    });
    const aus = (r.stdout || '') + (r.stderr || '');
    const n = (aus.match(/^(OK|  ok)\b/gm) || []).length;
    const name = path.relative(WURZEL, datei).replace(/\\/g, '/');
    if (r.status === 0) {
      gruen++;
      console.log(`   ✓ ${name}${n ? `  (${n} Prüfungen)` : ''}`);
    } else {
      rot++;
      const zeile = aus.split('\n').find(z => /FAIL|Error|Traceback|AssertionError|FEHLER/.test(z)) || aus.trim().split('\n').pop();
      console.log(`   ✗ ${name}\n       ${zeile}`);
      fehlerListe.push({ name, aus });
    }
  }
}

for (const f of fehlerListe) {
  console.log(`\n══ Ausgabe von ${f.name} (Ende) ══\n` + f.aus.trim().split('\n').slice(-25).join('\n'));
}
console.log(`\n${gruen} Suiten grün, ${rot} rot${uebersprungen ? `, ${uebersprungen} übersprungen` : ''}.`);
process.exit(rot || (imCi && uebersprungen) ? 1 : 0);
