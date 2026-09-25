# Tests

```bash
npm install --prefix tests   # einmalig: pglite (Postgres im Prozess) für die db-Tests
npm test                     # alles
node tests/run.js lzk        # nur Suiten, deren Dateiname "lzk" enthält
```

Kein Server, keine Datenbank und kein Browser nötig. Jede Suite ist ein eigenes Skript
(Exit-Code 0 = bestanden, `OK  …` je Prüfung, `FAIL: …` beim ersten Fehler) und lässt
sich auch einzeln starten, z. B. `node tests/web/t_lzk_ui.js`.

| Ordner  | prüft | wie |
|---------|-------|-----|
| `web/`  | Oberfläche (`public/index.html`, `lerntheke.js`/`.css`, `tag.html`, Lerntheken-Seiten) und Teile von `server.js` | Funktionen werden aus dem Quelltext herausgeschnitten und mit Attrappen (DOM, `fetch`, Daten) ausgeführt |
| `db/`   | Routen und Migrationen aus `server.js` | gegen ein echtes Postgres 16 im Prozess ([pglite](https://pglite.dev)); die Datenbank entsteht aus `initDB()` wie beim Serverstart |
| `tool/` | das Python-Tool in `tools/arbeitsstaende/app` | braucht Python 3 mit `openpyxl` und `tkinter`; dazu läuft der eigene Test des Tools |

Fehlt pglite oder Python, wird der Teil übersprungen und gemeldet (auf GitHub zählt das als Fehler).

### Zwei Hilfen in `lib/`

- `server_im_test.js` – lädt die **ganze** `server.js` gegen pglite (Express, Sessions, bcrypt
  sind Attrappen; Dateischreiben wird nur gezählt). `srv.rufe('post', '/api/talking-sessions', { session, body })`
  ruft die echte Route, `srv.rufeUrl` dasselbe mit einer fertigen URL.
- `seite_im_test.js` – lädt die **ganze** `public/index.html` in eine Sandbox. Alle Funktionen
  und Hilfen der Seite sind da, nichts muss herausgeschnitten werden:
  `seite.lauf('me = __werte.me; renderCalDetail();', { me })`, danach `seite.element('cal-detail').innerHTML`.
  Mit `seite.kontext.fetch = srv.fetchFuer(() => session)` schickt die Seite ihre Anfragen an
  den Server im Test – so laufen ganze Klickwege (Beispiel: `db/t_talk_vortragende_seite.mjs`).

## Regeln

- **Immer die echten Dateien lesen**: `lies()` aus `lib/quelle.js`, in Python `pfade.py`.
  Eine Kopie prüft irgendwann einen alten Stand, ohne dass es auffällt.
- `lies()` liefert LF-Zeilenenden. Unter Windows checkt Git CRLF aus; die Schnittmarken
  (`'\n}\n'`) fänden sonst nichts.
- Suiten schneiden Funktionen über ihre **genaue Signatur** heraus, z. B.
  `'function calLzkZeile(l, isAdmin) {'`. Wer eine Signatur ändert, zieht die Suiten nach
  (oder lässt sie und baut einen Wrapper).
- Neue Funktion oder Fehlerbehebung: erst die Prüfung, die am **alten** Stand scheitert
  (Gegenprobe), dann der Code.
- `db/fixtures/initdb_vor_lzk.sql` ist der Datenbank-Aufbau von vor der LZK-Umstellung
  (für den Upgrade-Test) – nicht anpassen.

## GitHub

`.github/workflows/tests.yml` führt `npm test` bei jedem Push aus. Das Deploy (`deploy.sh`,
per Cron) wartet **nicht** darauf: ein rotes Kreuz auf GitHub heißt, sofort nachsehen – der
Server zieht den Stand trotzdem.
