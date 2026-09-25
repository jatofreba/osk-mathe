// Reiter "LZK" der Lernbegleitung + Kalender-Kopf ohne doppelte Monatsleiste.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => {
  if (!b) { console.error('FAIL: ' + n + (e !== undefined ? '\n      ' + String(typeof e === 'string' ? e : JSON.stringify(e)).slice(0, 900) : '')); process.exit(1); }
  ok++; console.log('OK  ' + n);
};
const schneide = kopf => { const a = html.indexOf(kopf); if (a < 0) throw new Error('fehlt: ' + kopf); return html.slice(a, html.indexOf('\n}\n', a) + 2); };

// ── Umgebung: echte Funktionen, Attrappen fuer DOM und Daten ──────────────────
const funktionen = ['function escHtml(s) {', 'function subjectByKey(key) {', 'function subjectById(id) {',
  'function calDateStr(d) {', 'function halbjahrForDateClient(d) {', 'function lzkTitel(l) {', 'function lzkErgebnisPill(l) {',
  'function lzkBewertenKnoepfe(l) {', 'function calLzkZeile(l, isAdmin) {', 'function lzkFaecher() {',
  'function lzkUeOeffnen() {', 'function lzkUeFachAuswahl() {', 'async function setMyDefaultSubject(value) {',
  'async function loadLzkUebersicht() {', 'function lzkUeTag(iso) {', 'function renderLzkUebersicht() {', 'function calReload() {']
  .map(schneide).join('\n');
const umgebung = (me, lzk, subjects) => {
  const el = {};
  const document = { getElementById: id => el[id] || null };
  el['lzk-ue-liste'] = { innerHTML: '' };
  el['bar-default-subject'] = { value: '' };
  el['lzk-ue-fach'] = { innerHTML: '', _v: '', get value() { return this._v; },
    set value(v) { const ids = [...this.innerHTML.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]); this._v = ids.includes(v) ? v : ''; } };
  const aufrufe = [];
  const fetch = async url => ({ ok: true, json: async () => (url === '/api/calendar' ? { slots: [], deadlines: [], lzk } : [{ id: 7, username: 'ga.em' }]) });
  const f = new Function('document', 'me', 'fetch', 'aufrufe', `
    let calData = { slots: [], deadlines: [], lzk: ${JSON.stringify(lzk)} };
    let calClassmates = [];
    let subjectsMeta = ${JSON.stringify(subjects)};
    let _lzkUeFach = null, _lzkUeSuche = '';
    async function loadSubjectsMeta() { return subjectsMeta; }
    function hjLtTitle(k) { return k === 'lerntheke_kreise_v11' ? 'Kreise und Zylinder' : k; }
    function loadCalendar() { aufrufe.push('loadCalendar'); }
    function loadMyWeek() { aufrufe.push('loadMyWeek'); }
    function renderHalbjahr() { aufrufe.push('renderHalbjahr'); }
    ${funktionen}
    return {
      renderLzkUebersicht, calReload, lzkUeTag,
      loadLzkUebersicht, lzkUeOeffnen, setMyDefaultSubject,
      setze: (fach, suche) => { _lzkUeFach = fach; _lzkUeSuche = suche || ''; },
      fach: () => _lzkUeFach, klassen: () => calClassmates, daten: () => calData,
    };`);
  return { api: f(document, me, fetch, aufrufe), el, aufrufe };
};

const MATHE = 1, DEUTSCH = 3;
const SUBJ = [{ id: 1, key: 'mathe', name: 'Mathe', color: '#2563eb' }, { id: 2, key: 'englisch', name: 'Englisch', color: '#ca8a04' },
  { id: 3, key: 'deutsch', name: 'Deutsch', color: '#dc2626' }, { id: 4, key: 'lernberatung', name: 'Lernberatung', color: '#7c3aed', nurZugewiesen: true }];
const tag = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const HEUTE = tag(0);
let nr = 100;
const lzk = (username, userId, datumIso, extra = {}) => ({ id: ++nr, userId, username, typ: 'Basis', lerntheke: null, datum: datumIso,
  datumIso, status: 'ausstehend', pokale: 0, subjectId: MATHE, thema: 'Kreise', anfrage: null, herkunft: 'lernbegleitung', ...extra });

const daten = [
  lzk('ga.em', 7, tag(5)),                                                          // anstehend
  lzk('li.po', 8, tag(5), { thema: 'Glück & Zufall' }),                             // anstehend, gleicher Tag
  lzk('ju.br', 9, tag(9), { typ: 'Aufbau', thema: 'Satz des Pythagoras' }),         // anstehend
  lzk('ga.em', 7, tag(-2)),                                                          // zu bewerten
  lzk('ida.ja', 10, HEUTE, { thema: 'Terme 1' }),                                    // zu bewerten (heute)
  lzk('me.vo', 11, tag(3), { anfrage: 'offen', herkunft: 'selbst', thema: 'Volumen' }),  // Anfrage mit Wunsch
  lzk('fi.kl', 12, null, { anfrage: 'offen', herkunft: 'selbst', thema: 'Parabeln' }),   // Anfrage ohne Datum
  lzk('lu.ei', 13, tag(4), { anfrage: 'abgelehnt', herkunft: 'selbst' }),            // abgelehnt -> nirgends
  lzk('ol.ne', 14, tag(-1), { status: 'bestanden', pokale: 2 }),                     // bewertet
  lzk('ol.ne', 14, '2024-03-01', { status: 'bestanden', pokale: 3, thema: 'Uralt' }),  // anderes Halbjahr -> nicht
  lzk('ga.em', 7, tag(7), { subjectId: DEUTSCH, typ: 'LZK', thema: 'Erörterung' }),  // Deutsch
  lzk('ma.ba', 15, null, { thema: 'Ohne Datum' }),                                    // fest, ohne Datum -> anstehend
];
// die Kopie aus dem alten Fehler: freie LZK + Lerntheken-LZK am selben Tag, gleiche Person, gleiches Fach
const DOPPEL = tag(6);
daten.push(lzk('va.po', 16, DOPPEL, { thema: 'Kreise' }), lzk('va.po', 16, DOPPEL, { lerntheke: 'lerntheke_kreise_v11', thema: '' }));
daten.push(lzk('va.po', 16, DOPPEL, { subjectId: DEUTSCH, typ: 'LZK', thema: 'Gedicht' }));   // anderes Fach, gleicher Tag

const abschnitte = h => {
  const teile = {};
  const re = /<h3 class="lzk-ue-kopf">([^<]+) <span class="pill">(\d+)<\/span><\/h3>/g;
  let m, letzte = null, pos = [];
  while ((m = re.exec(h))) pos.push({ titel: m[1].trim(), n: +m[2], start: m.index, ende: re.lastIndex });
  const bew = h.indexOf('<details class="lzk-ue-bewertet">');
  pos.forEach((p, i) => { teile[p.titel] = { n: p.n, html: h.slice(p.ende, i + 1 < pos.length ? pos[i + 1].start : (bew >= 0 ? bew : h.length)) }; });
  if (bew >= 0) {
    const n = +(/Bewertet in diesem Halbjahr <span class="pill">(\d+)/.exec(h.slice(bew)) || [])[1];
    teile['✅ Bewertet in diesem Halbjahr'] = { n, html: h.slice(bew) };
  }
  return teile;
};

(async () => {
  const LB = { role: 'admin', userId: 1, defaultSubjectId: MATHE };

  // ── 1) Laden: Daten, Personen, Fach-Auswahl ─────────────────────────────────
  let u = umgebung(LB, [], SUBJ);
  await u.api.loadLzkUebersicht();
  pruefe('L1 geladen wird wie im Kalender (/api/calendar + Personen fuer "eintragen")',
    u.api.daten().lzk !== undefined && u.api.klassen().length === 1, u.api.klassen());
  pruefe('L2 Fach-Auswahl: "Alle Fächer" + Faecher mit LZK (ohne Lernberatung)',
    u.el['lzk-ue-fach'].innerHTML.startsWith('<option value="">Alle Fächer</option>')
    && u.el['lzk-ue-fach'].innerHTML.includes('>Deutsch<') && !u.el['lzk-ue-fach'].innerHTML.includes('Lernberatung'), u.el['lzk-ue-fach'].innerHTML);
  pruefe('L3 vorgewaehlt ist das Standard-Fach der Lernbegleitung', u.api.fach() === String(MATHE), u.api.fach());
  u = umgebung({ role: 'admin', userId: 1, defaultSubjectId: 4 }, [], SUBJ);
  await u.api.loadLzkUebersicht();
  pruefe('L4 Standard-Fach ohne LZK (Lernberatung): dann alle Faecher', u.api.fach() === '', u.api.fach());

  // ── 2) Die Abschnitte ───────────────────────────────────────────────────────
  u = umgebung(LB, daten, SUBJ);
  u.api.setze(String(MATHE), '');
  u.api.renderLzkUebersicht();
  let h = u.el['lzk-ue-liste'].innerHTML;
  let t = abschnitte(h);
  pruefe('A1 drei feste Abschnitte in dieser Reihenfolge, "Bewertet" eingeklappt dahinter',
    Object.keys(t).join('|') === '⏳ Offene Anfragen|✍️ Zu bewerten|📅 Anstehend|✅ Bewertet in diesem Halbjahr', Object.keys(t));
  pruefe('A2 offene Anfragen: mit und ohne Wunschtermin', t['⏳ Offene Anfragen'].n === 2
    && t['⏳ Offene Anfragen'].html.includes('me.vo') && t['⏳ Offene Anfragen'].html.includes('fi.kl'), t['⏳ Offene Anfragen']);
  pruefe('A2b mit "Annehmen" und "Ablehnen"', t['⏳ Offene Anfragen'].html.includes('Annehmen') && t['⏳ Offene Anfragen'].html.includes('Ablehnen'));
  pruefe('A3 zu bewerten: gestern und heute, mit Flammen-Knoepfen',
    t['✍️ Zu bewerten'].n === 2 && t['✍️ Zu bewerten'].html.includes('ida.ja') && t['✍️ Zu bewerten'].html.includes('lzk-pokal-btn'), t['✍️ Zu bewerten']);
  pruefe('A4 anstehend: kuenftige und feste ohne Datum, ohne Flammen-Knoepfe',
    t['📅 Anstehend'].n === 6 && !t['📅 Anstehend'].html.includes('lzk-pokal-btn') && t['📅 Anstehend'].html.includes('ma.ba')
    && t['📅 Anstehend'].html.includes('Verschieben'), t['📅 Anstehend']);
  pruefe('A5 bewertet: nur dieses Halbjahr', t['✅ Bewertet in diesem Halbjahr'].n === 1
    && !h.includes('Uralt'), t['✅ Bewertet in diesem Halbjahr']);
  pruefe('A6 abgelehnte Anfragen stehen nirgends', !h.includes('lu.ei'), '');
  pruefe('A7 zu bewerten: das aeltere zuerst', h.indexOf('ga.em', h.indexOf('✍️ Zu bewerten')) < h.indexOf('ida.ja'), '');
  const anst = t['📅 Anstehend'].html;
  pruefe('A8 nach Tag gruppiert, mit Anzahl bei mehreren', anst.includes(`${u.api.lzkUeTag(tag(5))} · 2 LZK</h4>`)
    && anst.includes(`<h4 class="lzk-ue-tag">${u.api.lzkUeTag(tag(9))}</h4>`), anst.slice(0, 400));
  pruefe('A8b feste LZK ohne Datum am Ende unter "ohne Datum"', anst.lastIndexOf('ohne Datum</h4>') > anst.indexOf(u.api.lzkUeTag(tag(9))), '');
  pruefe('A9 die Zeilen nennen Person und Titel wie im Kalender', anst.includes('<strong>ga.em</strong>') && anst.includes('Basis-LZK · Kreise'), '');

  // ── 3) Fach-Filter und Suche ────────────────────────────────────────────────
  pruefe('F1 im Fach Mathe steht die Deutsch-LZK nicht', !h.includes('Erörterung'), '');
  u.api.setze('', ''); u.api.renderLzkUebersicht(); h = u.el['lzk-ue-liste'].innerHTML;
  pruefe('F2 "Alle Fächer": auch Deutsch', h.includes('Erörterung') && h.includes('Gedicht'), '');
  u.api.setze(String(MATHE), 'ga.'); u.api.renderLzkUebersicht(); h = u.el['lzk-ue-liste'].innerHTML;
  pruefe('F3 Suche nach Name', h.includes('ga.em') && !h.includes('li.po') && !h.includes('ida.ja'), '');
  u.api.setze(String(MATHE), 'GLÜCK'); u.api.renderLzkUebersicht(); h = u.el['lzk-ue-liste'].innerHTML;
  pruefe('F4 Suche nach Thema, Gross/klein egal', h.includes('li.po') && !h.includes('ga.em'), '');
  u.api.setze(String(DEUTSCH), 'zzz'); u.api.renderLzkUebersicht(); h = u.el['lzk-ue-liste'].innerHTML;
  pruefe('F5 leere Abschnitte sagen es, mit Fach', h.includes('Keine offenen Anfragen im Fach Deutsch.') && h.includes('Nichts zu bewerten im Fach Deutsch.'), h.slice(0, 600));

  // ── 4) Moegliche Doppelungen ────────────────────────────────────────────────
  u.api.setze(String(MATHE), 'va.po'); u.api.renderLzkUebersicht(); h = u.el['lzk-ue-liste'].innerHTML;
  const warnungen = h.match(/lzk-ue-doppelt/g) || [];
  pruefe('D1 freie LZK und Lerntheken-Kopie am selben Tag: beide markiert', warnungen.length === 2
    && h.includes('Am selben Tag noch: Basis-LZK · Kreise und Zylinder') && h.includes('Am selben Tag noch: Basis-LZK · Kreise –'), h);
  pruefe('D2 eine LZK in einem anderen Fach am selben Tag ist keine Doppelung', !h.includes('Gedicht'), '');
  u.api.setze('', 'va.po'); u.api.renderLzkUebersicht(); h = u.el['lzk-ue-liste'].innerHTML;
  pruefe('D2b auch bei "Alle Fächer" nicht', (h.match(/lzk-ue-doppelt/g) || []).length === 2, h);
  u.api.setze(String(MATHE), 'li.po'); u.api.renderLzkUebersicht(); h = u.el['lzk-ue-liste'].innerHTML;
  pruefe('D3 zwei Personen am selben Tag sind keine Doppelung', !h.includes('lzk-ue-doppelt'), '');

  // ── 5) Auffrischen nach einer Aktion ────────────────────────────────────────
  const sichtbar = (lzkAn, calAn) => { u.el['view-lzk'] = { style: { display: lzkAn ? 'block' : 'none' } }; u.el['view-calendar'] = { style: { display: calAn ? 'block' : 'none' } }; };
  u.aufrufe.length = 0;
  sichtbar(true, false); u.api.calReload(); await new Promise(r => setTimeout(r, 0));
  pruefe('R1 LZK-Reiter offen: er wird neu geladen (nicht Kalender/Woche)', u.aufrufe.length === 0 && u.el['lzk-ue-liste'].innerHTML.includes('lzk-ue-kopf'), u.aufrufe);
  sichtbar(false, true); u.api.calReload();
  sichtbar(false, false); u.api.calReload();
  pruefe('R2 sonst wie bisher: Kalender bzw. "Meine Woche"', u.aufrufe.join(',') === 'loadCalendar,loadMyWeek', u.aufrufe);

  // ── 6) Verdrahtung ──────────────────────────────────────────────────────────
  pruefe('V1 Reiter "📝 LZK" gibt es, zunaechst verborgen',
    html.includes(`<button type="button" class="tab" id="tab-lzk" style="display:none" onclick="showView('lzk')">📝 LZK</button>`));
  const adminTeil = html.slice(html.indexOf("const tabKlasse = document.getElementById('tab-klasse');"), html.indexOf("if (tabHome) tabHome.style.display = 'none';"));
  pruefe('V2 eingeblendet nur im Lernbegleitungs-Zweig', adminTeil.includes("const tabLzk = document.getElementById('tab-lzk');") && adminTeil.includes("tabLzk.style.display = ''"));
  const sv = schneide('function showView(v) {');
  pruefe('V3 showView kennt die Ansicht und oeffnet sie im Standard-Fach', sv.includes("'calendar','lzk','halbjahr'") && sv.includes("id === 'lzk' ||") && sv.includes("if (v === 'lzk') lzkUeOeffnen();"));

  // ── 6b) Das Standard-Fach zieht mit (wie Halbjahr-Uebersicht und Talks) ──────
  const warte = () => new Promise(r => setTimeout(r, 0));
  const lb = { role: 'admin', userId: 1, defaultSubjectId: MATHE, superAdmin: true };
  const w = umgebung(lb, daten, SUBJ);
  w.el['view-lzk'] = { style: { display: 'block' } };
  w.api.lzkUeOeffnen(); await warte();
  pruefe('S1 geoeffnet wird im Standard-Fach', w.api.fach() === String(MATHE) && w.el['lzk-ue-fach'].value === String(MATHE), w.api.fach());
  w.api.setze('', ''); w.api.renderLzkUebersicht();          // von Hand: "Alle Fächer"
  await w.api.loadLzkUebersicht();                            // wie "↺ Laden" bzw. calReload nach einer Aktion
  pruefe('S2 eine Auswahl von Hand bleibt nach Laden/Aktionen', w.api.fach() === '' && w.el['lzk-ue-liste'].innerHTML.includes('Erörterung'), w.api.fach());
  w.api.lzkUeOeffnen(); await warte();
  pruefe('S3 erneut geoeffnet: wieder das Standard-Fach', w.api.fach() === String(MATHE), w.api.fach());
  w.aufrufe.length = 0;
  await w.api.setMyDefaultSubject(String(DEUTSCH));
  pruefe('S4 oben umgestellt, Reiter offen: springt sofort mit',
    lb.defaultSubjectId === DEUTSCH && w.api.fach() === String(DEUTSCH) && w.el['lzk-ue-fach'].value === String(DEUTSCH)
    && w.el['lzk-ue-liste'].innerHTML.includes('Erörterung') && !w.el['lzk-ue-liste'].innerHTML.includes('Glück'), w.api.fach());
  pruefe('S4b wie bisher wird die Halbjahr-Uebersicht neu gezeichnet, die obere Auswahl nachgezogen',
    w.aufrufe.includes('renderHalbjahr') && w.el['bar-default-subject'].value === String(DEUTSCH), w.aufrufe);
  w.el['view-lzk'].style.display = 'none';
  await w.api.setMyDefaultSubject(String(MATHE));
  pruefe('S5 Reiter zu: nichts gezeichnet, aber beim naechsten Oeffnen gilt das neue Fach',
    w.api.fach() === null && w.el['lzk-ue-fach'].value === String(DEUTSCH), w.api.fach());
  w.el['view-lzk'].style.display = 'block';
  w.api.lzkUeOeffnen(); await warte();
  pruefe('S5b ... und es gilt', w.api.fach() === String(MATHE), w.api.fach());
  await w.api.setMyDefaultSubject('');
  pruefe('S6 "keine Präferenz": alle Faecher', lb.defaultSubjectId === null && w.api.fach() === '', w.api.fach());
  pruefe('V4 die Ansicht hat Eintragen, Laden, Fach, Suche und Liste', ['id="view-lzk"', 'onclick="openLzkEintragModal(null)">+ LZK eintragen', 'onclick="loadLzkUebersicht()"',
    'id="lzk-ue-fach"', 'id="lzk-ue-suche"', 'id="lzk-ue-liste"'].every(x => html.includes(x)));

  // ── 7) Kalender-Kopf ohne doppelte Monatsleiste ─────────────────────────────
  const kalKopf = html.slice(html.indexOf('<div id="view-calendar">'), html.indexOf('<div id="cal-admin-actions"'));
  pruefe('K1 der Kopf hat keine Monatsleiste mehr', !kalKopf.includes('calShiftMonth') && !kalKopf.includes('cal-nav') && kalKopf.includes('📅 Mein Kalender'), kalKopf);
  pruefe('K2 die Leiste ueber dem Raster bleibt (mit Heute)', /<div class="cal-gridnav">[\s\S]*?id="cal-month-label"[\s\S]*?calGoToday\(\)/.test(html));
  pruefe('K3 genau EIN Monatsname, kein label2 mehr', (html.match(/id="cal-month-label"/g) || []).length === 1 && !html.includes('cal-month-label2'));
  pruefe('K4 renderCalendar beschriftet ihn', schneide('function renderCalendar() {').includes("if (label) label.textContent = CAL_MONTHS[calMonth] + ' ' + calYear;"));
  pruefe('K5 .cal-nav-CSS ist weg, die Knopf-Stile bleiben', !html.includes('.cal-nav{') && html.includes('.cal-nav-btn{') && html.includes('.cal-gridnav{'));
  pruefe('K6 Buttons und Untertitel bleiben', html.includes('id="cal-admin-actions"') && html.includes('id="cal-subtitle"'));

  console.log('\n' + ok + ' Pruefungen bestanden.');
})().catch(e => { console.error('FEHLER: ' + e.stack); process.exit(1); });
