// Fuehrt die echten LZK-Routen aus server.js gegen ein echtes Postgres (pglite) aus.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import quelle from '../lib/quelle.js';

const src = quelle.lies('server.js');
let ok = 0;
const pruefe = (n, b, e) => {
  if (!b) { console.error('FAIL: ' + n + (e !== undefined ? '\n      ' + JSON.stringify(e) : '')); process.exit(1); }
  ok++; console.log('OK  ' + n);
};

// --- Datenbank wie beim Serverstart ---------------------------------------
const a0 = src.indexOf('async function initDB() {');
const s0 = src.indexOf('`', src.indexOf('await pool.query(', a0)) + 1;
const db = new PGlite();
await db.exec(src.slice(s0, src.indexOf('\n  `);', s0)));
const pool = quelle.poolAus(db);
const eins = async (sql, p) => (await db.query(sql, p || [])).rows[0];

const mathe = (await eins(`SELECT id FROM subjects WHERE key='mathe'`)).id;
const deutsch = (await eins(`SELECT id FROM subjects WHERE key='deutsch'`)).id;
const englisch = (await eins(`SELECT id FROM subjects WHERE key='englisch'`)).id;
const beratung = (await eins(`SELECT id FROM subjects WHERE key='lernberatung'`)).id;
const neu = async (name, rolle, klasse = 'M3M4') =>
  (await eins(`INSERT INTO users (username, password_hash, klasse, role) VALUES ($1,'x',$2,$3) RETURNING id`,
    [name, klasse, rolle])).id;
const MERLE = await neu('merle', 'student'), BEN = await neu('ben', 'student');
const FREMD = await neu('fremd', 'student', 'M7M8');
const HERF = await neu('herf', 'admin');

// --- Helfer und Handler aus dem Quelltext --------------------------------
const hilfen = src.slice(src.indexOf("const LZK_STATUS = "), src.indexOf("app.get('/api/lzk',"));
function handler(marke) {
  const a = src.indexOf(marke);
  if (a < 0) throw new Error('nicht gefunden: ' + marke);
  const roh = src.slice(a, src.indexOf('\n});\n', a));
  const koerper = roh.slice(roh.indexOf('{', roh.indexOf('async (req, res)'))) + '\n}';
  return new Function('pool', hilfen + '\nreturn async function (req, res) ' + koerper + ';')(pool);
}
const R = {
  meine:       handler("app.get('/api/lzk', requireLogin"),
  anlegen:     handler("app.post('/api/lzk', requireLogin"),
  zurueck:     handler("app.delete('/api/lzk/:id', requireLogin"),
  lernthekeT:  handler("app.post('/api/lzk/termin', requireLogin"),
  adminListe:  handler("app.get('/api/admin/lzk', requireAdmin"),
  adminSetzen: handler("app.post('/api/admin/lzk', requireAdmin"),
  adminNeu:    handler("app.post('/api/admin/lzk/eintrag', requireAdmin"),
  adminAendern:handler("app.patch('/api/admin/lzk/:id', requireAdmin"),
  adminWeg:    handler("app.delete('/api/admin/lzk/:id', requireAdmin"),
  kalender:    handler("app.get('/api/calendar', requireLogin"),
  fach:        handler("app.post('/api/admin/subjects/:id', requireAdmin"),
};
const rufe = async (h, { session, body = {}, params = {} }) => {
  const a = { code: 200, body: null };
  a.status = c => { a.code = c; return a; };
  a.json = b => { a.body = b; return a; };
  await h({ session, body, params, query: {} }, a);
  return a;
};
const S = uid => ({ userId: uid, role: 'student', klasse: 'M3M4' });
const ADMIN = { userId: HERF, role: 'admin', klasse: 'M3M4' };
const HEUTE = new Date().toISOString().slice(0, 10);
const tag = n => { const d = new Date(HEUTE + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const zeile = id => eins(`SELECT *, to_char(datum,'YYYY-MM-DD') AS d FROM lzk WHERE id=$1`, [id]);

// =========================================================================
// 1) Schueler:in legt an / fragt an
// =========================================================================
{
  // Schueler:innen legen LZK-Termine nie selbst fest - es entsteht immer eine Anfrage.
  const r = await rufe(R.anlegen, { session: S(MERLE), body: { subjectId: deutsch, datum: tag(5), thema: 'Erörterung' } });
  pruefe('S1 eine Schueler:in fragt eine LZK an - nie ein fester Termin', r.code === 200 && r.body.id && r.body.anfrage === 'offen', r.body);
  const z = await zeile(r.body.id);
  pruefe('S1b Deutsch, ohne Lerntheke, mit Thema und Wunschtermin',
    z.subject_id === deutsch && z.lerntheke === null && z.thema === 'Erörterung' && z.d === tag(5)
    && z.herkunft === 'selbst' && z.anfrage === 'offen' && z.status === 'ausstehend', z);
  const direkt = await rufe(R.anlegen, { session: S(MERLE), body: { subjectId: deutsch, datum: tag(5), anfragen: false } });
  pruefe('S1c auch wer "nicht anfragen" schickt, fragt an', direkt.body.anfrage === 'offen' && (await zeile(direkt.body.id)).anfrage === 'offen', direkt.body);

  const f = await rufe(R.anlegen, { session: S(MERLE), body: { subjectId: deutsch, thema: 'x' } });
  pruefe('S2 ohne Wunschtermin geht die Anfrage trotzdem', f.code === 200 && (await zeile(f.body.id)).datum === null, f.body);
  const v = await rufe(R.anlegen, { session: S(MERLE), body: { subjectId: deutsch, datum: tag(-1), thema: 'x' } });
  pruefe('S3 ein Termin in der Vergangenheit wird abgelehnt', v.code === 409, v);
  const u = await rufe(R.anlegen, { session: S(MERLE), body: { subjectId: deutsch, datum: '24.09.2026' } });
  pruefe('S4 ein ungueltiges Datumsformat wird abgelehnt', u.code === 400, u);
  const b = await rufe(R.anlegen, { session: S(MERLE), body: { subjectId: beratung, datum: tag(3) } });
  pruefe('S5 in der Lernberatung legt man nichts selbst an', b.code === 403, b);
  const a = await rufe(R.anlegen, { session: ADMIN, body: { subjectId: deutsch, datum: tag(3) } });
  pruefe('S6 diese Route ist nur fuer Schueler:innen', a.code === 403, a);

  // Anfrage: ausdruecklich oder durch den Fach-Modus
  const q = await rufe(R.anlegen, { session: S(MERLE), body: { subjectId: englisch, thema: 'Unit 3', anfragen: true } });
  pruefe('S7 eine Anfrage darf ohne Wunschdatum kommen', q.code === 200 && q.body.anfrage === 'offen', q.body);
  const qz = await zeile(q.body.id);
  pruefe('S7b sie ist als offene Anfrage gespeichert', qz.anfrage === 'offen' && qz.datum === null, qz);

  // Der Fach-Modus (direkt/anfrage) ist seit der Regel "immer anfragen" ohne Wirkung:
  // er wird weder gespeichert noch beachtet.
  const m = await rufe(R.fach, { session: ADMIN, params: { id: englisch },
    body: { defaultOrt: 'Englisch-Fachbüro', defaultDauer: 45, pflichtPraesentieren: 1, pflichtZuhoeren: 2,
            optionalPraesentieren: 2, optionalZuhoeren: 1, lzkModus: 'anfrage' } });
  const modus = await eins(`SELECT lzk_modus FROM subjects WHERE id=$1`, [englisch]);
  pruefe('S8 ein mitgeschickter LZK-Modus wird nicht mehr gespeichert', m.code === 200 && modus.lzk_modus === 'direkt', modus);
  const trotzdem = await rufe(R.anlegen, { session: S(BEN), body: { subjectId: englisch, datum: tag(4), thema: 'Test' } });
  pruefe('S8b in jedem Fach wird aus jedem Wunsch eine Anfrage', trotzdem.body.anfrage === 'offen', trotzdem.body);
}

// =========================================================================
// 2) Zuruecknehmen
// =========================================================================
{
  const r = await rufe(R.anlegen, { session: S(BEN), body: { subjectId: deutsch, datum: tag(6), thema: 'weg' } });
  const fremd = await rufe(R.zurueck, { session: S(MERLE), params: { id: r.body.id } });
  pruefe('Z1 fremde LZK kann niemand zuruecknehmen', fremd.code === 404, fremd);
  const ja = await rufe(R.zurueck, { session: S(BEN), params: { id: r.body.id } });
  pruefe('Z2 die eigene schon', ja.code === 200 && !(await zeile(r.body.id)), ja);

  const vonLb = await rufe(R.adminNeu, { session: ADMIN, body: { userId: BEN, subjectId: deutsch, datum: tag(7), thema: 'LB' } });
  const nein = await rufe(R.zurueck, { session: S(BEN), params: { id: vonLb.body.id } });
  pruefe('Z3 was die Lernbegleitung angelegt hat, bleibt stehen', nein.code === 409, nein);

  // Ein bestaetigter eigener Termin gehoert nicht mehr der Schueler:in allein.
  const best = await rufe(R.anlegen, { session: S(BEN), body: { subjectId: deutsch, datum: tag(6), thema: 'bestaetigt' } });
  await rufe(R.adminAendern, { session: ADMIN, params: { id: best.body.id }, body: { anfrage: 'annehmen' } });
  const bestNein = await rufe(R.zurueck, { session: S(BEN), params: { id: best.body.id } });
  pruefe('Z3b einen bestaetigten Termin nimmt die Schueler:in nicht selbst zurueck',
    bestNein.code === 409 && !!(await zeile(best.body.id)), bestNein.body);

  await db.query(`INSERT INTO lzk (user_id, lerntheke, typ, status, pokale, subject_id) VALUES ($1,'k','Basis','ausstehend',0,$2)`, [BEN, mathe]);
  const lt = await eins(`SELECT id FROM lzk WHERE user_id=$1 AND lerntheke='k'`, [BEN]);
  const ltNein = await rufe(R.zurueck, { session: S(BEN), params: { id: lt.id } });
  pruefe('Z4 Lerntheken-LZK laufen weiter ueber die Lerntheke', ltNein.code === 409, ltNein);
}

// =========================================================================
// 3) Lerntheken-Weg (Mathe) wie bisher
// =========================================================================
{
  const r = await rufe(R.lernthekeT, { session: S(MERLE), body: { lerntheke: 'kreise-und-zylinder', typ: 'Basis', datum: tag(2) } });
  const z = await eins(`SELECT subject_id, anfrage, to_char(datum,'YYYY-MM-DD') d FROM lzk WHERE user_id=$1 AND lerntheke='kreise-und-zylinder'`, [MERLE]);
  pruefe('L1 die Lerntheke fragt den Termin an - als Mathe, als offene Anfrage',
    r.code === 200 && z.subject_id === mathe && z.d === tag(2) && z.anfrage === 'offen', z);
  const vorbei = await rufe(R.lernthekeT, { session: S(MERLE), body: { lerntheke: 'kreise-und-zylinder', typ: 'Aufbau', datum: tag(-1) } });
  pruefe('L1b ein Wunschtermin in der Vergangenheit geht nicht', vorbei.code === 409, vorbei.body);
  // Bestaetigt, dann ein neuer Wunsch: wieder eine Anfrage
  const lzId = (await eins(`SELECT id FROM lzk WHERE user_id=$1 AND lerntheke='kreise-und-zylinder' AND typ='Basis'`, [MERLE])).id;
  await rufe(R.adminAendern, { session: ADMIN, params: { id: lzId }, body: { anfrage: 'annehmen' } });
  await rufe(R.lernthekeT, { session: S(MERLE), body: { lerntheke: 'kreise-und-zylinder', typ: 'Basis', datum: tag(3) } });
  const z2 = await eins(`SELECT anfrage, to_char(datum,'YYYY-MM-DD') d FROM lzk WHERE id=$1`, [lzId]);
  pruefe('L1c ein neuer Wunsch nach der Bestaetigung ist wieder eine Anfrage', z2.anfrage === 'offen' && z2.d === tag(3), z2);
  await db.query(`UPDATE lzk SET status='bestanden', pokale=2 WHERE id=$1`, [lzId]);
  const bewertet = await rufe(R.lernthekeT, { session: S(MERLE), body: { lerntheke: 'kreise-und-zylinder', typ: 'Basis', datum: tag(4) } });
  const z3 = await eins(`SELECT status, pokale, to_char(datum,'YYYY-MM-DD') d FROM lzk WHERE id=$1`, [lzId]);
  pruefe('L1d eine bewertete LZK aendert die Lerntheke nicht mehr', bewertet.code === 409 && z3.d === tag(3) && z3.pokale === 2, z3);
  await db.query(`UPDATE lzk SET status='ausstehend', pokale=0, anfrage=NULL, datum=$2 WHERE id=$1`, [lzId, tag(2)]);
  const meine = await rufe(R.meine, { session: S(MERLE) });
  const lt = meine.body.find(l => l.lerntheke === 'kreise-und-zylinder');
  pruefe('L2 /api/lzk liefert die Felder, die die Lerntheke liest, unveraendert',
    lt && lt.typ === 'Basis' && 'datum' in lt && 'status' in lt && 'pokale' in lt, lt);
  pruefe('L2b und die neuen dazu', lt.subjectId === mathe && lt.datumIso === tag(2) && 'anfrage' in lt, lt);
  pruefe('L3 /api/lzk zeigt nur die eigenen', meine.body.every(l => l.userId === MERLE), meine.body.map(l => l.userId));
}

// =========================================================================
// 4) Admin: Lerntheken-LZK setzen - nur mitgeschickte Felder
// =========================================================================
{
  const set = body => rufe(R.adminSetzen, { session: ADMIN, body: { userId: MERLE, lerntheke: 'kreise-und-zylinder', typ: 'Basis', ...body } });
  const hole = () => eins(`SELECT status, pokale, to_char(datum,'YYYY-MM-DD') d FROM lzk WHERE user_id=$1 AND lerntheke='kreise-und-zylinder' AND typ='Basis'`, [MERLE]);

  await set({ status: 'bestanden', pokale: 2 });
  let z = await hole();
  pruefe('A1 Ergebnis setzen', z.status === 'bestanden' && z.pokale === 2 && z.d === tag(2), z);

  await set({ datum: tag(9) });
  z = await hole();
  pruefe('A2 nur ein neues Datum setzt das Ergebnis NICHT mehr zurueck',
    z.status === 'bestanden' && z.pokale === 2 && z.d === tag(9), z);

  await set({ pokale: 3 });
  z = await hole();
  pruefe('A3 nur Flammen: Datum und Status bleiben', z.status === 'bestanden' && z.pokale === 3 && z.d === tag(9), z);

  await set({ datum: tag(9), status: 'bestanden', pokale: 3 });
  z = await hole();
  pruefe('A4 der Aufruf des Python-Tools (alle Felder) aendert nichts Unerwartetes',
    z.status === 'bestanden' && z.pokale === 3, z);

  await set({ status: 'nicht_bestanden' });
  z = await hole();
  pruefe('A5 nicht bestanden traegt keine Flammen', z.status === 'nicht_bestanden' && z.pokale === 0, z);

  await set({ pokale: 1 });
  z = await hole();
  pruefe('A6 Flammen vergeben heisst bestanden', z.status === 'bestanden' && z.pokale === 1, z);

  const falsch = await set({ status: 'super' });
  pruefe('A7 ein unbekannter Status wird abgewiesen', falsch.code === 400, falsch);
  const fremd = await rufe(R.adminSetzen, { session: ADMIN, body: { userId: FREMD, lerntheke: 'x', typ: 'Basis', pokale: 3 } });
  pruefe('A8 fuer eine fremde Lerngruppe wird nichts geschrieben', fremd.code === 404, fremd);

  const leer = await rufe(R.adminSetzen, { session: ADMIN, body: { userId: BEN, lerntheke: 'lineare-funktionen', typ: 'Aufbau', datum: tag(3) } });
  const lz = await eins(`SELECT status, pokale, subject_id FROM lzk WHERE user_id=$1 AND lerntheke='lineare-funktionen'`, [BEN]);
  pruefe('A9 ein neuer Eintrag startet ausstehend, ohne Flammen, als Mathe',
    leer.code === 200 && lz.status === 'ausstehend' && lz.pokale === 0 && lz.subject_id === mathe, lz);
}

// =========================================================================
// 5) Admin: freie LZK anlegen, aendern, Anfragen entscheiden, loeschen
// =========================================================================
{
  const n = await rufe(R.adminNeu, { session: ADMIN, body: { userId: MERLE, subjectId: englisch, datum: tag(8), thema: 'Vokabeln' } });
  const z = await zeile(n.body.id);
  pruefe('F1 die Lernbegleitung legt eine freie LZK an',
    n.code === 200 && z.herkunft === 'lernbegleitung' && z.lerntheke === null && z.subject_id === englisch && z.anfrage === null, z);
  const ohne = await rufe(R.adminNeu, { session: ADMIN, body: { userId: MERLE, subjectId: englisch } });
  pruefe('F1b ohne Datum geht es nicht', ohne.code === 400, ohne);
  const fremd = await rufe(R.adminNeu, { session: ADMIN, body: { userId: FREMD, subjectId: englisch, datum: tag(8) } });
  pruefe('F1c nicht fuer eine fremde Lerngruppe', fremd.code === 404, fremd);

  const p = body => rufe(R.adminAendern, { session: ADMIN, params: { id: n.body.id }, body });
  await p({ pokale: 2 });
  let y = await zeile(n.body.id);
  pruefe('F2 bewerten: Flammen heisst bestanden', y.status === 'bestanden' && y.pokale === 2 && y.d === tag(8) && y.thema === 'Vokabeln', y);
  await p({ thema: 'Vokabeln Unit 4', datum: tag(10) });
  y = await zeile(n.body.id);
  pruefe('F3 Thema/Datum aendern laesst das Ergebnis stehen', y.pokale === 2 && y.thema === 'Vokabeln Unit 4' && y.d === tag(10), y);
  const nix = await p({});
  pruefe('F4 ein leerer Aufruf wird abgewiesen', nix.code === 400, nix);

  // Anfrage ohne Datum: annehmen braucht eines
  const q = await rufe(R.anlegen, { session: S(BEN), body: { subjectId: englisch, thema: 'Grammatik', anfragen: true } });
  const qa = body => rufe(R.adminAendern, { session: ADMIN, params: { id: q.body.id }, body });
  const ohneDatum = await qa({ anfrage: 'annehmen' });
  pruefe('F5 eine Anfrage ohne Datum laesst sich nicht ohne Datum annehmen', ohneDatum.code === 400, ohneDatum);
  const an = await qa({ anfrage: 'annehmen', datum: tag(11) });
  let qz = await zeile(q.body.id);
  pruefe('F5b mit Datum schon - danach ist es ein fester Termin', an.code === 200 && qz.anfrage === null && qz.d === tag(11), qz);
  const nochmal = await qa({ anfrage: 'annehmen' });
  pruefe('F5c eine bereits entschiedene Anfrage laesst sich nicht erneut entscheiden', nochmal.code === 409, nochmal);

  const q2 = await rufe(R.anlegen, { session: S(BEN), body: { subjectId: englisch, datum: tag(12), thema: 'X', anfragen: true } });
  const ab = await rufe(R.adminAendern, { session: ADMIN, params: { id: q2.body.id }, body: { anfrage: 'ablehnen' } });
  pruefe('F6 ablehnen geht', ab.code === 200 && (await zeile(q2.body.id)).anfrage === 'abgelehnt', ab);

  const ltThema = await eins(`SELECT id FROM lzk WHERE user_id=$1 AND lerntheke='kreise-und-zylinder'`, [MERLE]);
  const tt = await rufe(R.adminAendern, { session: ADMIN, params: { id: ltThema.id }, body: { thema: 'x' } });
  pruefe('F7 das Thema einer Lerntheken-LZK ist die Lerntheke', tt.code === 409, tt);

  const fremdeLzk = await eins(`INSERT INTO lzk (user_id, typ, status, pokale, subject_id) VALUES ($1,'LZK','ausstehend',0,$2) RETURNING id`, [FREMD, deutsch]);
  const fp = await rufe(R.adminAendern, { session: ADMIN, params: { id: fremdeLzk.id }, body: { pokale: 3 } });
  const fw = await rufe(R.adminWeg, { session: ADMIN, params: { id: fremdeLzk.id } });
  pruefe('F8 LZK einer fremden Lerngruppe: weder aendern noch loeschen',
    fp.code === 404 && fw.code === 404 && (await zeile(fremdeLzk.id)).pokale === 0, [fp.code, fw.code]);

  const w = await rufe(R.adminWeg, { session: ADMIN, params: { id: q2.body.id } });
  pruefe('F9 loeschen geht in der eigenen Lerngruppe', w.code === 200 && !(await zeile(q2.body.id)), w);
}

// =========================================================================
// 6) Kalender: wer sieht welche LZK?
// =========================================================================
{
  const s = await rufe(R.kalender, { session: S(MERLE) });
  pruefe('K1 der Kalender liefert LZK mit', Array.isArray(s.body.lzk), s.body);
  pruefe('K2 Schueler:innen sehen nur die eigenen', s.body.lzk.length > 0 && s.body.lzk.every(l => l.userId === MERLE),
    s.body.lzk.map(l => l.userId));
  pruefe('K2b ohne fremde Namen', s.body.lzk.every(l => !('username' in l)), '');
  const a = await rufe(R.kalender, { session: ADMIN });
  const leute = new Set(a.body.lzk.map(l => l.username));
  pruefe('K3 die Lernbegleitung sieht die ganze Lerngruppe mit Namen', leute.has('merle') && leute.has('ben'), [...leute]);
  pruefe('K3b aber keine fremde Lerngruppe', !leute.has('fremd'), [...leute]);
  pruefe('K4 jede LZK kommt mit Fach und ISO-Datum', a.body.lzk.every(l => l.subjectId && 'datumIso' in l), a.body.lzk[0]);
}

console.log('\n' + ok + ' Pruefungen bestanden.');
