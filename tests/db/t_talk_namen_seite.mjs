// Schueler:innen sehen, wer einen gebuchten Talk haelt (Wunsch einer Kollegin, 2026-11-18) - Seite
// und Server ZUSAMMEN (pglite): nach dem Antippen der Kachel in "Meine Woche" steht in der Leiste
// "🎤 ada & bo", dazu der Hinweis, die Vortragenden zu fragen; im Tooltip der Kachel ebenso.
// Die Kachel selbst bleibt so knapp wie vorher.
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { ladeServer } = require('../lib/server_im_test.js');
const { ladeSeite } = require('../lib/seite_im_test.js');
const { lies } = require('../lib/quelle.js');

let ok = 0;
const pruefe = (n, b, e) => {
  if (!b) { console.error('FAIL: ' + n + (e !== undefined ? '\n      ' + String(typeof e === 'string' ? e : JSON.stringify(e)).slice(0, 2500) : '')); process.exit(1); }
  ok++; console.log('OK  ' + n);
};

const db = new PGlite();
const srv = await ladeServer(lies('server.js'), db);
const eins = async (sql, p) => (await db.query(sql, p || [])).rows[0];
const F = {};
for (const r of (await db.query(`SELECT id, key FROM subjects`)).rows) F[r.key] = r.id;
const neu = async (name, rolle = 'student') => (await eins(
  `INSERT INTO users (username, password_hash, klasse, role, created_at) VALUES ($1,'x','M3M4',$2, NOW() - INTERVAL '2 years') RETURNING id`,
  [name, rolle])).id;
const LB = await neu('lb', 'admin');
const P = {};
for (const n of ['ada', 'bo', 'cleo', 'dan', 'eva']) P[n] = await neu(n);

// ── Seite ────────────────────────────────────────────────────────────────────
const seite = ladeSeite();
let wer = { userId: P.dan, username: 'dan', role: 'student', klasse: 'M3M4' };
let offen = 0;
const serverFetch = srv.fetchFuer(() => ({ userId: wer.userId, role: wer.role, klasse: wer.klasse }));
seite.kontext.fetch = async (...a) => { offen++; try { return await serverFetch(...a); } finally { offen--; } };
const ruhe = async () => { do { await new Promise(r2 => setTimeout(r2, 5)); } while (offen > 0); await new Promise(r2 => setTimeout(r2, 5)); };
const lauf = (code, werte) => seite.lauf(code, werte);
const html = id => seite.element(id).innerHTML;

// Naechste Woche (alles in der Zukunft): Montag 09:30 ein Talk von ada mit bo (zugesagt) und eva
// (noch keine Antwort), cleo hoert zu; Dienstag ein freier Talk; Mittwoch ein Fachbuero von cleo.
const mo = lauf(`(() => { const m = lwMonday(); m.setDate(m.getDate() + 7); return lwDateStr(m); })()`);
const plus = n => lauf(`(() => { const d = new Date(__werte.mo + 'T00:00:00'); d.setDate(d.getDate() + ${n}); return lwDateStr(d); })()`, { mo });
const slot = async (datum, typ = 'talk') => (await eins(`INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
  VALUES ('M3M4',$1,'09:30','R1','2627_1',$2,$3,45,$4,'') RETURNING id`, [datum, LB, typ, F.mathe])).id;
const talk = await slot(mo);
const sess = (await eins(`INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,'Pythagoras') RETURNING id`, [talk, P.ada])).id;
await db.query(`INSERT INTO talking_invitations (session_id, listener_id, status, rolle) VALUES ($1,$2,'angenommen','vortrag'), ($1,$3,'eingeladen','vortrag'), ($1,$4,'angenommen','zuhoeren')`,
  [sess, P.bo, P.eva, P.cleo]);
const freierTalk = await slot(plus(1));
const fabue = await slot(plus(2), 'input');
await eins(`INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,'Brüche') RETURNING id`, [fabue, P.cleo]);

const woche = async (person) => {
  wer = { userId: P[person], username: person, role: 'student', klasse: 'M3M4' };
  await lauf(`me = __werte.me; _mwWoche = 1; _mwPicked = null; loadMyWeek()`, { me: wer }); await ruhe();
};
const leiste = id => { lauf(`mwSelect(${id})`); const h = html('mw-actionbar'); lauf(`mwSelect(${id})`); return h; };
const kachel = id => (html('home-myweek').match(new RegExp(`<div class="lw-chip[^"]*"[^>]*data-mw="${id}"[\\s\\S]*?</div>\\s*</div>`)) || [''])[0];
const ohneTags = h => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

await woche('dan');
let b = leiste(talk);
pruefe('N1 dan (nicht dabei) sieht nach dem Antippen, wer vortraegt - eva noch ohne Antwort mit ⏳',
  ohneTags(b).includes('🎤 ada & bo & eva ⏳') && b.includes('<span title="noch keine Antwort">⏳</span>'), b);
pruefe('N2 ... und den Hinweis, die Vortragenden zu fragen', b.includes('Schon vergeben – frag die Vortragenden, ob du zuhören darfst.'), b);
const k = kachel(talk);
pruefe('N3 Tooltip der Kachel nennt die Vortragenden, die Kachel selbst nicht',
  /title="[^"]*Vortrag: ada &amp; bo &amp; eva[^"]*"/.test(k) && !ohneTags(k).includes('ada'), k);
pruefe('N4 freier Talk und Fachbuero: keine 🎤-Zeile', !leiste(freierTalk).includes('🎤') && !leiste(fabue).includes('🎤'));

await woche('ada');
pruefe('N5 ada (bucht): "🎤 Du & bo & eva"', ohneTags(leiste(talk)).includes('🎤 Du & bo & eva ⏳'), leiste(talk));
await woche('bo');
pruefe('N6 bo (traegt mit vor): "🎤 ada & Du & eva"', ohneTags(leiste(talk)).includes('🎤 ada & Du & eva ⏳')
  && /Vortrag: ada &amp; Du &amp; eva/.test(kachel(talk)), leiste(talk));

// Namen werden nicht als HTML ausgefuehrt.
await db.query(`UPDATE users SET username='<b>x</b>' WHERE id=$1`, [P.ada]);
await woche('dan');
pruefe('N7 Namen sind maskiert', leiste(talk).includes('🎤 &lt;b&gt;x&lt;/b&gt;') && !leiste(talk).includes('<b>x</b>'), leiste(talk));

console.log(`\n${ok} Pruefungen ok`);
process.exit(0);
