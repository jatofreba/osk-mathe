# Arbeitsstände -- Desktop-Anwendung

Eine eigenständige Python-Anwendung zur Bausteinarbeit -- als Ersatz für die
Excel/VBA-Version. Läuft nur auf deinem eigenen Rechner, schreibt direkt in
eine ganz normale .xlsx-Datei (kein Makro-Sicherheitshinweis, kein
"Inhalt aktivieren").

## Einmalige Einrichtung

1. Python 3 muss installiert sein. Prüfen im Terminal:
   ```
   python3 --version
   ```
   Falls nicht vorhanden: https://www.python.org/downloads/ (Installer für Mac).
   Falls du Python über Homebrew installierst, zusätzlich:
   ```
   brew install python-tk
   ```
   (Die Oberfläche braucht das "tkinter"-Paket, das bei manchen Homebrew-
   Installationen separat dazukommt. Der Installer von python.org bringt
   es schon mit.)

2. Eine einzige Abhängigkeit installieren:
   ```
   pip3 install openpyxl
   ```

## Starten

```
python3 arbeitsstaende_app.py
```

Am einfachsten machst du dir eine Doppelklick-Startdatei (einmalig):
Rechtsklick auf einen neuen Text-Datei-Namen `Arbeitsstände starten.command`
mit dem Inhalt:
```
cd "ORDNERPFAD_HIER_EINSETZEN"
python3 arbeitsstaende_app.py
```
und einmal ausführbar machen: `chmod +x "Arbeitsstände starten.command"`.
Danach reicht ein Doppelklick auf diese Datei.

## Bedienung

- **Beim Start** öffnet sich automatisch die Datei, an der du zuletzt
  gearbeitet hast -- du musst also nichts auswählen, sondern kannst direkt
  weitermachen. Nur beim allerersten Mal ist ein Schritt nötig:
  **Datei → Aus Excel importieren…** (siehe unten).
- **Datei → Öffnen…**: eine andere Arbeitsdatei (`.json`) laden -- oder eine
  Excel-Mappe, wenn du doch einmal eine ältere Datei brauchst.
- Links: Liste aller Schüler:innen, **sortiert nach Jahrgangsstufe und
  innerhalb der Stufe alphabetisch**. Fehlt bei jemandem die
  Jahrgangsstufe, rutscht die Person ans Ende der Liste -- einfach im
  Kopfbereich rechts nachtragen, dann steht sie beim nächsten Aktualisieren
  richtig einsortiert. Überfällige oder offene Deadlines sind unabhängig
  von der Sortierung weiterhin rot bzw. gelb markiert (siehe Deadline-
  Spalte). Suchfeld filtert zusätzlich nach Namen. **+ Hinzufügen** /
  **− Entfernen** für die ganze Person.
- Die Spalte **FB zuletzt** hat einen eigenen Farbcode (unabhängig von der
  Zeilenfarbe für Deadlines): 🟢 vor bis zu 7 Tagen da gewesen, 🟡 8-14
  Tage her, 🔴 länger her oder noch nie. Die zwei Schwellenwerte stehen als
  `FB_GRUEN_TAGE` / `FB_GELB_TAGE` ganz am Anfang der Klasse `App` in
  `arbeitsstaende_app.py`, falls dir andere Abstände lieber sind -- sag
  mir sonst einfach Bescheid, dann ändere ich es.
- **War heute im FB**: eine oder mehrere Personen in der Liste auswählen
  (mehrere geht mit Cmd-Klick bzw. Shift-Klick) und klicken -- trägt das
  heutige Datum ein.
- **FB-Besuch nachtragen…**: genauso, fragt aber nach einem Datum (z.B. für
  einen vergessenen Eintrag von letzter Woche).
- Rechts: Kopfdaten (Kursung, Jahrgangsstufe, HJ-Note). "Letzter Besuch FB"
  wird hier nur angezeigt -- eingetragen wird ausschließlich über die beiden
  Buttons links, damit es nicht zwei widersprüchliche Datenquellen gibt.
  Darunter die Bausteinliste dieser Person. **+ Baustein** legt eine neue Zeile an
  (Standard-Bausteine UND frei benannte individuelle Zeilen -- beides geht
  genau wie bisher in Excel). Doppelklick auf eine Zeile öffnet sie zum
  Bearbeiten.
- **Sonstige Deadline + Anlass** (im Kopfbereich rechts): eine Frist, die
  nichts mit einer LZK zu tun hat -- Referat abgeben, etwas mitbringen,
  etwas drucken. Der Anlass steht in der Liste links direkt neben dem
  Datum; kommt die Frist aus einer LZK, steht dort "LZK". Angezeigt wird
  immer der nächstliegende der beiden Termine, und die Spalte **Anlass**
  lässt sich wie jede andere über ihren Kopf sortieren.
- **Bemerkung zur LZK 1 / 2** (im Baustein-Formular): kurze Notiz zur
  jeweiligen Leistungszielkontrolle ("nur Teil 1", "Nachschreibtermin").
  Sie erscheint in der Baustein-Tabelle hinter dem jeweiligen Datum.
- **Bearbeiten → Standard-Bausteine bearbeiten…**: die Liste, die neu
  angelegte Schüler:innen automatisch bekommen (entspricht der alten
  "Vorlage_31" in Excel).
- **Datei → Speichern**: schreibt direkt in dieselbe Datei zurück -- kein
  Download, kein Umbenennen nötig. **Speichern unter…** für eine Kopie oder
  den allerersten Speichervorgang.

## Verbindung zur Lerntheken-App (Menü „Lerntheken-App")

Jede Person hat im Kopfbereich ein Feld **Lerntheken-Alias** -- ihren
Benutzernamen in der Lerntheken-App (im Namen-Blatt Spalte C). Er ist die
Verbindung zwischen beiden Systemen und wird gepflegt, nicht jedes Mal neu
geraten: aus `Anton Berger` und `Anna Bergmann` würde beide Male `an.be`, und
Namen ändern sich.

- **Bearbeiten → Fehlende Lerntheken-Aliasse ergänzen…** füllt leere Felder mit
  dem Vorschlag „2 Buchstaben Vorname . 2 Buchstaben Nachname" (`an.be`;
  Umlaute werden umgeschrieben, `Jürgen Müller` → `ju.mu`). Schon gefüllte
  Felder bleiben. Wenn zwei Personen denselben Vorschlag ergäben, wird das
  **gemeldet und nicht vergeben** -- sonst hätten beide denselben Zugang.
- **Lerntheken-App → Einstellungen…**: Adresse der App und Admin-Benutzername.
  Das Passwort wird nicht gespeichert, sondern bei jeder Aktion abgefragt.
- **Lerntheken-App → Ergebnisse abrufen…**: holt Talks, Input, Kleeblätter,
  Stationen und LZK und schreibt sie als Blatt **„App-Daten"** in die geöffnete
  Mappe -- eine Zeile je Person und Halbjahr, je Fach eigene Spalten. Danach
  noch speichern.
- **Lerntheken-App → Konten anlegen…**: legt Zugänge für alle Personen an, die
  einen Alias haben, aber noch kein Konto. Mit Vorschau und Rückfrage;
  bestehende Konten werden nicht angefasst.
- **Lerntheken-App → Aliasse exportieren…**: Textdatei `alias,passwort` zum
  Einfügen im Bulk-Dialog der Weboberfläche.

Ein Admin-Konto sieht immer **genau seine Lerngruppe**, und neue Konten
entstehen dort. Für eine andere Lerngruppe in den Einstellungen das passende
Admin-Konto eintragen.

Alle neu angelegten Konten bekommen dasselbe Start-Passwort. Wähle eins, das
nur dafür gilt, und lass es die Schüler:innen beim ersten Login ändern.

Blätter, deren Name mit `App-` beginnt, werden beim Speichern nicht angetastet.

## Speicherformat: einmal Excel, danach Arbeitsdatei

Gearbeitet wird in einer **Arbeitsdatei mit der Endung `.json`**. Die ist
verlustfrei (sie kennt alle Felder der App), lässt sich später erweitern und
ist trotzdem im Klartext lesbar -- du kannst sie zur Not in jedem Texteditor
öffnen und korrigieren. Der Ablauf:

1. **Einmalig:** *Datei → Aus Excel importieren…*, deine bisherige
   `.xlsm`/`.xlsx` auswählen. Danach fragt die App, wo die Arbeitsdatei
   liegen soll (Vorschlag: gleicher Ordner, gleicher Name, Endung `.json`).
   Die **Excel-Datei selbst wird dabei nie verändert**.
2. **Ab dann:** Anwendung starten -- die Arbeitsdatei ist sofort wieder da.
   Kein Importieren, kein Auswählen, kein Neuaufbau.
3. **Wenn du Excel brauchst** (ausdrucken, weitergeben, in Excel
   nachschauen): *Datei → Als Excel exportieren…* schreibt den aktuellen
   Stand als `.xlsx` heraus -- mit Namen-Blatt und Personenblättern wie
   gewohnt. Die Arbeitsdatei bleibt davon unberührt; gearbeitet wird
   weiterhin in der `.json`.

So sieht ein Eintrag in der Arbeitsdatei aus:

```json
{
  "vorname": "Anton",
  "nachname": "Berger",
  "lerntheken_alias": "an.be",
  "jahrgangsstufe": 9,
  "sonstige_deadline": "2026-09-20",
  "sonstige_deadline_anlass": "Referat drucken",
  "fb_besuche": ["2026-08-25", "2026-09-01"],
  "bausteine": [
    {
      "name": "Kreise und Zylinder",
      "status": "In Bearbeitung",
      "halbjahr": "2627_1",
      "lzk_1": { "datum": "2026-11-05", "bemerkung": "nur Teil 1" }
    }
  ]
}
```

Leere Felder stehen gar nicht erst drin. Kommen später neue Angaben dazu,
lassen sich ältere Dateien weiterhin öffnen -- Unbekanntes wird beim Laden
gemeldet statt zu stören.

## Automatische Sicherung

- **In Excel-Dateien schreibt die Anwendung nie von selbst.** Gespeichert
  wird ausschließlich in die `.json`-Arbeitsdatei; eine `.xlsx` entsteht nur,
  wenn du sie über *Als Excel exportieren…* anforderst. Auch "Speichern" und
  "Speichern unter…" legen immer eine `.json` an -- gibst du dort eine andere
  Endung ein, wird sie ersetzt.
- Brichst du beim Import die Frage nach der Arbeitsdatei ab, wird nichts
  vorgemerkt; "Speichern" fragt dann beim nächsten Mal erneut danach und
  schlägt den Ordner der importierten Datei vor.
- Ab dann läuft eine **automatische Sicherung alle 5 Minuten** im
  Hintergrund, sobald es etwas Ungespeichertes gibt -- lautlos, ohne
  Rückfrage. Die Statuszeile unten zeigt jeweils Uhrzeit und Zieldatei; falls
  es einmal nicht klappt, steht dort eine Warnung.
- **Datei → Speichern** und **Speichern unter…** funktionieren wie gewohnt
  daneben, für's Speichern zwischendurch von Hand.

## Was beim Import aus deiner bisherigen Excel-Datei übernommen wird

Alle Personen, alle Bausteinzeilen (auch deine individuellen Zusatzzeilen),
Status, Noten, Termine und die komplette FB-Besuchshistorie aus dem
Anwesenheits-Raster im Namen-Blatt werden eingelesen. Die Besuchshistorie
ist jetzt direkt in der App nutzbar (siehe "War heute im FB" oben) und wird
beim Speichern als das gleiche Datums-Raster zurückgeschrieben -- neue
Besuchstage werden dabei automatisch zu neuen Spalten.

## Was sich ändert

- Gearbeitet wird in der `.json`-Arbeitsdatei; der **Excel-Export enthält
  keine Makros** -- die Buttons/VBA aus der alten Datei sind dort also nicht
  mehr dabei, weil du ab jetzt über diese Anwendung statt über
  Excel-Buttons arbeitest. Deine ursprüngliche `.xlsm`-Datei bleibt beim
  Import unangetastet.
- "Aktueller Baustein" und "Nächste Deadline" im Namen-Blatt werden beim
  Speichern automatisch neu berechnet (gleiche Logik wie bisher: nächster
  anstehender LZK-Termin, sonst "Frist vereinbaren!", wenn ein Baustein
  "In Bearbeitung" ist, aber kein Termin steht).

## Getestet

Die komplette Lade-/Speicherlogik läuft unter `python3 test_arbeitsstaende_data.py`
gegen automatisierte Tests (Laden, Hinzufügen, Entfernen, individuelle
Bausteine, Rundtrip-Erhalt aller Daten). Diese Datei kannst du jederzeit
erneut laufen lassen, auch nach eigenen Änderungen am Code.
