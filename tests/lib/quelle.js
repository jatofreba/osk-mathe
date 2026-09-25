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
  const query = async (sql, p) => {
    let r;
    try {
      r = await db.query(sql, p || []);
    } catch (e) {
      // Mehrere Befehle ohne Parameter (der initDB-Stapel) gehen nur im einfachen Protokoll -
      // node-postgres sendet ohne Parameter genauso. pglite.query nimmt immer das erweiterte.
      if (!(e && e.code === '42601' && (!p || !p.length))) throw e;
      const alle = await db.exec(sql);
      r = alle[alle.length - 1] || { rows: [] };
    }
    // pg heisst es rowCount, pglite affectedRows.
    if (r && r.rowCount === undefined) r.rowCount = r.affectedRows ?? (r.rows ? r.rows.length : 0);
    return r;
  };
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
