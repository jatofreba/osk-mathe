// Gemeinsames fuer die Tests: Dateien des Projekts lesen und ein Pool fuer pglite.
const fs = require('fs');
const path = require('path');

const WURZEL = path.resolve(__dirname, '..', '..');

// Liest eine Datei des Projekts (Pfad relativ zur Wurzel) - immer mit LF-Zeilenenden.
// Unter Windows checkt Git mit core.autocrlf=true CRLF aus; die Suiten schneiden
// Funktionen an '\n}\n' heraus und faenden damit nichts mehr.
function lies(rel) {
  return fs.readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n');
}

// Pool-Attrappe fuer ein pglite-Postgres: query() wie pg, connect() fuer Transaktionen
// (pglite hat nur eine Sitzung - BEGIN/COMMIT laufen darin wie in einem echten Client).
function poolAus(db) {
  const query = (sql, p) => db.query(sql, p || []);
  return { query, connect: async () => ({ query, release() {} }) };
}

// Der Schema-Stapel steht als EIN Template-String in initDB() von server.js.
function initDbStapel(src) {
  const a = src.indexOf('async function initDB() {');
  const start = src.indexOf('`', src.indexOf('await pool.query(', a)) + 1;
  const ende = src.indexOf('\n  `);', start);
  if (a < 0 || start <= 0 || ende < 0) throw new Error('initDB-Stapel in server.js nicht gefunden');
  return src.slice(start, ende);
}

module.exports = { WURZEL, lies, poolAus, initDbStapel };
