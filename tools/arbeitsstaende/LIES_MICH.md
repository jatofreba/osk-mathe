# Ergebnisse aus der OSK-App in die Arbeitsstände-Datei holen

`osk_sync.py` meldet sich mit einem **Admin-Konto** an der App an, holt die
Auswertung je Schüler:in und schreibt sie in die Arbeitsstände-Excel-Datei.
Die vorhandenen Personenblätter, das Namen-Blatt und die Makros bleiben dabei
unangetastet -- es kommen nur zwei neue Blätter dazu.

## Einrichtung

```
pip3 install openpyxl
```

Dann eine Datei `osk_sync_config.json` neben das Skript legen:

```json
{
  "base_url": "https://mathe.offene-schule-koeln.online",
  "excel": "/Pfad/zu/2627_Arbeitsstaende.xlsm",
  "accounts": [
    { "username": "koek" }
  ]
}
```

**Passwörter gehören nicht in diese Datei.** Lässt du sie weg, fragt das Skript
beim Start danach. Alternativ als Umgebungsvariable `OSK_PW_KOEK`. Die
Konfigurationsdatei sollte nicht ins Git-Repository wandern (siehe
`.gitignore`).

Ein Admin-Konto sieht immer **genau seine Lerngruppe**. Für mehrere Lerngruppen
mehrere Konten unter `accounts` eintragen -- die Ergebnisse werden zusammengeführt.

## Aufruf

```
python3 osk_sync.py             # holen und schreiben
python3 osk_sync.py --dry-run   # nur prüfen, nichts speichern
```

Der erste Lauf sollte ein `--dry-run` sein: dabei siehst du, welche Personen
zugeordnet werden konnten und wo es hakt, ohne dass die Datei angefasst wird.

## Was entsteht

**Blatt „App-Daten"** -- eine Zeile je Person und Halbjahr, je Fach eigene Spalten:

| Vorname | Nachname | Account | Lerngruppe | Halbjahr | Mathe: Talks gehalten | Mathe: Talks zugehört | Mathe: Input | Mathe: Kleeblätter | Englisch: … | Deutsch: … | Stationen abgeschlossen | LZK bestanden | LZK-Kleeblätter | Stand |

Bewusst eine flache Tabelle: so lässt sie sich filtern, sortieren und per Pivot
auswerten, ohne die gewachsene Struktur der Personenblätter anzufassen. Die
Spalte „Stand" hält fest, wann die Zahlen geholt wurden.

**Blatt „App-Zuordnung"** -- dokumentiert, welches Personenblatt zu welchem
App-Konto gehört, und ist gleichzeitig die Stelle zum Korrigieren.

## Namens-Zuordnung

Der Accountname wird abgeleitet aus **den ersten 2 Buchstaben des Vornamens,
einem Punkt und den ersten 2 Buchstaben des Nachnamens**:
`Anton Berger` → `an.be`. Umlaute werden vorher umgeschrieben
(`Jürgen Müller` → `ju.mu`).

Zwei Fälle brauchen deine Aufmerksamkeit, das Skript meldet beide:

- **Mehrdeutige Kurznamen.** `Anton Berger` und `Anna Bergmann` ergeben beide
  `an.be`. Ohne Eingriff bekämen beide dieselben Zahlen. Trage im Blatt
  „App-Zuordnung" den richtigen Accountnamen von Hand ein -- dieser Eintrag hat
  beim nächsten Lauf Vorrang.
- **Kein Konto gefunden.** Die Person steht rot markiert im Zuordnungsblatt und
  bekommt keine Zahlen, statt still leer zu bleiben.

Umgekehrt werden App-Konten gemeldet, zu denen es kein Personenblatt gibt.

## Umgekehrter Weg: Konten aus der Excel-Liste anlegen

Für den Start eines Schuljahres lassen sich die Konten aus der Excel-Liste
erzeugen. Grundlage sind genau die Personen, für die es **noch kein** App-Konto
gibt -- wer schon eins hat, wird nicht angefasst.

```
# 1) Liste erzeugen und ansehen (schreibt nichts auf dem Server)
python3 osk_sync.py --bulk-liste --passwort "Start2627!"

# 2a) Inhalt von bulk_konten.txt in der App unter "Mehrere anlegen" einfügen
# 2b) ODER direkt anlegen lassen:
python3 osk_sync.py --bulk-anlegen --passwort "Start2627!"
```

Ohne `--passwort` fragt das Skript danach (Minimum 4 Zeichen). Die erzeugte
Datei hat genau das Format des Bulk-Dialogs:

```
an.be,Start2627!
ju.mu,Start2627!
```

`--bulk-anlegen` fragt vor dem Schreiben nach einer Bestätigung und meldet
danach, wie viele Konten angelegt und wie viele übersprungen wurden
(übersprungen = Benutzername existiert bereits).

**Lerngruppe:** Die App legt neue Konten immer in der Lerngruppe des
angemeldeten Admin-Kontos an. Sind mehrere Konten konfiguriert, musst du mit
`--lerngruppe M3M4` sagen, welche gemeint ist -- sonst bricht das Skript ab,
statt zu raten.

**Zum Start-Passwort:** Alle neuen Konten bekommen dasselbe. Das ist für einen
einmaligen Rutsch praktikabel, heißt aber auch: bis zur ersten Änderung könnte
sich jede:r mit dem Namensschema und diesem Passwort bei anderen anmelden.
Deshalb ein Passwort wählen, das nur für diesen Zweck gilt, und die
Schüler:innen es beim ersten Login ändern lassen (🔑 in der Kopfzeile).

## Wichtig: Zusammenspiel mit der Arbeitsstände-App

Die Arbeitsstände-App löscht beim Speichern **jedes Blatt, das weder „Namen"
noch „Vorlage" noch ein Personenname ist** (`arbeitsstaende_data.py`,
Methode `speichern`). Ohne Anpassung wären „App-Daten" und „App-Zuordnung"
nach dem nächsten Speichern aus der App also wieder weg.

Dagegen hilft eine Zeile in `arbeitsstaende_data.py`:

```python
        # vorher
        for sheetname in list(wb.sheetnames):
            if sheetname in ("Namen", "Vorlage"):
                continue

        # nachher
        for sheetname in list(wb.sheetnames):
            if sheetname in ("Namen", "Vorlage", "App-Daten", "App-Zuordnung"):
                continue
```

Solange das nicht angepasst ist, gilt: erst in der App arbeiten und speichern,
**danach** `osk_sync.py` laufen lassen. Verloren geht dabei nichts Bleibendes --
die Zahlen stammen aus der App und lassen sich jederzeit neu holen.

## Datenschutz

Es werden personenbezogene Schülerdaten verarbeitet. Das Skript spricht
ausschließlich mit eurem eigenen Server und schreibt ausschließlich in die
lokale Excel-Datei -- nichts wird an Dritte übertragen. Zugangsdaten stehen
nicht im Skript und sollten auch nicht in der Konfigurationsdatei stehen.
