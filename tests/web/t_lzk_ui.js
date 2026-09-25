// LZK in der Oberflaeche: Kalender, Tagesdetail, Bewerten, Dialog, Anfragen,
// Meine Woche, Fach-Einstellung, Halbjahr. Funktionen werden aus index.html
// geschnitten und mit Attrappen ausgefuehrt.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');

let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e !== undefined ? '\n      ' + (typeof e === 'string' ? e : JSON.stringify(e)) : '')); process.exit(1); } ok++; console.log('OK  ' + n); };
const schneide = k => { const a = html.indexOf(k); if (a < 0) throw new Error('nicht gefunden: ' + k); return html.slice(a, html.indexOf('\n}\n', a) + 2); };

const HEUTE = new Date().toISOString().slice(0, 10);
const tag = n => { const d = new Date(HEUTE + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const FAECHER = [
  { id: 1, key: 'mathe', name: 'Mathe', color: '#2563eb', colorBg: '#eff6ff', nurZugewiesen: false, lzkModus: 'direkt' },
  { id: 2, key: 'englisch', name: 'Englisch', color: '#eab308', colorBg: '#fefce8', nurZugewiesen: false, lzkModus: 'anfrage' },
  { id: 3, key: 'deutsch', name: 'Deutsch', color: '#dc2626', colorBg: '#fef2f2', nurZugewiesen: false, lzkModus: 'direkt' },
  { id: 4, key: 'lernberatung', name: 'Lernberatung', color: '#7c3aed', colorBg: '#f5f3ff', nurZugewiesen: true, lzkModus: 'direkt' },
];
const STUBS = `
  const escHtml = t => String(t == null ? '' : t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const subjectById = id => FAECHER.find(f => f.id === id) || { name: '?', color: '#999', colorBg: '#eee' };
  const hjLtTitle = k => ({ 'kreise-und-zylinder': 'Kreise und Zylinder' })[k] || k;
  const lwIcon = () => '<svg></svg>';
  const formatTeacherShort = u => u;
`;
const LZK_HELFER = ['function calDateStr(d) {', 'function calLzkZeigen(l) {', 'function lzkTitel(l) {',
  'function lzkErgebnisPill(l) {', 'function calLzkChip(lzks, isAdminView) {',
  'function lzkBewertenKnoepfe(l) {', 'function calLzkZeile(l, isAdmin) {'].map(schneide).join('\n');

const lzk = z => Object.assign({ id: 1, userId: 3, username: 'merle', subjectId: 3, datumIso: HEUTE,
  lerntheke: null, typ: 'LZK', thema: 'Erörterung', status: 'ausstehend', pokale: 0, anfrage: null, herkunft: 'selbst' }, z);
const baueMit = (me, extra, rueckgabe, werte = {}) => {
  const namen = ['FAECHER', 'me', ...Object.keys(werte)];
  return new Function(...namen, STUBS + LZK_HELFER + (extra || '') + '\nreturn ' + rueckgabe + ';')(FAECHER, me, ...Object.values(werte));
};
const SCHUELI = { role: 'student', userId: 3 };
const LB = { role: 'admin', userId: 7, defaultSubjectId: 3 };
const LB_OHNE = { role: 'admin', userId: 7, defaultSubjectId: null };

// =========================================================================
// 1) Welche LZK stehen im Kalender?
// =========================================================================
{
  const zeigen = me => baueMit(me, '', 'calLzkZeigen');
  pruefe('K1 eine LZK mit Datum steht im Kalender', zeigen(SCHUELI)(lzk()) === true);
  pruefe('K1b ohne Datum nicht', zeigen(SCHUELI)(lzk({ datumIso: null })) === false);
  pruefe('K1c eine abgelehnte Anfrage nicht', zeigen(SCHUELI)(lzk({ anfrage: 'abgelehnt' })) === false);
  pruefe('K1d eine offene Anfrage mit Wunschtermin schon', zeigen(SCHUELI)(lzk({ anfrage: 'offen' })) === true);
  pruefe('K2 die Lernbegleitung sieht ihr Standard-Fach', zeigen(LB)(lzk({ subjectId: 3 })) === true);
  pruefe('K2b andere Faecher nicht', zeigen(LB)(lzk({ subjectId: 2 })) === false);
  pruefe('K2c ohne Standard-Fach alles', zeigen(LB_OHNE)(lzk({ subjectId: 2 })) === true);

  const items = new Function('calData', 'calImKalenderZeigen', 'calLzkZeigen',
    schneide('function calItemsByDay() {') + '\nreturn calItemsByDay;')(
      { slots: [], deadlines: [], lzk: [lzk({ id: 5 }), lzk({ id: 6, datumIso: null })] }, () => true,
      baueMit(SCHUELI, '', 'calLzkZeigen'))();
  pruefe('K3 calItemsByDay legt die LZK auf ihren Tag', (items[HEUTE] || []).some(i => i.kind === 'lzk' && i.id === 5), items);
  pruefe('K3b LZK ohne Datum landen nirgends', !Object.values(items).flat().some(i => i.id === 6), items);
}

// =========================================================================
// 2) Monatsraster: mehrere LZK werden eine Kachel, eigene Termine bleiben sichtbar
// =========================================================================
{
  const chip = baueMit(LB, '', 'calLzkChip');
  const drei = [lzk({ id: 1, username: 'merle' }), lzk({ id: 2, username: 'ben' }), lzk({ id: 3, username: 'nele' })];
  const h = chip(drei, true);
  pruefe('M1 drei LZK an einem Tag sind EINE Kachel', (h.match(/cal-ev/g) || []).length === 1 && h.includes('3 LZK'), h);
  pruefe('M1b die Namen stehen im Tooltip', h.includes('merle') && h.includes('ben') && h.includes('nele'), h);
  pruefe('M1c eine einzelne LZK zeigt bei der Lernbegleitung den Namen', chip([drei[0]], true).includes('📝 merle'), chip([drei[0]], true));
  pruefe('M1d bei Schueler:innen das Fach', chip([drei[0]], false).includes('Deutsch-LZK'), chip([drei[0]], false));
  pruefe('M1e gestrichelt - sie ist kein gebuchter Termin', h.includes('border-style:dashed'), h);

  const zelle = schneide('function renderCalendar() {');
  pruefe('M2 im Raster stehen LZK oben', /const evs = \(lzks\.length \? calLzkChip\(lzks, isAdminView\) : ''\) \+ rest\.slice\(0, platz\)/.test(zelle), '');
  pruefe('M2b und nehmen nur EINEN Platz, die Termine behalten zwei', zelle.includes('const platz = lzks.length ? 2 : 3;'), '');
  pruefe('M2c "+ mehr" zaehlt nur die uebrigen Termine', zelle.includes('rest.length > platz') && zelle.includes('rest.length - platz'), '');
}

// =========================================================================
// 3) Tagesdetail-Zeile
// =========================================================================
{
  const zeile = me => baueMit(me, '', 'calLzkZeile');
  // Lernbegleitung
  const heute = zeile(LB)(lzk({ id: 9 }), true);
  pruefe('D1 die Lernbegleitung sieht, WER die LZK schreibt', heute.includes('<strong>merle</strong>'), heute);
  pruefe('D1b und kann am Termintag bewerten', heute.includes('lzkBewerten(9, 3)') && heute.includes('lzkBewerten(9, -1)'), heute);
  const zukunft = zeile(LB)(lzk({ id: 9, datumIso: tag(3) }), true);
  pruefe('D1c vor dem Termintag noch nicht', !zukunft.includes('lzkBewerten'), zukunft);
  pruefe('D1d aendern und loeschen geht immer', zukunft.includes('openLzkEintragModal(null, 9)') && zukunft.includes('lzkLoeschen(9)'), zukunft);
  const anfrage = zeile(LB)(lzk({ id: 9, anfrage: 'offen' }), true);
  pruefe('D2 eine Anfrage wird angenommen oder abgelehnt, nicht bewertet',
    anfrage.includes("openLzkEintragModal(null, 9, 'annehmen')") && anfrage.includes("lzkAnfrage(9, 'ablehnen')")
    && !anfrage.includes('lzkBewerten'), anfrage);
  const lt = zeile(LB)(lzk({ id: 9, lerntheke: 'kreise-und-zylinder', typ: 'Basis', thema: '', subjectId: 1 }), true);
  pruefe('D3 eine Lerntheken-LZK traegt Typ und Lerntheke', lt.includes('Basis-LZK · Kreise und Zylinder'), lt);
  // Seit dem Nutzerwunsch "Termin einer LZK verschieben": auch Lerntheken-LZK - dort nur
  // das Datum (siehe G4), das Thema ist die Lerntheke.
  pruefe('D3b auch eine Lerntheken-LZK laesst sich verschieben', lt.includes('openLzkEintragModal(null, 9)') && lt.includes('>Verschieben<'), lt);
  const bewertet = zeile(LB)(lzk({ id: 9, status: 'bestanden', pokale: 2 }), true);
  pruefe('D4 das gesetzte Ergebnis ist markiert', /lzk-pokal-btn active"[^>]*onclick="lzkBewerten\(9, 2\)"/.test(bewertet), bewertet);
  pruefe('D4b und als Flammen sichtbar', bewertet.includes('🔥🔥 bestanden'), bewertet);

  // Schueler:in
  const eigen = zeile(SCHUELI)(lzk({ id: 9 }), false);
  pruefe('D5 Schueler:innen sehen keine Namen', !eigen.includes('<strong>merle</strong>'), eigen);
  // Seit "Schueler:innen fragen nur an": einen BESTAETIGTEN Termin verlegt oder streicht
  // die Lernbegleitung, nicht die Schueler:in selbst.
  pruefe('D5b einen bestaetigten Termin nehmen Schueler:innen nicht selbst zurueck', !eigen.includes('lzkZurueck'), eigen);
  pruefe('D5c eine eigene Anfrage heisst "zurueckziehen"', zeile(SCHUELI)(lzk({ id: 9, anfrage: 'offen' }), false).includes('Anfrage zurückziehen'), '');
  const vonLb = zeile(SCHUELI)(lzk({ id: 9, herkunft: 'lernbegleitung' }), false);
  pruefe('D6 was die Lernbegleitung eingetragen hat, bleibt stehen', !vonLb.includes('lzkZurueck') && vonLb.includes('von der Lernbegleitung eingetragen'), vonLb);
  pruefe('D6b bewertete auch', !zeile(SCHUELI)(lzk({ id: 9, status: 'bestanden', pokale: 1 }), false).includes('lzkZurueck'), '');
  pruefe('D6c Lerntheken-LZK auch', !zeile(SCHUELI)(lzk({ id: 9, lerntheke: 'kreise-und-zylinder', typ: 'Basis' }), false).includes('lzkZurueck'), '');
  pruefe('D7 Schueler:innen bewerten nicht', !eigen.includes('lzkBewerten'), eigen);

  const detail = schneide('function renderCalDetail() {');
  pruefe('D8 das Tagesdetail kennt LZK-Zeilen', detail.includes("if (it.kind === 'lzk') return calLzkZeile(it, isAdmin);"), '');
  pruefe('D8b die Lernbegleitung hat "+ LZK an diesem Tag"', detail.includes('+ LZK an diesem Tag'), '');
  pruefe('D8c Schueler:innen fragen ab heute "+ LZK-Termin für diesen Tag anfragen"',
    detail.includes('calSelected >= calDateStr(new Date())') && detail.includes('+ LZK-Termin für diesen Tag anfragen'), '');
}

// =========================================================================
// 4) Bewerten schickt nur das Ergebnis
// =========================================================================
{
  const aufrufe = [];
  const bew = baueMit(LB, schneide('function lzkBewerten(id, n) {'), 'lzkBewerten',
    { calData: { lzk: [lzk({ id: 9, status: 'bestanden', pokale: 2 }), lzk({ id: 8 })] },
      lzkPatch: (id, body) => aufrufe.push({ id, body }) });
  bew(8, 3);  bew(8, -1);  bew(9, 2);  bew(9, 1);
  pruefe('B1 Flammen: nur pokale', JSON.stringify(aufrufe[0]) === JSON.stringify({ id: 8, body: { pokale: 3 } }), aufrufe[0]);
  pruefe('B2 nicht bestanden: nur der Status', JSON.stringify(aufrufe[1].body) === JSON.stringify({ status: 'nicht_bestanden' }), aufrufe[1]);
  pruefe('B3 nochmal auf das gesetzte Ergebnis: zuruecknehmen', JSON.stringify(aufrufe[2].body) === JSON.stringify({ status: 'ausstehend' }), aufrufe[2]);
  pruefe('B4 anderes Ergebnis: umstellen', JSON.stringify(aufrufe[3].body) === JSON.stringify({ pokale: 1 }), aufrufe[3]);
}

// =========================================================================
// 5) Dialog: was geht an welchen Endpunkt?
// =========================================================================
function dialog(me, calData, calClassmates) {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const el = {};
  const hole = id => {
    if (el[id]) return el[id];
    if (!ids.has(id)) return null;
    return (el[id] = { value: '', textContent: '', innerHTML: '', checked: false, disabled: false, min: '', style: {} });
  };
  const netz = [];
  // Fuer die Suche: die gerenderten Zeilen als kleine Attrappen (data-name, hidden).
  const zeilen = () => [...(el['lzke-personen'] ? el['lzke-personen'].innerHTML : '')
    .matchAll(/data-name="([^"]*)"/g)].map(m => (zeilen.cache[m[1]] = zeilen.cache[m[1]] || { dataset: { name: m[1] }, hidden: false }));
  zeilen.cache = {};
  const code = ['function lzkePersonUmschalten(id, an) {', 'function lzkePersonenZahl() {', 'function lzkePersonenFiltern(text) {',
    'function lzkFaecher() {', 'function lzkeFach() {', 'function lzkeTyp() {', 'function openLzkEintragModal(datum, id, modus) {',
    'function lzkeFachGewechselt() {', 'function lzkeAnfrageGewechselt() {', 'async function submitLzkEintrag() {'].map(schneide).join('\n');
  const api = baueMit(me, 'let _lzkeModus = "neu", _lzkeId = null, _lzkePersonen = new Set();\n' + code,
    '{ openLzkEintragModal, submitLzkEintrag, lzkeFachGewechselt, lzkeAnfrageGewechselt, lzkePersonUmschalten, lzkePersonenFiltern }',
    { calData, calClassmates, subjectsMeta: FAECHER,
      document: { getElementById: hole, querySelectorAll: () => zeilen() },
      openModal: () => {}, closeModal: () => {}, calReload: () => {},
      fetch: async (url, opt) => { netz.push({ url, method: opt.method, body: JSON.parse(opt.body) }); return { ok: true, json: async () => ({ ok: true }) }; } });
  return { api, el: hole, netz, zeilen };
}
(async () => {
  // Schueler:innen fragen IMMER an - einen "nur anfragen"-Haken gibt es nicht mehr.
  let d = dialog(SCHUELI, { lzk: [] }, []);
  d.api.openLzkEintragModal(tag(4));
  pruefe('F1 Schueler:innen sehen keine Personenauswahl', d.el('lzke-person-gruppe').style.display === 'none', '');
  pruefe('F1b vorgewaehlt ist ein Fach ohne Lerntheken', d.el('lzke-fach').value === '2', d.el('lzke-fach').value);
  pruefe('F1c die Lernberatung steht nicht zur Wahl', !d.el('lzke-fach').innerHTML.includes('Lernberatung'), d.el('lzke-fach').innerHTML);
  pruefe('F1d vergangene Tage sind gesperrt', d.el('lzke-datum').min === HEUTE, d.el('lzke-datum').min);
  pruefe('F2 der Dialog heisst "anfragen"', d.el('lzke-title').textContent.includes('anfragen'), d.el('lzke-title').textContent);
  pruefe('F2b das Datum ist ein Wunschtermin', d.el('lzke-datum-lbl').textContent.includes('Wunschtermin'), d.el('lzke-datum-lbl').textContent);
  pruefe('F2c der Knopf heisst "Anfragen"', d.el('lzke-ok').textContent === 'Anfragen', d.el('lzke-ok').textContent);
  pruefe('F2d und der Hinweis sagt, wer bestaetigt', d.el('lzke-hinweis').innerHTML.includes('Lernbegleitung bestätigt'), d.el('lzke-hinweis').innerHTML);
  pruefe('F3 einen Anfrage-Haken gibt es nicht mehr', !html.includes('id="lzke-anfrage"'), '');
  d.el('lzke-fach').value = '3'; d.api.lzkeFachGewechselt();
  d.el('lzke-thema').value = 'Erörterung';
  await d.api.submitLzkEintrag();
  pruefe('F4 die Anfrage geht an /api/lzk',
    d.netz[0].url === '/api/lzk' && d.netz[0].body.subjectId === 3 && d.netz[0].body.datum === tag(4)
    && d.netz[0].body.thema === 'Erörterung' && !('anfragen' in d.netz[0].body), d.netz[0]);
  d.el('lzke-fach').value = '1'; d.api.lzkeFachGewechselt();
  pruefe('F5 bei Mathe steht, dass Lerntheken-LZK in die Lerntheke gehoeren', d.el('lzke-hinweis').innerHTML.includes('Lerntheke'), d.el('lzke-hinweis').innerHTML);

  // Schueler:in fragt ohne Datum an
  d = dialog(SCHUELI, { lzk: [] }, []);
  d.api.openLzkEintragModal('');
  d.el('lzke-fach').value = '2'; d.api.lzkeFachGewechselt();
  await d.api.submitLzkEintrag();
  pruefe('F6 eine Anfrage darf ohne Datum raus', d.netz[0] && d.netz[0].body.datum === null, d.netz[0]);

  // Lernbegleitung legt fuer jemanden an
  d = dialog(LB, { lzk: [] }, [{ id: 3, username: 'merle' }, { id: 4, username: 'ben' }, { id: 5, username: 'xaver' }]);
  d.api.openLzkEintragModal(tag(2));
  const liste = d.el('lzke-personen').innerHTML;
  pruefe('G1 die Lernbegleitung waehlt Personen per Haken',
    d.el('lzke-person-gruppe').style.display !== 'none' && (liste.match(/type="checkbox"/g) || []).length === 3
    && liste.includes('lzkePersonUmschalten(4, this.checked)'), liste);
  pruefe('G1b vorgewaehlt ist ihr Standard-Fach', d.el('lzke-fach').value === '3', d.el('lzke-fach').value);
  pruefe('G1c ihr Knopf heisst "Speichern" - sie legt fest', d.el('lzke-ok').textContent === 'Speichern', d.el('lzke-ok').textContent);
  await d.api.submitLzkEintrag();
  pruefe('G1d ohne Auswahl geht nichts raus', !d.netz.length && d.el('lzke-error').style.display === 'block'
    && d.el('lzke-error').textContent.includes('mindestens eine Person'), d.el('lzke-error').textContent);
  d.api.lzkePersonUmschalten(3, true); d.api.lzkePersonUmschalten(5, true);
  pruefe('G1e der Zaehler zeigt die Auswahl', d.el('lzke-person-zahl').textContent.includes('2 ausgewählt'), d.el('lzke-person-zahl').textContent);
  pruefe('G1f der Knopf sagt, wie viele LZK entstehen', d.el('lzke-ok').textContent === '2 LZK anlegen', d.el('lzke-ok').textContent);
  // Suche blendet aus, die Auswahl bleibt
  d.api.lzkePersonenFiltern('Mer');
  const sichtbar = d.zeilen().filter(z => !z.hidden).map(z => z.dataset.name);
  pruefe('G1g die Suche blendet andere Namen aus (Gross/klein egal)', sichtbar.length === 1 && sichtbar[0] === 'merle', sichtbar);
  d.api.lzkePersonenFiltern('');
  pruefe('G1h leere Suche zeigt wieder alle', d.zeilen().every(z => !z.hidden), '');
  d.api.lzkePersonUmschalten(5, false); d.api.lzkePersonUmschalten(4, true);
  d.el('lzke-thema').value = 'Grammatik';
  await d.api.submitLzkEintrag();
  const b0 = d.netz[0] && d.netz[0].body;
  pruefe('G2 das geht mit allen Ausgewaehlten an /api/admin/lzk/eintrag',
    d.netz[0].url === '/api/admin/lzk/eintrag' && JSON.stringify([...b0.userIds].sort()) === '[3,4]'
    && b0.subjectId === 3 && b0.datum === tag(2) && b0.thema === 'Grammatik', d.netz[0]);
  // Neu oeffnen: keine alte Auswahl uebernehmen
  d.api.openLzkEintragModal(tag(2));
  await d.api.submitLzkEintrag();
  pruefe('G2b ein neues Oeffnen beginnt ohne Auswahl', d.netz.length === 1, d.netz.length);

  // Anfrage annehmen
  d = dialog(LB, { lzk: [lzk({ id: 9, anfrage: 'offen', datumIso: null, username: 'merle' })] }, []);
  d.api.openLzkEintragModal(null, 9, 'annehmen');
  pruefe('G3 Annehmen zeigt kein Thema, aber das Datum', d.el('lzke-thema-gruppe').style.display === 'none', '');
  await d.api.submitLzkEintrag();
  pruefe('G3b ohne Datum wird nicht angenommen', !d.netz.length && d.el('lzke-error').style.display === 'block', d.netz);
  d.el('lzke-datum').value = tag(6);
  await d.api.submitLzkEintrag();
  pruefe('G3c mit Datum: PATCH anfrage=annehmen', d.netz[0].url === '/api/admin/lzk/9' && d.netz[0].method === 'PATCH'
    && d.netz[0].body.anfrage === 'annehmen' && d.netz[0].body.datum === tag(6), d.netz[0]);

  // Aendern einer Lerntheken-LZK: nur das Datum
  d = dialog(LB, { lzk: [lzk({ id: 9, lerntheke: 'kreise-und-zylinder', typ: 'Basis' })] }, []);
  d.api.openLzkEintragModal(null, 9);
  await d.api.submitLzkEintrag();
  pruefe('G4 eine Lerntheken-LZK aendert nur ihr Datum', JSON.stringify(Object.keys(d.netz[0].body)) === '["datum"]', d.netz[0]);

  // =======================================================================
  // 6) Anfragen-Banner
  // =======================================================================
  {
    const calData = { slots: [], lzk: [lzk({ id: 1, anfrage: 'offen', username: 'merle', subjectId: 3, datumIso: null }),
                                        lzk({ id: 2, anfrage: 'offen', username: 'xaver', subjectId: 2 }),
                                        lzk({ id: 3, anfrage: null, username: 'nele' })] };
    const banner = me => baueMit(me, schneide('function adminAnfragenHtml() {') + schneide('function adminLzkAnfragenHtml() {')
      + schneide('function adminSlotAnfragenHtml() {'), 'adminAnfragenHtml',
      { calData, awMeinTermin: () => true, slotVorbei: () => false })();
    const h = banner(LB);
    pruefe('A1 LZK-Anfragen stehen im Banner der Lernbegleitung', h.includes('Offene LZK-Anfragen (1)') && h.includes('merle'), h);
    pruefe('A1b nur die des eigenen Fachs', !h.includes('xaver'), h);
    pruefe('A1c feste Termine sind keine Anfrage', !h.includes('nele'), h);
    pruefe('A1d ohne Wunschtermin steht das auch da', h.includes('ohne Wunschtermin'), h);
    pruefe('A1e Annehmen oeffnet den Dialog', h.includes("openLzkEintragModal(null, 1, 'annehmen')"), h);
    pruefe('A2 ohne Standard-Fach alle', banner(LB_OHNE).includes('Offene LZK-Anfragen (2)'), '');
    pruefe('A3 ohne Anfragen kein Banner', baueMit(LB, schneide('function adminLzkAnfragenHtml() {'), 'adminLzkAnfragenHtml',
      { calData: { lzk: [] } })() === '', '');
  }

  // =======================================================================
  // 7) Eigene Anfragen der Schueler:innen
  // =======================================================================
  {
    const eigene = baueMit(SCHUELI, schneide('function eigeneLzkAnfragenHtml() {'), 'eigeneLzkAnfragenHtml',
      { calData: { lzk: [lzk({ id: 1, anfrage: 'offen', datumIso: null }), lzk({ id: 2, anfrage: 'abgelehnt', thema: 'Nein' }),
                          lzk({ id: 3 })] } })();
    pruefe('E1 offene und abgelehnte Anfragen stehen da', eigene.includes('(2)') && eigene.includes('wartet auf die Lernbegleitung') && eigene.includes('abgelehnt'), eigene);
    pruefe('E1b feste Termine nicht', !eigene.includes('lzkZurueck(3)'), eigene);
    pruefe('E2 eine offene laesst sich zurueckziehen, eine abgelehnte ausblenden',
      /lzkZurueck\(1\)">Zurückziehen/.test(eigene) && /lzkZurueck\(2\)">Ausblenden/.test(eigene), eigene);
    const renderInv = schneide('function renderCalInvites() {');
    pruefe('E3 der Block steht ueber dem Kalender', renderInv.includes('const lzkAnfragen = eigeneLzkAnfragenHtml();')
      && renderInv.includes('const vonLb = lzkAnfragen + eingeladenHtml(nachDatum);'), '');
  }

  // =======================================================================
  // 8) Meine Woche
  // =======================================================================
  {
    const chip = baueMit(SCHUELI, schneide('function mwLzkChip(l) {'), 'mwLzkChip');
    const c = chip(lzk({ status: 'bestanden', pokale: 3 }));
    pruefe('W1 die Kachel nennt Fach, Thema und Ergebnis', c.includes('Deutsch-LZK') && c.includes('Erörterung') && c.includes('🔥🔥🔥'), c);
    pruefe('W1b und fuehrt in den Kalender an diesen Tag', c.includes(`mwLzkZumKalender('${HEUTE}')`), c);
    pruefe('W1c per Tastatur bedienbar', c.includes('tabindex="0"') && c.includes("event.key==='Enter'"), c);
    const woche = schneide('async function loadMyWeek() {');
    pruefe('W2 "Meine Woche" nimmt nur eigene LZK dieser Woche', woche.includes('const weekLzk = (data.lzk || []).filter(l => l.datumIso && dayStrs.includes(l.datumIso)'), '');
    pruefe('W2b in einer Ganztags-Zeile ueber den Zeitbloecken', woche.includes('${headRow}${lzkZeile}${blockRows}'), '');
    pruefe('W2c das Raster erscheint auch, wenn es nur LZK gibt', woche.includes('(weekSlots.length || weekLzk.length)'), '');
    pruefe('W3 von dort laesst sich eine LZK anfragen', woche.includes('onclick="openLzkEintragModal()">📝 LZK anfragen'), '');
  }

  // =======================================================================
  // 9) Fach-Einstellung
  // =======================================================================
  {
    // Die Auswahl "selbst eintragen / anfragen" ist ohne Wirkung, seit Schueler:innen
    // immer anfragen - sie steht deshalb nicht mehr in der Fach-Einstellung.
    pruefe('S1 die Fach-Einstellung hat keine LZK-Auswahl mehr', !html.includes('id="ssettings-lzk"'), '');
    const speichern = schneide('async function submitSubjectSettings() {');
    pruefe('S2 und schickt keinen LZK-Modus mehr', !/lzkModus/.test(speichern), '');
  }

  // =======================================================================
  // 10) Halbjahr: LZK je Fach
  // =======================================================================
  {
    const detail = schneide('function hjDetailHtml(s, subjectKey) {');
    const hj = '2627_1';
    const person = { id: 3, username: 'merle', byHalbjahr: { [hj]: {
      lzk: [{ lerntheke: 'kreise-und-zylinder', typ: 'Basis', status: 'bestanden', pokale: 2, datum: HEUTE, subjectId: 1, thema: '' },
            { lerntheke: null, typ: 'LZK', status: 'bestanden', pokale: 3, datum: HEUTE, subjectId: 3, thema: 'Erörterung' }],
      stationDetails: [], stationsCompleted: 0, bySubject: {} } } };
    const fn = baueMit(LB, detail, 'hjDetailHtml', {
      hjSelected: hj, orderedSubjects: () => FAECHER, hjFmtDate: d => d });
    const de = fn(person, 'deutsch');
    pruefe('H1 im Deutsch-Abschnitt steht die Deutsch-LZK mit Thema', de.includes('🔥 LZK (1)') && de.includes('Erörterung'), de);
    pruefe('H1b nicht die Mathe-LZK', !de.includes('Kreise und Zylinder'), de);
    const ma = fn(person, 'mathe');
    pruefe('H2 im Mathe-Abschnitt nur die Lerntheken-LZK', ma.includes('🔥 LZK (1)') && ma.includes('Kreise und Zylinder') && !ma.includes('Erörterung'), ma);
    pruefe('H3 die Lernberatung hat keine LZK-Rubrik', !fn(person, 'lernberatung').includes('🔥 LZK'), '');
    const tabelle = html.slice(html.indexOf('const lzkDesFachs = (b, subj)'), html.indexOf("const headCols ="));
    pruefe('H4 die Tabelle zaehlt LZK je Fach', tabelle.includes('const fachLzk = lzkBestanden(b, subj);'), '');
    pruefe('H4b und zeigt die Spalte in jedem Fach ausser der Lernberatung',
      html.includes("const headCols = (subj.nurZugewiesen ? '' : th('lzk', '🔥 LZK'))"), '');
  }

  // =======================================================================
  // 11) Verschieben, Basis/Aufbau, Themen-Vorschlaege, Admin-Woche ohne LZK
  // =======================================================================
  {
    const zeile = baueMit(LB, '', 'calLzkZeile');
    const frei = zeile(lzk({ id: 9, datumIso: tag(3) }), true);
    pruefe('V1 jede LZK hat "Verschieben" statt eines Stift-Symbols', frei.includes('>Verschieben<') && !frei.includes('>✎<'), frei);

    const titel = baueMit(LB, '', 'lzkTitel');
    pruefe('V2 eine freie Basis-LZK nennt ihren Teil', titel(lzk({ typ: 'Basis', thema: 'Bruchrechnung' })) === 'Basis-LZK · Bruchrechnung', '');
    pruefe('V2b ohne Thema bleibt der Teil stehen', titel(lzk({ typ: 'Aufbau', thema: '' })) === 'Aufbau-LZK', '');
    pruefe('V2c eine allgemeine LZK zeigt nur ihr Thema', titel(lzk({ typ: 'LZK', thema: 'Erörterung' })) === 'Erörterung', '');

    // Dialog: Mathe zeigt Basis/Aufbau, Deutsch nicht
    const daten = { lzk: [lzk({ id: 1, subjectId: 1, thema: 'Bruchrechnung' }), lzk({ id: 2, subjectId: 1, thema: 'Prozente' }),
                          lzk({ id: 3, subjectId: 3, thema: 'Erörterung' }), lzk({ id: 4, subjectId: 1, thema: 'Bruchrechnung' })] };
    let d = dialog(LB_OHNE, daten, [{ id: 3, username: 'merle' }]);
    d.api.openLzkEintragModal(tag(2));
    d.el('lzke-fach').value = '1'; d.api.lzkeFachGewechselt();
    pruefe('V3 bei Mathe gibt es LZK 1 (Basis) / LZK 2 (Aufbau)', d.el('lzke-typ-gruppe').style.display !== 'none', '');
    pruefe('V3b mit dem Tipp zur Zuordnung im Python-Tool', d.el('lzke-hinweis').innerHTML.includes('Python-Tool'), d.el('lzke-hinweis').innerHTML);
    const vorschlaege = d.el('lzke-themen').innerHTML;
    pruefe('V4 Themen-Vorschlaege: schon benutzte Mathe-Themen, jedes einmal',
      (vorschlaege.match(/Bruchrechnung/g) || []).length === 1 && vorschlaege.includes('Prozente') && !vorschlaege.includes('Erörterung'), vorschlaege);
    d.el('lzke-typ').value = 'Aufbau'; d.api.lzkePersonUmschalten(3, true); d.el('lzke-thema').value = 'Bruchrechnung';
    await d.api.submitLzkEintrag();
    pruefe('V5 der Teil geht mit an den Server', d.netz[0].body.typ === 'Aufbau', d.netz[0]);
    d.api.openLzkEintragModal(tag(2));
    d.el('lzke-fach').value = '3'; d.api.lzkeFachGewechselt();
    pruefe('V6 bei Deutsch gibt es die Auswahl nicht', d.el('lzke-typ-gruppe').style.display === 'none', '');
    d.api.lzkePersonUmschalten(3, true);
    await d.api.submitLzkEintrag();
    pruefe('V6b und es geht die allgemeine "LZK" raus', d.netz[1].body.typ === 'LZK', d.netz[1]);

    // Verschieben einer freien Mathe-LZK: Datum, Thema und Teil
    d = dialog(LB, { lzk: [lzk({ id: 7, subjectId: 1, typ: 'Aufbau', thema: 'Prozente', datumIso: tag(4) })] }, []);
    d.api.openLzkEintragModal(null, 7);
    pruefe('V7 der Dialog heisst "verschieben"', d.el('lzke-title').textContent.includes('verschieben'), d.el('lzke-title').textContent);
    pruefe('V7b der Teil ist vorbelegt', d.el('lzke-typ').value === 'Aufbau', d.el('lzke-typ').value);
    d.el('lzke-datum').value = tag(9);
    await d.api.submitLzkEintrag();
    pruefe('V7c verschoben wird per PATCH mit neuem Datum', d.netz[0].method === 'PATCH' && d.netz[0].body.datum === tag(9)
      && d.netz[0].body.typ === 'Aufbau' && d.netz[0].body.thema === 'Prozente', d.netz[0]);

    // Die Wochenuebersicht der Lernbegleitung bleibt ohne LZK (Nutzervorgabe)
    const woche = schneide('function renderAdminWeek() {');
    pruefe('V8 in der Wochenuebersicht der Lernbegleitung stehen keine LZK', !/lzk/i.test(woche), '');
  }

  // =======================================================================
  // 12) Lerntheken-Tabelle der Lernbegleitung: Wunschtermine
  // =======================================================================
  {
    const zelle = new Function('ltMeta', 'escHtml', schneide('function lzkCellHtml(studentLzk, s, lt) {') + '\nreturn lzkCellHtml;')(
      [], t => String(t == null ? '' : t));
    const lt = { key: 'kreise', groups: { Basis: {}, Aufbau: {} } };
    const s = { id: 3, username: 'merle' };
    const h = zelle([{ id: 7, lerntheke: 'kreise', typ: 'Basis', datum: '2026-10-01', status: 'ausstehend', pokale: 0, anfrage: 'offen' }], s, lt);
    pruefe('T1 ein Wunschtermin steht in der Tabelle als "angefragt"', h.includes('angefragt'), h);
    const h2 = zelle([{ id: 7, lerntheke: 'kreise', typ: 'Basis', datum: '2026-10-01', status: 'ausstehend', pokale: 0, anfrage: null }], s, lt);
    pruefe('T1b ein bestaetigter Termin nicht', !h2.includes('angefragt'), h2);

    const netz = [];
    const felder = { 'lzk-modal-datum': { value: '2026-10-02' }, 'lzk-modal-status': { value: 'ausstehend' } };
    const speichern = new Function('document', 'fetch', 'closeModal', 'loadStudents', 'alert',
      'let _lzkModal = { userId: 3, lerntheke: "kreise", typ: "Basis", pokale: 0, id: 7, anfrage: "offen" };'
      + schneide('async function saveLzkModal() {') + '\nreturn saveLzkModal;')(
      { getElementById: id => felder[id] }, async (url, opt) => { netz.push({ url, opt }); return { ok: true, json: async () => ({}) }; },
      () => {}, () => {}, () => {});
    await speichern();
    pruefe('T2 Speichern mit Datum nimmt den Wunschtermin an',
      netz[0].url === '/api/admin/lzk/7' && netz[0].opt.method === 'PATCH'
      && JSON.parse(netz[0].opt.body).anfrage === 'annehmen' && JSON.parse(netz[0].opt.body).datum === '2026-10-02', netz[0]);
  }

  // =======================================================================
  // 13) Lerntheke: Schueler:innen fragen an, sie legen nicht fest
  // =======================================================================
  {
    const lt = lies('public/lerntheken/lerntheke.js');
    pruefe('L1 die Lerntheke sagt "Termin anfragen" statt "eintragen"',
      lt.includes("'Termin anfragen:'") && !lt.includes('Termin eintragen:'), '');
    pruefe('L2 eine offene Anfrage zeigt "wartet auf die Lernbegleitung"',
      /lzkInfo\.anfrage==='offen'\) return`[^`]*angefragt[^`]*wartet auf die Lernbegleitung/.test(lt), '');
    pruefe('L3 als fester Termin gilt nur ein bestaetigter', lt.includes('lzkInfo&&lzkInfo.datum&&!lzkInfo.anfrage')
      && lt.includes('const basisTermin=!!(basisLzk&&basisLzk.datum&&!basisLzk.anfrage);'), '');
    pruefe('L4 nach einer Ablehnung laesst sich neu anfragen', lt.includes("'Neuen Termin anfragen:'"), '');
    pruefe('L5 vergangene Tage sind gesperrt', lt.includes('min="${heute}"'), '');
    pruefe('L6 ein Fehler des Servers wird gemeldet', /setLzkTermin[\s\S]{0,400}if\(!r\.ok\)/.test(lt), '');
    pruefe('L7 die Anfrage-Zeile hat ihre Farbe', lies('public/lerntheken/lerntheke.css').includes('.lzk-angefragt{'), '');
  }

  console.log('\n' + ok + ' Pruefungen bestanden.');
})().catch(e => { console.error('FAIL (Ausnahme): ' + e.stack); process.exit(1); });
