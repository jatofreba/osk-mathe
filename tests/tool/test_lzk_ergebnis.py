"""LZK-Ergebnis im Python-Tool: Datenmodell, Speichern/Laden, Vergleich mit dem
Server, Baustein-Dialog und der Abgleich in beide Richtungen."""
import dataclasses
import importlib.util
import os
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
from pfade import WERKZEUG  # noqa: E402
NEU = WERKZEUG
for name in ("arbeitsstaende_data", "osk_sync", "arbeitsstaende_app"):
    sys.modules.pop(name, None)
import arbeitsstaende_data as D  # noqa: E402
import arbeitsstaende_app as A   # noqa: E402

ok = 0


def pruefe(name, bedingung, extra=""):
    global ok
    if not bedingung:
        print(("FAIL: " + name + (("\n      " + str(extra)) if extra else "")).encode("ascii", "replace").decode("ascii"))
        sys.exit(1)
    ok += 1
    print("OK  " + name)


# ===========================================================================
# 1) Datenmodell und Umrechnung
# ===========================================================================
b = D.Baustein(name="Kreise")
pruefe("M1 ein neuer Baustein ist unbewertet", b.lzk_ergebnis_1 == "" and b.lzk_ergebnis_2 == "")
pruefe("M2 alle Werte haben einen Anzeigetext", all(w in D.LZK_ERGEBNIS_TEXT for w in D.LZK_ERGEBNIS_WERTE))
pruefe("M3 ausstehend ist 'nicht bewertet'", D.lzk_ergebnis_von_server({"status": "ausstehend", "pokale": 0}) == "")
pruefe("M3b kein Eintrag ebenso", D.lzk_ergebnis_von_server(None) == "")
pruefe("M3c bestanden mit Flammen", D.lzk_ergebnis_von_server({"status": "bestanden", "pokale": 2}) == "2")
pruefe("M3d bestanden ohne Flammen (Altbestand)", D.lzk_ergebnis_von_server({"status": "bestanden", "pokale": 0}) == "0")
pruefe("M3e nicht bestanden", D.lzk_ergebnis_von_server({"status": "nicht_bestanden", "pokale": 0}) == "nicht_bestanden")
pruefe("M4 zum Server: Flammen heissen bestanden", D.lzk_ergebnis_zum_server("3") == ("bestanden", 3))
pruefe("M4b nicht bestanden ohne Flammen", D.lzk_ergebnis_zum_server("nicht_bestanden") == ("nicht_bestanden", 0))
pruefe("M4c 'nicht bewertet' wird NIE geschickt", D.lzk_ergebnis_zum_server("") is None)
for w in D.LZK_ERGEBNIS_WERTE:
    if w:
        st, pk = D.lzk_ergebnis_zum_server(w)
        pruefe(f"M5 Hin und zurueck bleibt '{w}' gleich",
               D.lzk_ergebnis_von_server({"status": st, "pokale": pk}) == w)

# ===========================================================================
# 2) Speichern und Laden - alte Dateien bleiben lesbar
# ===========================================================================
b = D.Baustein(name="Kreise", lzk_note_1="gut, Teil 2 wiederholen", lzk_ergebnis_1="2",
               lzk_ergebnis_2="nicht_bestanden")
d = D.baustein_als_dict(b)
pruefe("S1 das Ergebnis wird mitgespeichert", d["lzk_1"]["ergebnis"] == "2" and d["lzk_2"]["ergebnis"] == "nicht_bestanden", d)
pruefe("S1b die freie Note bleibt daneben", d["lzk_1"]["note"] == "gut, Teil 2 wiederholen", d)
b2 = D.baustein_aus_dict(d)
pruefe("S2 und wieder gelesen", b2.lzk_ergebnis_1 == "2" and b2.lzk_ergebnis_2 == "nicht_bestanden"
       and b2.lzk_note_1 == "gut, Teil 2 wiederholen", b2)
alt = {"name": "Kreise", "status": "In Bearbeitung",
       "lzk_1": {"datum": "2026-09-10", "note": "2-", "bemerkung": "Nachschreiben"}}
b3 = D.baustein_aus_dict(alt)
pruefe("S3 eine alte Datei ohne Ergebnis laedt unveraendert",
       b3.lzk_note_1 == "2-" and b3.lzk_bem_1 == "Nachschreiben" and str(b3.lzk_datum_1) == "2026-09-10"
       and b3.lzk_ergebnis_1 == "", b3)
pruefe("S3b ein unbekannter Wert wird nicht geraten", D.baustein_aus_dict({"name": "x", "lzk_1": {"ergebnis": "super"}}).lzk_ergebnis_1 == "")
pruefe("S4 unbewertete Bausteine schreiben kein leeres Feld", "ergebnis" not in D.baustein_als_dict(D.Baustein(name="y", lzk_note_1="3")).get("lzk_1", {}))

# ===========================================================================
# 3) Vergleich mit dem Server
# ===========================================================================
TITEL = {"kreise-und-zylinder": "Kreise und Zylinder", "lineare-funktionen": "Lineare Funktionen"}
app = D.Baustein(name="Kreise und Zylinder", bemerkung=D.LT_MARKER + " aus der App",
                 lzk_ergebnis_1="3", lzk_ergebnis_2="")
hand = D.Baustein(name="Kreise und Zylinder", bemerkung="von Hand", lzk_ergebnis_1="1")
st = D.Student(vorname="Merle", nachname="T", alias="me.te", bausteine=[app, hand])
konto = {"id": 5, "username": "me.te", "lzk": [
    {"lerntheke": "kreise-und-zylinder", "typ": "Basis", "datum": "2026-09-10", "status": "bestanden", "pokale": 1},
    {"lerntheke": "kreise-und-zylinder", "typ": "Aufbau", "datum": "2026-10-01", "status": "bestanden", "pokale": 2},
]}
u = D.lt_lzk_ergebnis_unterschiede(st, konto, TITEL)
pruefe("V1 beide abweichenden LZK werden gefunden", len(u) == 2, u)
basis = next(x for x in u if x["typ"] == "Basis")
pruefe("V2 mit Wert hier und online", basis["hier"] == "3" and basis["online"] == "1", basis)
pruefe("V2b und dem Datum auf dem Server - es geht beim Schreiben unveraendert mit", basis["datum_server"] == "2026-09-10", basis)
pruefe("V2c und dem Baustein, in den ein Ergebnis zurueckgeschrieben wird", basis["baustein"] is app, "")
pruefe("V3 von Hand angelegte Zeilen zaehlen nicht", all(x["baustein"] is app for x in u), u)
app.lzk_ergebnis_1, app.lzk_ergebnis_2 = "1", "2"
pruefe("V4 gleicher Stand - keine Unterschiede", D.lt_lzk_ergebnis_unterschiede(st, konto, TITEL) == [])

# ===========================================================================
# 4) Baustein-Dialog: kein Feld darf beim Bearbeiten verloren gehen
# ===========================================================================
quelle = open(os.path.join(NEU, "arbeitsstaende_app.py"), encoding="utf-8").read()
dialog = quelle.split("class BausteinDialog")[1].split("\nclass ")[0]
felder_im_dialog = {z.split('"')[3] for z in dialog.split("felder = [")[1].split("\n        ]")[0].splitlines()
                    if z.strip().startswith('("')}
alle = {f.name for f in dataclasses.fields(D.Baustein)}
# Nicht im Formular, aber ausdruecklich durchgereicht: die Verknuepfung mit der LZK online.
durchgereicht = ({"lzk_online_1", "lzk_online_2"}
                 if 'werte["lzk_online_1"], werte["lzk_online_2"] = self._verknuepfung' in dialog else set())
pruefe("B1 JEDES Baustein-Feld steht im Dialog oder wird durchgereicht (sonst loescht Bearbeiten es)",
       alle <= felder_im_dialog | durchgereicht, sorted(alle - felder_im_dialog - durchgereicht))


class Wert:
    def __init__(self, w):
        self._w = w

    def get(self, *a):
        return self._w


dlg = A.BausteinDialog.__new__(A.BausteinDialog)
dlg.destroy = lambda: None
dlg.result = None
dlg._verknuepfung = (None, None)   # setzt sonst __init__
dlg.vars = {f: Wert("") for f in felder_im_dialog}
dlg.vars["name"] = Wert("Kreise und Zylinder")
dlg.vars["lzk_ergebnis_1"] = Wert(D.LZK_ERGEBNIS_TEXT["2"])
dlg.vars["lzk_ergebnis_2"] = Wert(D.LZK_ERGEBNIS_TEXT["nicht_bestanden"])
dlg.vars["lzk_note_1"] = Wert("Teil 2 wackelig")
dlg._uebernehmen()
pruefe("B2 der Dialog speichert den Wert, nicht den Anzeigetext",
       dlg.result.lzk_ergebnis_1 == "2" and dlg.result.lzk_ergebnis_2 == "nicht_bestanden", dlg.result)
pruefe("B2b die freie Note bleibt daneben", dlg.result.lzk_note_1 == "Teil 2 wackelig", dlg.result)
dlg.vars["lzk_ergebnis_1"] = Wert(D.LZK_ERGEBNIS_TEXT[""])
dlg._uebernehmen()
pruefe("B3 'nicht bewertet' wird leer gespeichert", dlg.result.lzk_ergebnis_1 == "", dlg.result)

pruefe("B4 die Tabelle zeigt Note und Flammen in einer Zelle",
       A._note_mit_ergebnis("2-", "2") == "2- 🔥🔥" and A._note_mit_ergebnis("", "nicht_bestanden") == "✗"
       and A._note_mit_ergebnis("2-", "") == "2-")

# ===========================================================================
# 5) Der Abgleich
# ===========================================================================
class Client:
    def __init__(self):
        self.aufrufe = []

    def lzk_setzen(self, *a):
        self.aufrufe.append(a)
        return {"ok": True}


def lauf(richtung, hier1, hier2, online1, online2):
    b = D.Baustein(name="Kreise und Zylinder", bemerkung=D.LT_MARKER, lzk_ergebnis_1=hier1, lzk_ergebnis_2=hier2)
    s = D.Student(vorname="Merle", nachname="T", alias="me.te", bausteine=[b])
    eintraege = []
    for typ, wert, datum in (("Basis", online1, "2026-09-10"), ("Aufbau", online2, "2026-10-01")):
        z = D.lzk_ergebnis_zum_server(wert)
        st_, pk = z if z else ("ausstehend", 0)
        eintraege.append({"lerntheke": "kreise-und-zylinder", "typ": typ, "datum": datum, "status": st_, "pokale": pk})
    konten = [{"id": 5, "username": "me.te", "aktiv": True, "lzk": eintraege}]
    client = Client()
    app_ = A.App.__new__(A.App)
    app_.az = type("AZ", (), {"students": [s]})()
    app_._lt_konten = konten
    app_._dubletten_melden = lambda t: False
    app_._lt_anmelden = lambda still=False: (client, "M3M4")
    app_._lt_serverstand = lambda c, neu_laden=False: (konten, TITEL)
    merk = {"ungespeichert": 0, "bericht": None}
    app_._markiere_ungespeichert = lambda: merk.__setitem__("ungespeichert", merk["ungespeichert"] + 1)
    app_._detail_anzeigen = lambda: None
    app_._bericht = lambda t, x: merk.__setitem__("bericht", x)
    app_.wait_window = lambda d: None

    class DlgAttrappe:
        def __init__(self, parent, unterschiede, ohne, klasse):
            self.result = richtung
            merk["unterschiede"] = unterschiede
    A.LzkErgebnisAbgleichDialog = DlgAttrappe
    A.messagebox.showwarning = lambda *a, **k: merk.__setitem__("warnung", a)
    app_.lzk_ergebnisse_abgleichen()
    return b, client, merk, konten


# Server -> Liste
b, client, merk, _ = lauf("server_zu_liste", "", "3", "2", "")
pruefe("R1 vom Server: ein leeres Feld hier wird gefuellt", b.lzk_ergebnis_1 == "2", b)
pruefe("R1b ein Ergebnis hier wird von 'online nicht bewertet' NICHT geloescht", b.lzk_ergebnis_2 == "3", b)
pruefe("R1c nichts geht dabei zum Server", client.aufrufe == [], client.aufrufe)
pruefe("R1d die Datei gilt als ungespeichert", merk["ungespeichert"] == 1, merk)
pruefe("R1e der Bericht nennt das Uebersprungene", "Übersprungen" in (merk["bericht"] or ""), merk["bericht"])

# Liste -> Server
b, client, merk, konten = lauf("liste_zu_server", "3", "", "1", "2")
pruefe("R2 zum Server geht nur, was hier bewertet ist", len(client.aufrufe) == 1, client.aufrufe)
auf = client.aufrufe[0]
pruefe("R2b mit Person, Lerntheke, Typ, UNVERAENDERTEM Datum und dem Ergebnis",
       auf == (5, "kreise-und-zylinder", "Basis", "2026-09-10", "bestanden", 3), auf)
pruefe("R2c das online eingetragene Aufbau-Ergebnis bleibt stehen", "Übersprungen" in (merk["bericht"] or ""), merk["bericht"])
gemerkt = next(e for e in konten[0]["lzk"] if e["typ"] == "Basis")
pruefe("R2d der gemerkte Serverstand ist nachgezogen", gemerkt["status"] == "bestanden" and gemerkt["pokale"] == 3, gemerkt)
pruefe("R2e hier aendert sich dabei nichts", b.lzk_ergebnis_1 == "3" and b.lzk_ergebnis_2 == "" and merk["ungespeichert"] == 0, b)

# Menue verdrahtet
pruefe("R3 der Menuepunkt ist da",
       'label="LZK-Ergebnisse abgleichen…"' in quelle and "command=self.lzk_ergebnisse_abgleichen" in quelle)

print("\n%d Pruefungen bestanden." % ok)
