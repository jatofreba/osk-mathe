// Die kompakte "Mein Halbjahr"-Karte ist aus dem Kalender verschwunden -
// die Auswertung steht weiterhin im eigenen Tab.
const fs = require('fs');
const { lies } = require('../lib/quelle');
const html = lies('public/index.html');

let ok = 0;
const pruefe = (n, b, e) => { if (!b) { console.error('FAIL: ' + n + (e ? '\n      ' + e : '')); process.exit(1); } ok++; console.log('OK  ' + n); };

// --- 1) Nichts von der Karte ist uebrig ---------------------------------
for (const rest of ['renderMyHalbjahr', 'myHjData', 'cal-myhj'])
  pruefe('H1 kein Rest von ' + rest, !html.includes(rest),
    (html.match(new RegExp('.{0,60}' + rest + '.{0,60}')) || [''])[0]);

pruefe('H1b die Karten-Beschriftung gibt es nicht mehr',
  !html.includes('Alles ansehen (auch ältere Halbjahre)'), '');

// --- 2) Der Kalender laedt die Daten gar nicht mehr ---------------------
{
  const a = html.indexOf('async function loadCalendar');
  const lade = html.slice(a, html.indexOf('\n}\n', a));
  pruefe('H2 loadCalendar holt /api/my-halbjahr nicht mehr',
    !lade.includes('my-halbjahr'), lade.slice(0, 600));
  pruefe('H2b und ruft die Karte nicht mehr auf',
    !lade.includes('renderMyHalbjahr'), '');
  pruefe('H2c die beiden uebrigen Abrufe stehen unveraendert da',
    lade.includes("fetch('/api/calendar')") && lade.includes("fetch('/api/classmates')"), '');
  pruefe('H2d und werden sauber entgegengenommen',
    lade.includes('const [cr, cmr] = await Promise.all(')
    && lade.includes('calData = cr.ok') && lade.includes('calClassmates = (cmr && cmr.ok)'),
    lade.slice(lade.indexOf('Promise.all'), lade.indexOf('Promise.all') + 400));
  pruefe('H2e die uebrigen Renderer laufen weiter',
    /renderAdminWeek\(\); renderCalendar\(\); renderCalDetail\(\); renderCalInvites\(\);/.test(lade), '');
}

// --- 3) Die Auswertung bleibt erreichbar --------------------------------
{
  pruefe('H3 Schueler:innen haben weiterhin den Tab "Mein Halbjahr"',
    html.includes("'🎓 Halbjahr-Übersicht' : '🎓 Mein Halbjahr'"), '');
  pruefe('H3b und der Tab holt die Daten selbst',
    html.includes("const r = await fetch('/api/my-halbjahr');"), '');
}

// --- 4) Der Kalender selbst ist unversehrt ------------------------------
{
  pruefe('H4 die uebrigen Bloecke des Kalenders stehen noch',
    html.includes('id="cal-wuensche"') && html.includes('id="cal-adminweek"')
    && html.includes('id="cal-invites"') && html.includes('id="cal-grid"'), '');
}

console.log('\n' + ok + ' Pruefungen bestanden.');
