# Arbeitsstände ↔ Lerntheken-App

Zwei Richtungen:

1. **Ergebnisse holen** — Talks, Input, Kleeblätter, Stationen und LZK aus der
   Lerntheken-App in die Arbeitsstände-Datei.
2. **Konten anlegen** — die Zugänge für die Lerntheken-App aus der
   Arbeitsstände-Liste erzeugen.

Beides geht **komplett über das Menü der Anwendung**, ein Terminal wird nur zum
Starten gebraucht. Für Automatisierung gibt es dieselben Funktionen zusätzlich
als Kommandozeilen-Skript.

## Ordner

```
app/
  arbeitsstaende_app.py       Anwendung (starten mit: python3 arbeitsstaende_app.py)
  arbeitsstaende_data.py      Datenschicht (Laden/Speichern der Excel-Datei)
  osk_sync.py                 Zugriff auf die Lerntheken-App -- auch als CLI nutzbar
  test_arbeitsstaende_data.py Tests der Datenschicht
```

Voraussetzung wie bisher: `pip3 install openpyxl`.

## Der Lerntheken-Alias

Jede Person hat in der Arbeitsstände-Datei eine Spalte **Lerntheken-Alias**
(Namen-Blatt, Spalte C) — das ist ihr Benutzername in der Lerntheken-App. Er
ist die verbindliche Verbindung zwischen beiden Systemen.

Bewusst ein gepflegtes Feld und keine Ableitung bei jedem Lauf: Aus
`Anton Berger` und `Anna Bergmann` würde beide Male `an.be`, und Namen ändern
sich. Einmal gesetzt, bleibt die Zuordnung stabil.

In der Anwendung steht der Alias im Kopfbereich jeder Person und ist dort
direkt änderbar.

**Bearbeiten → Fehlende Lerntheken-Aliasse ergänzen…** füllt leere Felder mit
dem Vorschlag „2 Buchstaben Vorname . 2 Buchstaben Nachname" (`an.be`, Umlaute
werden umgeschrieben: `Jürgen Müller` → `ju.mu`). Bereits gefüllte Felder bleiben
unangetastet. **Mehrdeutigkeiten werden nicht automatisch vergeben**, sondern
gemeldet — sonst bekämen zwei Personen stillschweigend denselben Zugang.

## Menü „Lerntheken-App"

**Einstellungen…** — Adresse der App und Admin-Benutzername. Das Passwort wird
nicht gespeichert, sondern bei jeder Aktion abgefragt.

**Ergebnisse abrufen…** — meldet sich an, holt die Auswertung und schreibt sie
als Blatt **„App-Daten"** in die geöffnete Mappe: eine Zeile je Person und
Halbjahr, je Fach eigene Spalten.

| Vorname | Nachname | Account | Lerngruppe | Halbjahr | Mathe: Talks gehalten / zugehört / Input / Kleeblätter | Englisch: … | Deutsch: … | Stationen abgeschlossen | LZK bestanden | LZK-Kleeblätter | Stand |

Danach noch speichern. Personen, deren Alias zu keinem Konto passt, werden
gemeldet.

**Konten anlegen…** — legt Zugänge für alle Personen an, die einen Alias haben,
aber noch **kein** Konto in der App. Vorhandene Konten werden nicht angefasst.
Vorher gibt es eine Vorschau mit Rückfrage.

**Aliasse exportieren…** — schreibt eine Textdatei `alias,passwort` zum
Einfügen im Bulk-Dialog der Lerntheken-App. Alternative, falls du lieber in der
Weboberfläche anlegst.

## Wichtig: Lerngruppe

Ein Admin-Konto sieht immer **genau seine Lerngruppe**, und neue Konten
entstehen genau dort. Für mehrere Lerngruppen also mit dem jeweils passenden
Admin-Konto anmelden (Einstellungen umstellen).

## Start-Passwort

Alle neu angelegten Konten bekommen dasselbe Start-Passwort. Bis zur ersten
Änderung könnte sich damit — zusammen mit dem bekannten Namensschema — jede:r
bei anderen anmelden. Also ein Passwort nur für diesen Zweck wählen und die
Schüler:innen es beim ersten Login ändern lassen (🔑 in der Kopfzeile der App).

## Kommandozeile (optional)

Dieselben Funktionen ohne Oberfläche, z.B. für wiederkehrende Abrufe:

```
cd app
python3 osk_sync.py --dry-run        # prüfen, nichts schreiben
python3 osk_sync.py                  # Ergebnisse in die Excel-Datei
python3 osk_sync.py --bulk-liste     # Kontenliste erzeugen
python3 osk_sync.py --bulk-anlegen   # Konten direkt anlegen
```

Dafür braucht es eine `osk_sync_config.json` neben dem Skript:

```json
{
  "base_url": "https://mathe.offene-schule-koeln.online",
  "excel": "/Pfad/zu/2627_Arbeitsstaende.xlsm",
  "accounts": [{ "username": "koek" }]
}
```

Ohne hinterlegtes Passwort fragt das Skript danach. Die Datei ist gitignored.

Die Kommandozeilen-Variante ordnet über die Namensregel zu (nicht über die
Alias-Spalte) und pflegt dafür ein eigenes Blatt „App-Zuordnung". Wenn du in der
Anwendung arbeitest, ist die Alias-Spalte der verlässlichere Weg.

## Zusammenspiel der beiden Wege

Die Anwendung löscht beim Speichern grundsätzlich Blätter, die sie nicht kennt.
Blätter, die mit **`App-`** beginnen, sind davon ausgenommen — „App-Daten" und
„App-Zuordnung" überstehen also ein Speichern aus der Anwendung.

## Datenschutz

Es werden personenbezogene Schülerdaten verarbeitet. Die Anwendung spricht
ausschließlich mit eurem eigenen Server und schreibt ausschließlich in die
lokale Excel-Datei. Das Admin-Passwort wird nirgends gespeichert.
