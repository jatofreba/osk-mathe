// Laedt server.js als GANZES Modul gegen ein pglite-Postgres - mit Attrappen fuer Express, pg,
// Sessions, bcrypt und git. So laufen die echten Routen samt aller Helfer, und initDB() baut bzw.
// migriert die Datenbank genau wie beim Serverstart.
//
//   const srv = await ladeServer(quelltext, db);          // db = new PGlite()
//   const r = await srv.rufe('get', '/api/calendar', { session: { userId: 3, role: 'student', klasse: 'M3M4' } });
//   r.code, r.body
//
// Schreibzugriffe auf Dateien werden NICHT ausgefuehrt (syncAllStations wuerde sonst beim Start
// Lerntheken-HTML neu schreiben) - sie werden nur gezaehlt: srv.dateiSchreibversuche.
const realFs = require('fs');
const path = require('path');
const { poolAus, WURZEL } = require('./quelle');

const SCHREIBEND = ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'renameSync', 'rename',
  'unlinkSync', 'unlink', 'mkdirSync', 'mkdir', 'rmSync', 'rm', 'copyFileSync', 'copyFile'];

async function ladeServer(quelltext, db) {
  const routen = [];
  let gestartet;
  const bereit = new Promise(res => { gestartet = res; });
  const app = {
    use() {}, set() {},
    listen(port, cb) { if (cb) cb(); gestartet(); return { close() {} }; },
  };
  for (const m of ['get', 'post', 'patch', 'put', 'delete']) {
    app[m] = (pfad, ...handler) => { if (typeof pfad === 'string') routen.push({ m, pfad, handler }); };
  }
  const express = () => app;
  express.json = () => (q, r, n) => n && n();
  express.urlencoded = () => (q, r, n) => n && n();
  express.static = () => (q, r, n) => n && n();
  const session = () => (q, r, n) => n && n();

  const pool = poolAus(db);
  let dateiSchreibversuche = 0;
  const fs = new Proxy(realFs, {
    get(ziel, name) {
      if (SCHREIBEND.includes(name)) return () => { dateiSchreibversuche++; };
      return ziel[name];
    },
  });
  const module = { exports: {} };
  const attrappen = {
    dotenv: { config() {} },
    express,
    bcrypt: { hash: async () => 'x', compare: async () => true, hashSync: () => 'x', compareSync: () => true },
    'express-session': session,
    'connect-pg-simple': () => function PgStore() {},
    pg: { Pool: function Pool() { return pool; } },
    fs,
    path,
    child_process: { execSync: () => 'test' },
  };
  const req = name => {
    if (name in attrappen) return attrappen[name];
    throw new Error('server_im_test: unbekanntes Modul ' + name);
  };
  const fehler = [];
  const alterExit = process.exit;
  process.exit = code => { fehler.push('process.exit(' + code + ')'); };
  const alterLog = console.log, alterWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try {
    new Function('require', 'module', 'exports', '__filename', '__dirname', quelltext)(
      req, module, module.exports, path.join(WURZEL, 'server.js'), WURZEL);
    await Promise.race([bereit, new Promise((_, nein) => setTimeout(() => nein(new Error('initDB kam nicht an: ' + fehler.join(','))), 60000))]);
  } finally {
    process.exit = alterExit; console.log = alterLog; console.warn = alterWarn;
  }

  async function rufe(methode, pfad, { session: sess = {}, body = {}, params = {}, query = {} } = {}) {
    const route = routen.find(r => r.m === methode && r.pfad === pfad);
    if (!route) throw new Error('Route fehlt: ' + methode + ' ' + pfad);
    const antwort = { code: 200, body: undefined };
    const res = {
      status(c) { antwort.code = c; return res; },
      json(b) { antwort.body = b; return res; },
      send(b) { antwort.body = b; return res; },
      type() { return res; }, setHeader() {}, set() { return res; }, end() {}, sendFile() {}, redirect() {},
    };
    // Nur der eigentliche Handler (der letzte) - die Rechtepruefung davor ersetzt die Session.
    await route.handler[route.handler.length - 1]({ session: sess, body, params, query, headers: {} }, res);
    return antwort;
  }
  // Wie der Browser: eine URL ('/api/talking-sessions/5/invite?x=1') statt Muster + params.
  async function rufeUrl(methode, url, { session: sess = {}, body = {} } = {}) {
    const [pfad, suche = ''] = url.split('?');
    const teile = pfad.split('/');
    for (const r of routen) {
      if (r.m !== methode) continue;
      const muster = r.pfad.split('/');
      if (muster.length !== teile.length) continue;
      const params = {};
      if (!muster.every((m, i) => m.startsWith(':') ? (params[m.slice(1)] = decodeURIComponent(teile[i]), true) : m === teile[i])) continue;
      const query = Object.fromEntries(new URLSearchParams(suche));
      return rufe(methode, r.pfad, { session: sess, body, params, query });
    }
    throw new Error('Route fehlt: ' + methode + ' ' + url);
  }
  // fetch() fuer eine Seite aus seite_im_test.js: jede Anfrage geht an die echten Routen, mit der
  // Session, die wer() gerade liefert.
  const fetchFuer = wer => async (url, opt = {}) => {
    const r = await rufeUrl((opt.method || 'GET').toLowerCase(), url,
      { session: wer(), body: opt.body ? JSON.parse(opt.body) : {} });
    return { ok: r.code >= 200 && r.code < 300, status: r.code, json: async () => JSON.parse(JSON.stringify(r.body ?? null)) };
  };
  return { rufe, rufeUrl, fetchFuer, routen, pool, get dateiSchreibversuche() { return dateiSchreibversuche; } };
}

module.exports = { ladeServer };
