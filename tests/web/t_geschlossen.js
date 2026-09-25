// Prueft die Serverseite von "Fachbuero fuer weitere Anmeldungen schliessen":
// Migration, Endpunkt, Riegel beim Buchen/Anfragen und der Kalender-Filter.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const srv = lies('server.js');

let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };

// Schneidet einen Express-Handler heraus und macht ihn aufrufbar.
function handler(marke, parameter) {
  const a = srv.indexOf(marke);
  if (a < 0) throw new Error('nicht gefunden: ' + marke);
  const ende = srv.indexOf('\n});\n', a);
  const roh = srv.slice(a, ende);
  // Die schliessende Klammer der Pfeilfunktion steht erst auf der '});'-Zeile,
  // die die Schnittmarke abschneidet - deshalb hier wieder anhaengen.
  const koerper = roh.slice(roh.indexOf('{', roh.indexOf('async (req, res)'))) + '\n' + '}';
  return new Function(...parameter, 'return async function (req, res) ' + koerper + ';');
}

// --- 1) Migration --------------------------------------------------------
{
  const block = srv.slice(srv.indexOf("column_name='geschlossen'") - 200,
                          srv.indexOf("column_name='geschlossen'") + 260);
  pruefe('G1 die Spalte wird additiv und mit eigenem Guard angelegt',
    /IF NOT EXISTS \(SELECT 1 FROM information_schema\.columns[\s\S]*?column_name='geschlossen'\) THEN[\s\S]*?ALTER TABLE talking_slots ADD COLUMN geschlossen BOOLEAN NOT NULL DEFAULT false;/.test(block),
    block);
  pruefe('G1b Standard ist offen - Altbestand aendert sich nicht',
    block.includes('DEFAULT false'), '');
}

// --- 2) Der Endpunkt -----------------------------------------------------
{
  const marke = "app.post('/api/admin/talking-slots/:id/geschlossen'";
  pruefe('G2 es gibt den Endpunkt', srv.includes(marke));
  const teil = srv.slice(srv.indexOf(marke), srv.indexOf('\n});\n', srv.indexOf(marke)));
  pruefe('G2b er ist admin-geschuetzt', teil.includes('requireAdmin'), teil.slice(0, 120));
  pruefe('G2c und fragt mayManageSlot - fremde Termine nur fuer Super-Admins',
    teil.includes('mayManageSlot(req, slot.rows[0].id)'), '');
  pruefe('G2d er greift nur bei Fachbueros', teil.includes("!== 'input'"), '');
  pruefe('G2e und ist auf die eigene Lerngruppe begrenzt', teil.includes('klasse=$2'), '');

  const H = handler(marke, ['pool', 'mayManageSlot']);
  const rufe = [];
  const machPool = (typ, darf) => ({
    query: async (sql, args) => {
      rufe.push({ sql: sql.replace(/\s+/g, ' ').trim(), args });
      if (/SELECT id, typ FROM talking_slots/.test(sql))
        return typ === null ? { rows: [] } : { rows: [{ id: 5, typ }] };
      return { rows: [] };
    },
  });
  const antwort = () => {
    const a = { code: 200, body: null };
    a.status = c => { a.code = c; return a; };
    a.json = b => { a.body = b; return a; };
    return a;
  };

  // schliessen
  rufe.length = 0;
  let r = antwort();
  const darf = async () => ({ ok: true });
  H(machPool('input'), darf)({ params: { id: '5' }, body: { geschlossen: true }, session: { klasse: '9a', userId: 7 } }, r)
    .then(() => {
      pruefe('G3 schliessen wird gespeichert',
        rufe.some(x => /UPDATE talking_slots SET geschlossen=\$1/.test(x.sql) && x.args[0] === true), JSON.stringify(rufe));
      pruefe('G3b und bestaetigt', r.body && r.body.ok === true && r.body.geschlossen === true, JSON.stringify(r.body));
    })
    .then(() => {
      // wieder oeffnen
      rufe.length = 0;
      const r2 = antwort();
      return H(machPool('input'), darf)({ params: { id: '5' }, body: { geschlossen: false }, session: { klasse: '9a', userId: 7 } }, r2)
        .then(() => pruefe('G3c wieder oeffnen geht genauso',
          rufe.some(x => /UPDATE talking_slots SET geschlossen=\$1/.test(x.sql) && x.args[0] === false), JSON.stringify(rufe)));
    })
    .then(() => {
      // Talk -> abgelehnt
      const r3 = antwort();
      return H(machPool('talk'), darf)({ params: { id: '5' }, body: { geschlossen: true }, session: { klasse: '9a', userId: 7 } }, r3)
        .then(() => pruefe('G4 bei einem Talk wird abgelehnt', r3.code === 400, r3.code + ' ' + JSON.stringify(r3.body)));
    })
    .then(() => {
      // fremder Termin -> mayManageSlot verbietet
      const r4 = antwort();
      const darfNicht = async () => ({ ok: false, status: 403, error: 'fremd' });
      return H(machPool('input'), darfNicht)({ params: { id: '5' }, body: { geschlossen: true }, session: { klasse: '9a', userId: 7 } }, r4)
        .then(() => pruefe('G4b ein fremder Termin wird abgewiesen', r4.code === 403, r4.code + ''));
    })
    .then(() => {
      // unbekannter Termin
      const r5 = antwort();
      return H(machPool(null), darf)({ params: { id: '5' }, body: { geschlossen: true }, session: { klasse: '9a', userId: 7 } }, r5)
        .then(() => pruefe('G4c ein unbekannter Termin gibt 404', r5.code === 404, r5.code + ''));
    })
    .then(() => {
      // --- 3) Riegel beim Buchen und Anfragen ---------------------------
      const buchen = srv.slice(srv.indexOf("app.post('/api/talking-sessions',"),
                               srv.indexOf("app.post('/api/talking-sessions/:id/invite'"));
      pruefe('G5 Buchen holt die Spalte', buchen.includes('sl.geschlossen'), '');
      pruefe('G5b und lehnt geschlossene Termine fuer Schueler:innen ab',
        /if \(slotCheck\.rows\[0\]\.geschlossen && req\.session\.role !== 'admin'\)/.test(buchen), '');
      pruefe('G5c die Lernbegleitung darf weiterhin eintragen',
        buchen.includes("req.session.role !== 'admin'"), '');

      const anfrage = srv.slice(srv.indexOf("app.post('/api/talking-slots/:id/request'"),
                                srv.indexOf("app.post('/api/talking-invitations/:id/withdraw'"));
      pruefe('G6 Anfragen holt die Spalte', anfrage.includes('sl.geschlossen'), '');
      pruefe('G6b und wird bei geschlossenen Terminen abgelehnt',
        /if \(s\.geschlossen\) return res\.status\(409\)/.test(anfrage), '');

      const offen = srv.slice(srv.indexOf("app.get('/api/talking-slots/open'"),
                              srv.indexOf("app.get('/api/talking-sessions/mine'"));
      pruefe('G7 die Liste freier Termine laesst geschlossene aus',
        offen.includes('s.geschlossen = false'), '');

      // --- 4) Der Kalender-Filter ---------------------------------------
      const kal = srv.slice(srv.indexOf("app.get('/api/calendar'"),
                            srv.indexOf('// ── Halbjahr-Übersicht'));
      pruefe('G8 der Kalender liefert den Zustand mit', kal.includes('s.geschlossen,'), '');

      const a = kal.indexOf('    })).filter(s => {');
      const filterRoh = kal.slice(kal.indexOf('{', a) + 1, kal.indexOf('\n    });', a));
      const filter = new Function('req', 'nurZugewiesenIds', 's', filterRoh);
      const IDS = new Set([9]);   // 9 = Lernberatung

      const admin = { session: { role: 'admin' } };
      const schueli = { session: { role: 'student' } };
      const fabue = z => Object.assign({ subjectId: 1, geschlossen: false,
        mineAsPresenter: false, mineAsListener: false }, z);

      pruefe('G9 ein offenes Fachbuero kommt bei allen an',
        filter(schueli, IDS, fabue({})) === true, '');
      // Geaendert auf Nutzerwunsch: ein geschlossener Termin bleibt in der
      // Wochenuebersicht stehen, deshalb liefert der Server ihn weiter aus.
      // Aus dem Tagesdetail faellt er ueber die dortige Knopf-Regel heraus.
      pruefe('G9b ein geschlossenes bleibt sichtbar, nur nicht mehr buchbar',
        filter(schueli, IDS, fabue({ geschlossen: true })) === true, '');
      pruefe('G9c wer selbst gebucht hat, behaelt es',
        filter(schueli, IDS, fabue({ geschlossen: true, mineAsPresenter: true })) === true, '');
      pruefe('G9d wer eingeladen ist, ebenso',
        filter(schueli, IDS, fabue({ geschlossen: true, mineAsListener: true })) === true, '');
      pruefe('G9e die Lernbegleitung sieht auch geschlossene',
        filter(admin, IDS, fabue({ geschlossen: true })) === true, '');
      pruefe('G10 die Lernberatungs-Regel gilt unveraendert weiter',
        filter(schueli, IDS, fabue({ subjectId: 9 })) === false
        && filter(schueli, IDS, fabue({ subjectId: 9, mineAsListener: true })) === true, '');

      console.log('\n' + ok + ' Pruefungen bestanden.');
    })
    .catch(e => { console.error('FAIL (Ausnahme): ' + e.message); process.exit(1); });
}
