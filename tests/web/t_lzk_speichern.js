// LZK-Dialog: solange das Speichern laeuft, ist der Knopf gesperrt - ein Doppelklick
// schickt nichts zweimal. Danach (auch nach einem Fehler) ist er wieder frei.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
let ok = 0;
const pruefe = (n, b, e) => {
  if (!b) { console.error('FAIL: ' + n + (e !== undefined ? '\n      ' + JSON.stringify(e) : '')); process.exit(1); }
  ok++; console.log('OK  ' + n);
};
const schneide = kopf => { const a = html.indexOf(kopf); if (a < 0) throw new Error('fehlt: ' + kopf); return html.slice(a, html.indexOf('\n}\n', a) + 2); };

function umgebung(antwort) {
  const el = {};
  const neuesEl = () => ({ value: '', textContent: '', disabled: false, style: {} });
  ['lzke-error', 'lzke-datum', 'lzke-thema', 'lzke-fach', 'lzke-ok'].forEach(id => { el[id] = neuesEl(); });
  el['lzke-datum'].value = '2026-09-30';
  el['lzke-fach'].value = '1';
  const merk = { aufrufe: [], waehrend: null, geschlossen: null, neu: 0 };
  let freigeben;
  const fetch = (url, opt) => {
    merk.aufrufe.push({ url, body: JSON.parse(opt.body) });
    merk.waehrend = el['lzke-ok'].disabled;
    if (antwort === 'wirft') return Promise.reject(new Error('offline'));
    return new Promise(res => { freigeben = () => res(antwort); });
  };
  const api = new Function('document', 'fetch', 'me', 'closeModal', 'calReload', `
    let _lzkeModus = 'neu', _lzkeId = null, _lzkePersonen = new Set([7]);
    let calData = { lzk: [] };
    function lzkeTyp() { return 'Basis'; }
    ${schneide('async function submitLzkEintrag() {')}
    return { submitLzkEintrag, personen: p => { _lzkePersonen = new Set(p); } };`)(
    { getElementById: id => el[id] || null }, fetch, { role: 'admin', userId: 1 },
    id => { merk.geschlossen = id; }, () => { merk.neu++; });
  return { api, el, merk, freigeben: () => freigeben && freigeben() };
}
const antwortOk = { ok: true, json: async () => ({ ok: true, id: 5, ids: [5] }) };

(async () => {
  // 1) Erfolg
  let u = umgebung(antwortOk);
  const lauf = u.api.submitLzkEintrag();
  await new Promise(r => setTimeout(r, 0));
  pruefe('W1 waehrend der Anfrage ist der Knopf gesperrt', u.merk.waehrend === true && u.el['lzke-ok'].disabled === true, u.merk);
  u.freigeben(); await lauf;
  pruefe('W2 danach wieder frei, Dialog zu, Ansicht neu geladen',
    u.el['lzke-ok'].disabled === false && u.merk.geschlossen === 'modal-lzk-eintrag' && u.merk.neu === 1, u.merk);
  pruefe('W2b geschickt wurde genau einmal', u.merk.aufrufe.length === 1 && u.merk.aufrufe[0].url === '/api/admin/lzk/eintrag', u.merk.aufrufe);

  // 2) Keine Verbindung
  u = umgebung('wirft');
  await u.api.submitLzkEintrag();
  pruefe('W3 keine Verbindung: Meldung, Knopf wieder frei, Dialog bleibt offen',
    u.el['lzke-error'].textContent.includes('Keine Verbindung') && u.el['lzke-error'].style.display === 'block'
    && u.el['lzke-ok'].disabled === false && u.merk.geschlossen === null, u.el['lzke-error']);

  // 3) Der Server lehnt ab
  u = umgebung({ ok: false, json: async () => ({ error: 'Bitte ein Datum wählen.' }) });
  const l3 = u.api.submitLzkEintrag(); await new Promise(r => setTimeout(r, 0)); u.freigeben(); await l3;
  pruefe('W4 Fehler vom Server: seine Meldung, Knopf wieder frei',
    u.el['lzke-error'].textContent === 'Bitte ein Datum wählen.' && u.el['lzke-ok'].disabled === false && u.merk.geschlossen === null, u.el['lzke-error']);

  // 4) Eingabe unvollstaendig - es geht gar nichts hinaus
  u = umgebung(antwortOk);
  u.api.personen([]);
  await u.api.submitLzkEintrag();
  pruefe('W5 niemand ausgewaehlt: keine Anfrage, Knopf nie gesperrt',
    u.merk.aufrufe.length === 0 && u.el['lzke-ok'].disabled === false && u.el['lzke-error'].textContent.includes('mindestens eine Person'), u.merk);

  console.log('\n' + ok + ' Pruefungen bestanden.');
})().catch(e => { console.error('FEHLER: ' + e.stack); process.exit(1); });
