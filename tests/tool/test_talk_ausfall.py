"""Ausgefallene Mathe-Talks (Lernbegleitung krank, Nutzerwunsch 2026-11-19) laesst das Tool
beim Abruf aus - sie zaehlen in der App nirgends und sollen hier nicht als "noch nicht
bewertet" auftauchen."""
import sys

from pfade import WERKZEUG  # noqa: F401  (setzt den Suchpfad aufs Tool)
import osk_sync  # noqa: E402

ok = 0


def pruefe(name, bedingung, extra=""):
    global ok
    if not bedingung:
        print(f"FAIL: {name}  {extra}")
        sys.exit(1)
    ok += 1
    print(f"OK  {name}")


client = osk_sync.AppClient.__new__(osk_sync.AppClient)
abgerufen = []
client._get = lambda pfad: abgerufen.append(pfad) or [
    {"id": 1, "ausfall": None}, {"id": 2, "ausfall": "krank"}, {"id": 3}]
talks = client.mathe_talks()
pruefe("A1 ausgefallene fehlen, die anderen bleiben (auch ohne das Feld)", [t["id"] for t in talks] == [1, 3], talks)
pruefe("A2 abgerufen wird dieselbe Liste wie bisher", abgerufen == ["/api/admin/talking-slots?typ=talk&subject=mathe"], abgerufen)
client._get = lambda pfad: None
pruefe("A3 ohne Antwort: leere Liste statt Absturz", client.mathe_talks() == [])

print(f"\n{ok} Prüfungen bestanden.")
