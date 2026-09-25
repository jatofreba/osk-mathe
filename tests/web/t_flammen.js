// Prueft die Umstellung Kleeblatt -> Flamme: keine Reste, und an den Stellen,
// die die Nutzer:innen wirklich sehen (Talks, LZK, Ranglisten, Uebersichten),
// steht die Flamme mit grammatisch richtiger Beschriftung daneben.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');
const js   = lies('public/lerntheken/lerntheke.js');
const css  = lies('public/lerntheken/lerntheke.css');
const srv  = lies('server.js');
const py   = ['tools/arbeitsstaende/app/arbeitsstaende_app.py',
              'tools/arbeitsstaende/app/arbeitsstaende_data.py',
              'tools/arbeitsstaende/app/osk_sync.py',
              'tools/arbeitsstaende/app/test_arbeitsstaende_data.py']
             .map(f => [f, lies(f)]);

let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };

const alle = [['index.html', html], ['lerntheke.js', js], ['lerntheke.css', css], ['server.js', srv], ...py];

// --- 1) Keine Reste ------------------------------------------------------
for (const [name, text] of alle) {
  pruefe('F1 ' + name + ': kein Kleeblatt-Emoji mehr', !text.includes('🍀'));
  pruefe('F1b ' + name + ': auch nicht im Wortlaut', !/[Kk]leeblat|[Kk]leeblaet|[Kk]leebl/.test(text),
    (text.match(/.{0,50}[Kk]leebl.{0,50}/) || [''])[0]);
}

// --- 2) Wortreste der Ersetzung (Dativ-Plural!) ---------------------------
for (const [name, text] of alle) {
  pruefe('F2 ' + name + ': keine verstuemmelten Wortformen',
    !/Flammenn|Flammes|Flammeter|Flammen-blatt|\beine Flammen\b|Flammen gesammelt!'\s*:\s*undefined/.test(text),
    (text.match(/.{0,60}Flammenn.{0,40}/) || [''])[0]);
}

// --- 3) Die sichtbaren Stellen, die der Nutzer genannt hat ---------------
// Talks
pruefe('F3 Talk-Flammen in der Halbjahr-Uebersicht', html.includes('🔥 ${escHtml(subj.name)}-Talk-Flammen'));
pruefe('F3b Talk-Bewertung vergibt Flammen',
  html.includes('selectTalkingRatePokal(${v})">${v} 🔥'), '');
pruefe('F3c und die Beschriftung des Feldes heisst Flammen',
  html.includes('id="trate-pokal-lbl">Flammen<'), '');
// LZK
for (const v of [0, 1, 2, 3])
  pruefe('F4 LZK-Knopf ' + v + ' zeigt die Flamme',
    html.includes(`onclick="selectLzkPokal(${v})">${v} 🔥</button>`));
pruefe('F4b LZK-Feld heisst Flammen', html.includes('id="lzk-pokal-lbl">Flammen<'));
pruefe('F4c bestandene LZK wird mit der Flamme gemeldet',
  js.includes(`<span class="lzk-status-icon">🔥</span>`));
// Ranglisten
pruefe('F5 die Rangliste heisst "Flammen gesamt"', html.includes('Rangliste – Flammen gesamt'));
pruefe('F5b und zaehlt mit der Flamme', html.includes("s => '🔥 ' + s.pokale"));
pruefe('F5c das eigene Panel heisst "Meine Flammen"', html.includes('>Meine Flammen<'));
pruefe('F5d der Vollstaendigkeits-Text passt',
  html.includes("'🔥 Alle Flammen gesammelt!'") && html.includes("' % aller möglichen Flammen'"));
// Uebersichten
pruefe('F6 die Halbjahr-Rubrik heisst 🔥 LZK', html.includes("rubrik('🔥 LZK'"));
pruefe('F6b die Spaltenueberschrift ebenso', html.includes("th('lzk', '🔥 LZK')"));
// Seit den fachuebergreifenden LZK: Lerntheken-LZK tragen ihren Typ, freie heissen "LZK".
pruefe('F6c die LZK-Zeile traegt die Flamme',
  html.includes(">🔥 <strong>${l.lerntheke ? escHtml(l.typ) + '-LZK' : 'LZK'}</strong>"));

// --- 4) Lerntheken-Engine: Balken und Legende ----------------------------
pruefe('F7 trophyHtml malt Flammen',
  /function trophyHtml\(count\)[\s\S]{0,300}>🔥</.test(js), '');
pruefe('F7b die Legende erklaert die drei Stufen ueber die Anzahl',
  js.includes('const flamme=n=>') && js.includes('${flamme(3)} alle Aufgaben erledigt'), '');
pruefe('F7c der alte Helfername ist weg', !js.includes('kleeblatt('));
pruefe('F8 die CSS-Ueberschrift heisst Flammen-System', css.includes('── Flammen-System ─'));
pruefe('F8b und die Kommentarbegruendung nennt keine gruene Farbe mehr',
  !css.includes('gruenen') && css.includes('Bei der Flamme ergaeben'), '');

// --- 5) Python-Tool: Bericht und Excel-Spalte ----------------------------
const data = py.find(p => p[0].includes('data.py'))[1];
const sync = py.find(p => p[0].includes('sync.py'))[1];
pruefe('F9 die Talk-Zeile im Tool zaehlt Flammen',
  data.includes('teile.append(f"{flammen} Flammen")'), '');
pruefe('F9b der alte Bezeichner klee ist weg', !/\bklee\b/.test(data));
pruefe('F10 die Excel-Spalte heisst Flammen',
  sync.includes('f"{kurz}: Flammen"') && sync.includes('"LZK-Flammen"'), '');
pruefe('F10b Schluessel und Zugriff passen zusammen',
  sync.includes('"flammen": (sub.get') && sync.includes('w["flammen"]')
  && !sync.includes('kleeblaetter'), '');

console.log('\n' + ok + ' Pruefungen bestanden.');
