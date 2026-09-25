// Prueft, dass die Stationsleiste (Zurueck-Knopf) kleben BLEIBEN kann:
// kein Vorfahr von .st-top / .hilfe-strip darf einen Bezugsrahmen aufspannen
// (transform/filter/perspective/contain/will-change) oder scrollen (overflow).
const fs = require('fs');
const { lies } = require('../lib/quelle');
const cssRoh = lies('public/lerntheken/lerntheke.css');
// Kommentare raus, sonst landen sie im Selektor der folgenden Regel.
const css = cssRoh.replace(/\/\*[\s\S]*?\*\//g, '');
const html = lies('public/lerntheken/kreise-und-zylinder.html');

let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };

// --- Regeln aus dem Stylesheet einsammeln (nur oberste Ebene, reicht hier) ---
const regeln = [];
const re = /([^{}]+)\{([^{}]*)\}/g;
let m;
while ((m = re.exec(css))) regeln.push({ sel: m[1].trim().replace(/\s+/g, ' '), decl: m[2] });
const regelnFuer = sel => regeln.filter(r => r.sel.split(',').some(s => s.trim() === sel));
const decl = sel => regelnFuer(sel).map(r => r.decl).join(';');

// --- 1) Die Leisten sind ueberhaupt klebrig -------------------------------
pruefe('S1 die Stationsleiste ist sticky am oberen Rand',
  /position:\s*sticky/.test(decl('.st-top')) && /top:\s*0/.test(decl('.st-top')), decl('.st-top'));
pruefe('S1b die Hilfen-Leiste ist sticky am unteren Rand',
  /position:\s*sticky/.test(decl('.hilfe-strip')) && /bottom:\s*0/.test(decl('.hilfe-strip')), decl('.hilfe-strip'));

// --- 2) Die Vorfahrenkette laut Markup ------------------------------------
const stTop = html.indexOf('class="st-top"');
pruefe('S2 .st-top steckt in #view-st > .inner',
  stTop > -1 && html.lastIndexOf('<div class="inner">', stTop) > html.lastIndexOf('id="view-st"', stTop)
  || /id="view-st"[\s\S]{0,200}class="inner"[\s\S]{0,200}class="st-top"/.test(html), '');

// Vorfahren, die in Frage kommen (Markup: body > .view#view-st > .inner > .st-top)
const VORFAHREN = ['body', '.view', '.view.active', '#view-st .inner', '.inner'];
const SPERREN = /(^|;)\s*(transform|filter|perspective|contain|will-change|overflow|overflow-y)\s*:\s*([^;]+)/g;

for (const sel of VORFAHREN) {
  const d = decl(sel);
  const treffer = [];
  let t; SPERREN.lastIndex = 0;
  while ((t = SPERREN.exec(d))) {
    const wert = t[3].trim();
    // 'none'/'visible'/'auto' sind unschaedlich
    if (!/^(none|visible|auto)$/i.test(wert)) treffer.push(t[2] + ':' + wert);
  }
  pruefe('S3 ' + (sel || '(leer)') + ' spannt keinen Bezugsrahmen auf und scrollt nicht',
    treffer.length === 0, treffer.join(', '));
}

// --- 3) Der eigentliche Knackpunkt: die Einblend-Animation ---------------
const viewAnim = (decl('.view.active').match(/animation:\s*([^;]+)/) || [, ''])[1].trim();
pruefe('S4 .view.active hat ueberhaupt eine Einblendung', !!viewAnim, viewAnim);
const animName = viewAnim.split(/\s+/)[0];
// Klammerbalancierter Ausschnitt statt Regex - @keyframes enthaelt geschachtelte Bloecke.
function keyframesVon(name) {
  const i = css.indexOf('@keyframes ' + name);
  if (i < 0) return '';
  const a = css.indexOf('{', i);
  let tiefe = 0;
  for (let k = a; k < css.length; k++) {
    if (css[k] === '{') tiefe++;
    else if (css[k] === '}' && --tiefe === 0) return css.slice(i, k + 1);
  }
  return '';
}
const kf = keyframesVon(animName);
pruefe('S4b die Keyframes dazu sind auffindbar', kf.length > 0, animName);
pruefe('S5 die Einblendung des Views animiert KEIN transform',
  !/transform/.test(kf), animName + ': ' + kf.replace(/\s+/g, ' ').slice(0, 160));
pruefe('S5b und bleibt nicht als fuellende Animation stehen (kein fill-mode)',
  !/\b(both|forwards)\b/.test(viewAnim), viewAnim);

// --- 4) Die Politur an unkritischer Stelle bleibt erhalten ---------------
pruefe('S6 das Loesungs-Panel behaelt seine rise-Animation',
  /animation:\s*rise/.test(decl('.sol-panel.open')), decl('.sol-panel.open'));
pruefe('S6b und die rise-Keyframes gibt es noch', /@keyframes\s+rise\s*\{/.test(css), '');

console.log('\n' + ok + ' Pruefungen bestanden.');
