#!/bin/sh
# Kopiert die Arbeitsstände-Anwendung aus dem Repo in den OneDrive-Ordner,
# aus dem sie tatsächlich gestartet wird.
#
# Bewusst KOPIEREN und nicht spiegeln: Dateien, die nur in OneDrive liegen
# (z.B. osk_einstellungen.json mit Serveradresse und Admin-Benutzername oder
# __pycache__), bleiben unangetastet. Es wird nichts gelöscht.
#
# Aufruf von Hand:
#     sh tools/arbeitsstaende/sync_to_onedrive.sh
# Automatisch: über die Git-Hooks post-commit / post-merge (siehe LIES_MICH.md).

set -e

ZIEL="${OSK_APP_ZIEL:-/c/Users/jbath/OneDrive - OSK Offene Schule Köln gGmbH/Unterricht/MatheM3M4/Organisation}"

# Ordner dieses Skripts -> app/ daneben. Damit funktioniert der Aufruf aus
# jedem Arbeitsverzeichnis, auch aus einem Git-Hook heraus.
HIER="$(cd "$(dirname "$0")" && pwd)"
QUELLE="$HIER/app"

if [ ! -d "$QUELLE" ]; then
  echo "Quelle nicht gefunden: $QUELLE" >&2
  exit 1
fi
if [ ! -d "$ZIEL" ]; then
  # Kein Fehler: auf einem anderen Rechner (oder ohne OneDrive) gibt es den
  # Ordner schlicht nicht -- dann still nichts tun, damit Git-Hooks nicht
  # bei jedem Commit meckern.
  echo "OneDrive-Ordner nicht vorhanden, übersprungen: $ZIEL"
  exit 0
fi

# osk_sync.py MUSS mit: arbeitsstaende_app.py importiert es beim Start.
DATEIEN="arbeitsstaende_app.py arbeitsstaende_data.py osk_sync.py test_arbeitsstaende_data.py LIES_MICH.md"

GEAENDERT=0
for f in $DATEIEN; do
  if [ ! -f "$QUELLE/$f" ]; then
    echo "  fehlt in der Quelle: $f" >&2
    continue
  fi
  if [ -f "$ZIEL/$f" ] && cmp -s "$QUELLE/$f" "$ZIEL/$f"; then
    continue                      # unverändert -> nicht anfassen
  fi
  cp "$QUELLE/$f" "$ZIEL/$f"
  echo "  aktualisiert: $f"
  GEAENDERT=$((GEAENDERT + 1))
done

if [ "$GEAENDERT" -eq 0 ]; then
  echo "Arbeitsstände-App in OneDrive ist aktuell."
else
  echo "Arbeitsstände-App in OneDrive aktualisiert ($GEAENDERT Datei(en))."
fi
