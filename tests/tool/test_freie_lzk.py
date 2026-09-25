"""Freie Mathe-LZK im Python-Tool: welche das Tool kennt, wie sie per Titel den
Bausteinen zugeordnet werden, der Client (PATCH per ID) und der Abgleich."""
import io
import json
import os
import sys
from datetime import date

HIER = os.path.dirname(os.path.abspath(__file__))
from pfade import WERKZEUG  # noqa: E402
NEU = WERKZEUG
for name in ("arbeitsstaende_data", "osk_sync", "arbeitsstaende_app"):
    sys.modules.pop(name, None)
import arbeitsstaende_data as D  # noqa: E402
import osk_sync as O             # noqa: E402
import arbeitsstaende_app as A   # noqa: E402

ok = 0


def pruefe(name, bedingung, extra=""):
    global ok
    if not bedingung:
        print(("FAIL: " + name + (("\n      " + str(extra)) if extra else "")).encode("ascii", "replace").decode("ascii"))
        sys.exit(1)
    ok += 1
    print("OK  " + name)


def eintrag(i, thema, typ="Basis", datum="2026-10-01", fach="mathe", status="ausstehend", pokale=0,
            lerntheke=None, anfrage=None):
    return {"id": i, "typ": typ, "lerntheke": lerntheke, "datum": datum, "status": status,
            "pokale": pokale, "thema": thema, "anfrage": anfrage, "fach": fach}


# ===========================================================================
# 1) Welche LZK kennt das Tool?
# ===========================================================================
konto = {"lzk": [
    eintrag(1, "Bruchrechnung"),
    eintrag(2, "Erörterung", fach="deutsch"),
    eintrag(3, "Wunsch", anfrage="offen"),
    eintrag(4, "Abgelehnt", anfrage="abgelehnt"),
    eintrag(5, "Ohne Datum", datum=None),
    eintrag(6, "Kreise", lerntheke="kreise-und-zylinder"),
    {"typ": "LZK", "lerntheke": None, "datum": "2026-10-01", "status": "ausstehend", "pokale": 0},  # alter Server
]}
frei = D.lt_freie_lzk(konto)
pruefe("K1 nur feste freie Mathe-LZK mit Datum und ID", [e["id"] for e in frei] == [1], [e.get("id") for e in frei])

# ===========================================================================
# 2) Zuordnung ueber den Titel
# ===========================================================================
bruch = D.Baustein(name="Bruchrechnung", lzk_note_1="alt")
prozent = D.Baustein(name="  prozentRECHNUNG ")
app = D.Baustein(name="Kreise und Zylinder", bemerkung=D.LT_MARKER + " aus der App")
s = D.Student(vorname="Merle", nachname="T", alias="me.te", bausteine=[bruch, prozent, app])
konto = {"lzk": [
    eintrag(10, "bruchrechnung", typ="Basis", datum="2026-10-01"),
    eintrag(11, "Prozentrechnung", typ="Aufbau", datum="2026-10-05", status="bestanden", pokale=2),
    eintrag(12, "Kreise und Zylinder", typ="Basis"),
    eintrag(13, "", typ="Basis"),
    eintrag(14, "Gibtsnicht"),
    eintrag(15, "Bruchrechnung", typ="LZK", datum="2026-11-01"),
]}
paare, offen = D.lt_freie_lzk_abgleich(s, konto)
p10 = next((x for x in paare if x["id"] == 10), None)
p11 = next((x for x in paare if x["id"] == 11), None)
pruefe("Z1 Titel = Baustein-Name, Gross/klein egal", p11 is not None and p11["baustein"] is prozent, paare)
pruefe("Z1b Leerzeichen egal", p11["baustein"] is prozent)
pruefe("Z2 eine Aufbau-LZK kommt in Platz 2", p11["nummer"] == 2, p11)
pruefe("Z2b mit Datum und Ergebnis von online", p11["online_datum"] == date(2026, 10, 5) and p11["online_erg"] == "2", p11)
# 10 (Basis, 01.10.) und 15 (allgemeine LZK, 01.11.) wollen beide Platz 1 der Bruchrechnung
p15 = next((x for x in paare if x["id"] == 15), None)
pruefe("Z3 zwei LZK fuer denselben Platz: die juengste gilt", p15 is not None and p15["nummer"] == 1 and p10 is None, paare)
pruefe("Z3b die aeltere wird genannt", any("neuere LZK" in o for o in offen), offen)
pruefe("Z4 eine Lerntheken-Zeile ist kein Ziel", all(x["baustein"] is not app for x in paare), paare)
pruefe("Z4b und sagt, wo diese LZK hingehoert", any("Lerntheken-Zeile" in o for o in offen), offen)
pruefe("Z5 ohne Titel: nicht zugeordnet, mit Hinweis", any("ohne Titel" in o for o in offen), offen)
pruefe("Z6 kein passender Baustein: genannt", any("Gibtsnicht" in o and "kein Baustein" in o for o in offen), offen)
pruefe("Z7 der Vergleich aendert hier noch nichts", bruch.lzk_datum_1 is None and prozent.lzk_datum_2 is None)

# Gleicher Name in zwei Halbjahren: das Halbjahr der LZK entscheidet
alt = D.Baustein(name="Bruchrechnung", halbjahr="2526_2")
jetzt = D.Baustein(name="Bruchrechnung", halbjahr=D.halbjahr_fuer_datum(date(2026, 10, 1)))
s2 = D.Student(vorname="Ben", nachname="J", alias="be.ja", bausteine=[alt, jetzt])
p2, o2 = D.lt_freie_lzk_abgleich(s2, {"lzk": [eintrag(20, "Bruchrechnung")]})
pruefe("Z8 bei gleichem Namen entscheidet das Halbjahr der LZK", len(p2) == 1 and p2[0]["baustein"] is jetzt, (p2, o2))
s3 = D.Student(vorname="C", nachname="D", alias="c.d",
               bausteine=[D.Baustein(name="Bruchrechnung", halbjahr="2425_1"), D.Baustein(name="Bruchrechnung", halbjahr="2425_2")])
p3, o3 = D.lt_freie_lzk_abgleich(s3, {"lzk": [eintrag(21, "Bruchrechnung")]})
pruefe("Z9 bleibt es mehrdeutig, wird nichts geraten", not p3 and any("mehrere Bausteine" in o for o in o3), (p3, o3))

# gleich-Kennzeichen
fertig = D.Baustein(name="Bruchrechnung", lzk_datum_1=date(2026, 10, 1), lzk_ergebnis_1="3")
p4, _ = D.lt_freie_lzk_abgleich(D.Student(vorname="E", nachname="F", alias="e.f", bausteine=[fertig]),
                                {"lzk": [eintrag(22, "Bruchrechnung", status="bestanden", pokale=3)]})
pruefe("Z10 stimmt alles, ist die Zuordnung 'gleich'", p4 and p4[0]["gleich"] is True, p4)

# ===========================================================================
# 3) Der Client aendert per ID nur die uebergebenen Felder
# ===========================================================================
class Antwort:
    def __init__(self):
        self.daten = b'{"ok": true}'
    def read(self):
        return self.daten
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False


gesendet = []


class Oeffner:
    def open(self, req, timeout=None):
        gesendet.append((req.get_method(), req.full_url, json.loads(req.data.decode("utf-8"))))
        return Antwort()


c = O.AppClient("https://osk.example")
c.opener = Oeffner()
c.lzk_aendern(42, datum=date(2026, 10, 7))
pruefe("C1 PATCH auf /api/admin/lzk/<id>", gesendet[0][0] == "PATCH" and gesendet[0][1].endswith("/api/admin/lzk/42"), gesendet)
pruefe("C1b nur das Datum - kein Ergebnis mitgeschickt", gesendet[0][2] == {"datum": "2026-10-07"}, gesendet[0])
c.lzk_aendern(42, status="bestanden", pokale=2)
pruefe("C2 nur das Ergebnis - kein Datum mitgeschickt", gesendet[1][2] == {"status": "bestanden", "pokale": 2}, gesendet[1])
try:
    c.lzk_aendern(42)
    pruefe("C3 ohne Felder wird nichts geschickt", False)
except ValueError:
    pruefe("C3 ohne Felder wird nichts geschickt", len(gesendet) == 2)

# ===========================================================================
# 4) Der Abgleich in beide Richtungen
# ===========================================================================
class Client:
    def __init__(self):
        self.aufrufe = []
    def lzk_aendern(self, lzk_id, **felder):
        self.aufrufe.append((lzk_id, felder))
        return {"ok": True}


def lauf(richtung, bausteine, lzk):
    st = D.Student(vorname="Merle", nachname="T", alias="me.te", bausteine=bausteine)
    konten = [{"id": 5, "username": "me.te", "aktiv": True, "lzk": lzk}]
    client = Client()
    app_ = A.App.__new__(A.App)
    app_.az = type("AZ", (), {"students": [st]})()
    app_._lt_konten = konten
    app_._dubletten_melden = lambda t: False
    app_._lt_anmelden = lambda still=False: (client, "M3M4")
    app_._lt_serverstand = lambda c, neu_laden=False: (konten, {})
    merk = {"ungespeichert": 0, "bericht": None}
    app_._markiere_ungespeichert = lambda: merk.__setitem__("ungespeichert", merk["ungespeichert"] + 1)
    app_._detail_anzeigen = lambda: None
    app_._bericht = lambda t, x: merk.__setitem__("bericht", x)
    app_.wait_window = lambda d: None

    class DlgAttrappe:
        def __init__(self, parent, paare, offen, klasse):
            self.result = richtung
            merk["paare"], merk["offen"] = paare, offen
    A.FreieLzkDialog = DlgAttrappe
    A.messagebox.showwarning = lambda *a, **k: merk.__setitem__("warnung", a)
    app_.freie_lzk_zuordnen()
    return client, merk, konten


# Vom Server in die Liste
b1 = D.Baustein(name="Bruchrechnung", lzk_note_1="Teil 2 ueben")
b2 = D.Baustein(name="Prozentrechnung", lzk_datum_2=date(2025, 5, 12), lzk_ergebnis_2="1")
b3 = D.Baustein(name="Terme", lzk_datum_1=date(2026, 9, 1), lzk_ergebnis_1="2")
client, merk, _ = lauf("server_zu_liste", [b1, b2, b3], [
    eintrag(30, "Bruchrechnung", typ="Basis", datum="2026-10-01", status="bestanden", pokale=3),
    eintrag(31, "Prozentrechnung", typ="Aufbau", datum="2026-10-05"),
    eintrag(32, "Terme", typ="Basis", datum="2026-09-01"),
])
pruefe("R1 vom Server: leerer Platz bekommt Datum und Ergebnis",
       b1.lzk_datum_1 == date(2026, 10, 1) and b1.lzk_ergebnis_1 == "3", b1)
pruefe("R1b die freie Note bleibt unberuehrt", b1.lzk_note_1 == "Teil 2 ueben", b1)
pruefe("R2 ein abweichendes Datum wird uebernommen", b2.lzk_datum_2 == date(2026, 10, 5), b2)
pruefe("R2b das alte Datum steht im Bericht", "12.05.2025" in (merk["bericht"] or ""), merk["bericht"])
pruefe("R2c online unbewertet loescht hier kein Ergebnis", b2.lzk_ergebnis_2 == "1", b2)
pruefe("R3 online nicht bewertet laesst das Ergebnis hier stehen", b3.lzk_ergebnis_1 == "2", b3)
pruefe("R4 nichts geht dabei zum Server", client.aufrufe == [], client.aufrufe)
pruefe("R4b die Datei gilt als ungespeichert", merk["ungespeichert"] == 1, merk)
pruefe("R4c jeder Platz merkt sich den Stand online", b1.lzk_online_1 == {"id": 30, "datum": "2026-10-01", "ergebnis": "3"}
       and b2.lzk_online_2 == {"id": 31, "datum": "2026-10-05", "ergebnis": ""}, (b1.lzk_online_1, b2.lzk_online_2))

# Aus der Liste zum Server
b1 = D.Baustein(name="Bruchrechnung", lzk_datum_1=date(2026, 10, 8), lzk_ergebnis_1="2")
b2 = D.Baustein(name="Prozentrechnung")                     # hier leer
b3 = D.Baustein(name="Terme", lzk_datum_1=date(2026, 9, 1), lzk_ergebnis_1="nicht_bestanden")
lzk_online = [
    eintrag(40, "Bruchrechnung", typ="Basis", datum="2026-10-01"),
    eintrag(41, "Prozentrechnung", typ="Aufbau", datum="2026-10-05", status="bestanden", pokale=1),
    eintrag(42, "Terme", typ="Basis", datum="2026-09-01"),
]
client, merk, konten = lauf("liste_zu_server", [b1, b2, b3], lzk_online)
auf = dict(client.aufrufe)
pruefe("S1 geaendert wird per ID, nur was abweicht",
       auf.get(40) == {"datum": date(2026, 10, 8), "status": "bestanden", "pokale": 2}, client.aufrufe)
pruefe("S2 nur das Ergebnis, wenn das Datum stimmt", auf.get(42) == {"status": "nicht_bestanden", "pokale": 0}, client.aufrufe)
pruefe("S3 ein leerer Baustein hier loescht online NICHTS", 41 not in auf, client.aufrufe)
pruefe("S3b und wird im Bericht genannt", "hier leer" in (merk["bericht"] or ""), merk["bericht"])
e40 = next(e for e in konten[0]["lzk"] if e["id"] == 40)
pruefe("S4 der gemerkte Serverstand ist nachgezogen", e40["datum"] == "2026-10-08" and e40["pokale"] == 2, e40)
pruefe("S5 hier aendern sich Datum und Ergebnis nicht", b1.lzk_datum_1 == date(2026, 10, 8) and b1.lzk_ergebnis_1 == "2"
       and b2.lzk_datum_2 is None and b3.lzk_ergebnis_1 == "nicht_bestanden", (b1, b2, b3))
pruefe("S5b gemerkt wird nur die Verknuepfung - mit dem Stand online nach dem Senden",
       b1.lzk_online_1 == {"id": 40, "datum": "2026-10-08", "ergebnis": "2"}
       and b2.lzk_online_2 == {"id": 41, "datum": "2026-10-05", "ergebnis": "1"}
       and b3.lzk_online_1 == {"id": 42, "datum": "2026-09-01", "ergebnis": "nicht_bestanden"}
       and merk["ungespeichert"] == 1, (b1.lzk_online_1, b2.lzk_online_2, b3.lzk_online_1, merk))

# ===========================================================================
# 5) Verdrahtung
# ===========================================================================
quelle = open(os.path.join(NEU, "arbeitsstaende_app.py"), encoding="utf-8").read()
pruefe("V1 der Menuepunkt ist da", 'label="Freie Mathe-LZK zuordnen…"' in quelle and "command=self.freie_lzk_zuordnen" in quelle)
abruf = quelle.split("def app_ergebnisse_abrufen")[1].split("\n    def ")[0]
pruefe("V2 der Abruf ordnet NICHT selbst zu, er zaehlt nur", "lt_freie_lzk_abgleich(student, konto)" in abruf
       and "setattr" not in abruf, "")
pruefe("V2b und weist im Bericht auf den Menuepunkt hin", "Freie Mathe-LZK zuordnen…" in abruf, "")

print("\n%d Pruefungen bestanden." % ok)
