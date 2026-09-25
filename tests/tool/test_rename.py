"""Prueft die Umbenennen-Funktion: Client-Methode + Server-Endpunkt (statisch)."""
import io
import json
import sys
from urllib import error

import os  # noqa: E402
import importlib.util  # noqa: E402
from pfade import WURZEL, WERKZEUG  # noqa: E402

spec = importlib.util.spec_from_file_location("rn_sync", os.path.join(WERKZEUG, "osk_sync.py"))
rn_sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rn_sync)


class FakeClient(rn_sync.AppClient):
    """AppClient ohne Netz: _post wird ersetzt."""
    def __init__(self, antwort=None, fehler=None):
        self.base = "http://test"
        self._antwort = antwort
        self._fehler = fehler
        self.aufruf = None

    def _post(self, pfad, daten):
        self.aufruf = (pfad, daten)
        if self._fehler:
            raise self._fehler
        return self._antwort


def http_error(code, payload):
    return error.HTTPError("http://test", code, "err", {},
                           io.BytesIO(json.dumps(payload).encode("utf-8")))


# --- 1: Erfolgsfall ---
c = FakeClient(antwort={"ok": True, "id": 42, "username": "ben.ja"})
assert c.umbenennen(42, "ben.ja") == "ben.ja"
assert c.aufruf == ("/api/admin/student/42/rename", {"username": "ben.ja"}), c.aufruf
print("T1 (ruft den richtigen Endpunkt und gibt den neuen Namen zurueck) OK")

# --- 2: Name schon vergeben -> lesbarer Fehler statt HTTPError ---
c = FakeClient(fehler=http_error(409, {"error": "Benutzername bereits vergeben"}))
try:
    c.umbenennen(42, "be.ja")
    assert False, "T2 FAIL: haette ValueError werfen muessen"
except ValueError as e:
    assert "bereits vergeben" in str(e), str(e)
print("T2 (Namenskollision wird als lesbarer Fehler gemeldet) OK")

# --- 3: Konto nicht gefunden ---
c = FakeClient(fehler=http_error(404, {"error": "Nicht gefunden"}))
try:
    c.umbenennen(9999, "x.y")
    assert False, "T3 FAIL"
except ValueError as e:
    assert "Nicht gefunden" in str(e)
print("T3 (unbekanntes Konto wird gemeldet) OK")

# --- 4: Fehler ohne lesbaren Body -> trotzdem verstaendliche Meldung ---
c = FakeClient(fehler=error.HTTPError("http://test", 500, "err", {}, io.BytesIO(b"kein json")))
try:
    c.umbenennen(1, "x.y")
    assert False, "T4 FAIL"
except ValueError as e:
    assert "500" in str(e), str(e)
print("T4 (auch ohne JSON-Body kommt eine verstaendliche Meldung) OK")

# --- 5: Server-Endpunkt aendert wirklich nur den Namen ---
srv = open(os.path.join(WURZEL, "server.js"), encoding="utf-8").read()
i = srv.index("app.post('/api/admin/student/:id/rename'")
# Genau bis zum Ende dieses Handlers schneiden - sonst rutscht der folgende
# Loesch-Endpunkt mit ins Fenster und die Pruefungen unten laufen ins Leere.
ep = srv[i:srv.index("app.delete('/api/admin/student/:id'", i)]
assert "UPDATE users SET username=$1" in ep, "T5 FAIL: kein Namens-Update"
assert "role=$4" in ep and "klasse=$3" in ep, "T5 FAIL: nicht auf Schueler:innen der Lerngruppe begrenzt"
assert "23505" in ep, "T5 FAIL: Kollision (unique constraint) nicht abgefangen"
assert "DELETE" not in ep.upper().replace("DELETED", ""), "T5 FAIL: darf nichts loeschen"
for tabelle in ("progress", "lzk", "talking_", "station_events", "korrektur"):
    assert tabelle not in ep, f"T5 FAIL: fasst {tabelle} an - darf es nicht"
print("T5 (Endpunkt aendert ausschliesslich users.username, scoped auf die Lerngruppe) OK")

print("ALL TESTS PASSED")
