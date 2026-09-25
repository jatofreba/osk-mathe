// Die GANZE Seite (public/index.html) in einer vm-Sandbox - das Gegenstueck zu server_im_test.js.
// Alles, was die Seite beim Laden anfasst (window, fetch, localStorage ...), ist eine
// Allzweck-Attrappe, die jede Eigenschaft und jeden Aufruf schluckt. Danach laufen Funktionen der
// Seite mit gesetztem Zustand:
//
//   const seite = ladeSeite({ heute: '2026-09-16T09:00:00' });
//   seite.lauf(`me = __werte.me; calData = __werte.kal; renderCalDetail();`, { me, kal });
//   seite.element('cal-detail').innerHTML
//
// Vorteil gegenueber dem Herausschneiden: Hilfsfunktionen und Konstanten sind alle da - ein neuer
// Helfer bricht keinen Test. Top-level let/const der Seite sind in lauf() les- und schreibbar.
// document.getElementById liefert fuer jede id aus dem Markup ein Element - und wie im Browser
// auch fuer Elemente, die die Seite selbst per innerHTML gerendert hat (Zustand aus dem Markup:
// checked, display:none, value; nach neuem Rendern frisch). Sonst null. querySelectorAll
// beantwortet setzeQsa(fn); fetch/alert lassen sich ueber seite.kontext ersetzen.
const vm = require('vm');
const { lies } = require('./quelle');

function allzweck() {
  const f = function () { return p; };
  const p = new Proxy(f, {
    get(_, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then') return undefined;            // kein Thenable: await liefert die Attrappe
      if (k === 'length') return 0;
      if (k === Symbol.iterator) return function* () {};
      return p;
    },
    set() { return true; },
    apply() { return p; },
    construct() { return p; },
    has() { return true; },
  });
  return p;
}

const idsIn = h => [...String(h).matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const alsMuster = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// optionen.html: anderer Seiteninhalt (Standard: public/index.html)
// optionen.heute: festes "heute" (ISO-Zeit) fuer new Date() ohne Argumente und Date.now()
function ladeSeite(optionen = {}) {
  let DateK = Date;
  if (optionen.heute) {
    const fix = new Date(optionen.heute).getTime();
    DateK = class extends Date {
      constructor(...a) { if (a.length) super(...a); else super(fix); }
      static now() { return fix; }
    };
  }
  const html = (optionen.html || lies('public/index.html')).replace(/\r\n/g, '\n');
  const skripte = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  const U = allzweck();
  const elemente = {};
  // Festes Markup = das HTML ausserhalb der Skripte; was nur in Vorlagen im Skript steht, gibt
  // es erst, wenn die Seite es rendert.
  const idsImMarkup = new Set(idsIn(html.replace(/<script[\s\S]*?<\/script>/g, '')));
  const neuesElement = id => {
    let inhalt = '';
    return {
      id, value: '', textContent: '', checked: false, disabled: false, dataset: {},
      style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      appendChild() {}, setAttribute() {}, getAttribute() { return null; }, addEventListener() {},
      querySelector() { return null; }, querySelectorAll() { return []; }, focus() {}, scrollIntoView() {},
      get innerHTML() { return inhalt; },
      // Neu gerendert: was vorher oder jetzt darin stand, entsteht beim naechsten Zugriff frisch.
      set innerHTML(h) {
        for (const x of [...idsIn(inhalt), ...idsIn(h)]) if (!idsImMarkup.has(x)) delete elemente[x];
        inhalt = String(h);
      },
    };
  };
  // Von der Seite gerendertes Element: Zustand aus seinem Tag im innerHTML eines anderen Elements.
  const ausGerendertem = id => {
    const muster = new RegExp('<[^>]*\\bid="' + alsMuster(id) + '"[^>]*>');
    for (const e of Object.values(elemente)) {
      const tag = String(e.innerHTML).match(muster);
      if (!tag) continue;
      const el = neuesElement(id);
      if (/\schecked\b/.test(tag[0])) el.checked = true;
      if (/display:\s*none/.test(tag[0])) el.style.display = 'none';
      const wert = tag[0].match(/\svalue="([^"]*)"/);
      if (wert) el.value = wert[1];
      return el;
    }
    return null;
  };
  let qsa = () => [];
  const element = id => {
    if (elemente[id]) return elemente[id];
    const el = idsImMarkup.has(id) ? neuesElement(id) : ausGerendertem(id);
    return el ? (elemente[id] = el) : null;
  };
  const documentAttrappe = new Proxy({}, {
    get(_, k) {
      if (k === 'getElementById') return element;
      if (k === 'querySelectorAll') return sel => qsa(sel);
      if (k === 'querySelector') return () => null;
      return U;
    },
    set() { return true; },
  });
  const kontext = {
    console, Math, Date: DateK, JSON, Array, Object, String, Number, Boolean, Set, Map, Promise, RegExp,
    parseInt, parseFloat, isNaN, isFinite, Intl, Symbol, Error, encodeURIComponent, decodeURIComponent,
    document: documentAttrappe, window: U, navigator: U, location: U, history: U, localStorage: U,
    sessionStorage: U, fetch: () => new Promise(() => {}), setTimeout: () => 0, clearTimeout() {},
    setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0, alert() {}, confirm: () => true,
    addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => U, CSS: U, HTMLElement: function () {}, Event: function () {}, CustomEvent: function () {},
    IntersectionObserver: function () { return U; }, ResizeObserver: function () { return U; },
    MutationObserver: function () { return U; }, URLSearchParams, URL, Blob: function () {}, FileReader: function () {},
    performance: { now: () => 0 }, queueMicrotask,
  };
  kontext.globalThis = kontext;
  vm.createContext(kontext);
  skripte.forEach((t, i) => vm.runInContext(t[1], kontext, { filename: 'seite-skript' + i }));
  return {
    kontext, elemente, element,
    // Code im Seiten-Kontext; werte stehen dort als __werte bereit.
    lauf: (code, werte) => { kontext.__werte = werte || {}; return vm.runInContext(code, kontext); },
    setzeQsa: f => { qsa = f; },
    leere: () => { for (const k of Object.keys(elemente)) delete elemente[k]; },
  };
}

module.exports = { ladeSeite };
