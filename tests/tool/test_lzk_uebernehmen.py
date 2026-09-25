"""Der Abruf holt online Geaendertes an VERKNUEPFTEN freien Mathe-LZK in die Bausteine -
aber nur, was hier seit dem letzten Abgleich unveraendert ist, und nie Leeres."""
import os
import sys
from datetime import date

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


def eintrag(i, thema, typ="Basis", datum="2026-09-30", status="ausstehend", pokale=0, fach="mathe"):
    return {"id": i, "typ": typ, "lerntheke": None, "datum": datum, "status": status,
            "pokale": pokale, "thema": thema, "anfrage": None, "fach": fach}


def verkn(d="2026-09-30", e="", i=70):
    return {"id": i, "datum": d, "ergebnis": e}


def person(*bausteine):
    return D.Student(vorname="Gabriel", nachname="E", alias="ga.em", bausteine=list(bausteine))


D30 = date(2026, 9, 30)

uebernehmen = D.lt_freie_lzk_uebernehmen

# 1) Online verschoben, hier unveraendert -> herein
k = D.Baustein(name="Kreise", lzk_datum_1=D30, lzk_note_1="Teil 2 ueben", lzk_bem_1="Taschenrechner",
               lzk_online_1=verkn())
u, g = uebernehmen(person(k), {"lzk": [eintrag(70, "Kreise", datum="2026-10-05")]})
pruefe("U1 online verschoben: das neue Datum kommt in den Baustein", k.lzk_datum_1 == date(2026, 10, 5), k)
pruefe("U1b die Verknuepfung merkt sich den neuen Stand", k.lzk_online_1 == verkn("2026-10-05"), k.lzk_online_1)
pruefe("U1c der Bericht nennt alt und neu", u == ["Gabriel E · Kreise (LZK 1): Datum 30.09.2026 → 05.10.2026"] and g == [], (u, g))
pruefe("U1d Note und Bemerkung bleiben unberuehrt", k.lzk_note_1 == "Teil 2 ueben" and k.lzk_bem_1 == "Taschenrechner", k)

# 2) Online bewertet
k = D.Baustein(name="Kreise", lzk_datum_1=D30, lzk_online_1=verkn())
u, _ = uebernehmen(person(k), {"lzk": [eintrag(70, "Kreise", status="bestanden", pokale=2)]})
pruefe("U2 online bewertet: das Ergebnis kommt herein", k.lzk_ergebnis_1 == "2" and k.lzk_online_1["ergebnis"] == "2", k)
pruefe("U2b mit Text im Bericht", len(u) == 1 and "nicht bewertet → 🔥🔥 bestanden" in u[0], u)

# 3) Beides auf einmal, auch LZK 2
k = D.Baustein(name="Satz des Pythagoras", lzk_datum_2=date(2026, 10, 12), lzk_online_2=verkn("2026-10-12"))
u, _ = uebernehmen(person(k), {"lzk": [eintrag(70, "Satz des Pythagoras", typ="Aufbau", datum="2026-10-14",
                                               status="nicht_bestanden")]})
pruefe("U3 Datum und Ergebnis zugleich, in LZK 2",
       k.lzk_datum_2 == date(2026, 10, 14) and k.lzk_ergebnis_2 == "nicht_bestanden"
       and k.lzk_online_2 == verkn("2026-10-14", "nicht_bestanden"), k)

# 4) Hier geaendert, online nicht -> bleibt (das schickt das Senden hinaus)
k = D.Baustein(name="Kreise", lzk_datum_1=date(2026, 10, 2), lzk_online_1=verkn())
u, g = uebernehmen(person(k), {"lzk": [eintrag(70, "Kreise")]})
pruefe("U4 hier verschoben: der Abruf holt NICHT das alte Datum zurueck",
       k.lzk_datum_1 == date(2026, 10, 2) and k.lzk_online_1 == verkn() and u == [] and g == [], (k, u, g))

# 5) Beide Seiten verschieden geaendert -> nichts anfassen
k = D.Baustein(name="Kreise", lzk_datum_1=date(2026, 10, 2), lzk_ergebnis_1="1", lzk_online_1=verkn())
u, g = uebernehmen(person(k), {"lzk": [eintrag(70, "Kreise", datum="2026-10-05", status="bestanden", pokale=3)]})
pruefe("U5 Konflikt: hier bleibt alles, wie es ist",
       k.lzk_datum_1 == date(2026, 10, 2) and k.lzk_ergebnis_1 == "1" and k.lzk_online_1 == verkn() and u == [], (k, u))

# 6) Beide gleich geaendert -> nur die Verknuepfung nachziehen
k = D.Baustein(name="Kreise", lzk_datum_1=date(2026, 10, 5), lzk_online_1=verkn())
u, g = uebernehmen(person(k), {"lzk": [eintrag(70, "Kreise", datum="2026-10-05")]})
pruefe("U6 beide auf denselben Tag: still die Verknuepfung nachziehen",
       k.lzk_online_1 == verkn("2026-10-05") and u == [] and g == [], (k.lzk_online_1, u, g))

# 7) Online die Bewertung zurueckgenommen -> hier bleibt sie, gemeldet
k = D.Baustein(name="Kreise", lzk_datum_1=D30, lzk_ergebnis_1="2", lzk_online_1=verkn(e="2"))
u, g = uebernehmen(person(k), {"lzk": [eintrag(70, "Kreise")]})
pruefe("U7 Leeres ueberschreibt nichts: die Bewertung bleibt hier",
       k.lzk_ergebnis_1 == "2" and k.lzk_online_1 == verkn(e="2") and u == []
       and g == ["Gabriel E · Kreise (LZK 1): online nicht mehr bewertet – hier bleibt 🔥🔥 bestanden"], (k, u, g))

# 8) Nicht verknuepft -> der Abruf ordnet nicht selbst zu
leer = D.Baustein(name="Kreise")
u, g = uebernehmen(person(leer), {"lzk": [eintrag(71, "Kreise", status="bestanden", pokale=1)]})
pruefe("U8 ohne Verknuepfung: nichts eingetragen, nichts verknuepft",
       leer.lzk_datum_1 is None and leer.lzk_ergebnis_1 == "" and leer.lzk_online_1 is None and u == [], leer)

# 9) App-Zeilen bleiben aussen vor
app = D.Baustein(name="Kreise", lzk_datum_1=D30, bemerkung=D.LT_MARKER + " Stand", lzk_online_1=verkn())
u, _ = uebernehmen(person(app), {"lzk": [eintrag(70, "Kreise", datum="2026-10-05")]})
pruefe("U9 App-Zeilen fasst die Uebernahme nicht an", app.lzk_datum_1 == D30 and u == [], app)

# 10) Danach ist nichts zurueckzuschicken
k = D.Baustein(name="Kreise", lzk_datum_1=D30, lzk_online_1=verkn())
konto = {"id": 7, "lzk": [eintrag(70, "Kreise", datum="2026-10-05", status="bestanden", pokale=3)]}
uebernehmen(person(k), konto)
auf, ueber, _ = D.lt_freie_lzk_senden(person(k), konto, date(2026, 9, 25))
pruefe("U10 nach der Uebernahme hat das Senden nichts zu tun", auf == [] and ueber == [], (auf, ueber))

# 11) Die Meldungen beim Senden verweisen jetzt auf den Abruf
k = D.Baustein(name="Kreise", lzk_datum_1=D30, lzk_online_1=verkn())
_, ueber, _ = D.lt_freie_lzk_senden(person(k), {"id": 7, "lzk": [eintrag(70, "Kreise", datum="2026-10-05")]},
                                    date(2026, 9, 25))
pruefe("U11 Senden: online verschoben -> 'Ergebnisse abrufen' uebernimmt das",
       len(ueber) == 1 and "Ergebnisse abrufen" in ueber[0]["grund"], ueber)
k = D.Baustein(name="Kreise", lzk_datum_1=D30, lzk_ergebnis_1="2", lzk_online_1=verkn(e="2"))
_, ueber, _ = D.lt_freie_lzk_senden(person(k), {"id": 7, "lzk": [eintrag(70, "Kreise")]}, date(2026, 9, 25))
pruefe("U11b Senden: online zurueckgenommen -> ehrlich benannt",
       len(ueber) == 1 and "nicht mehr bewertet" in ueber[0]["grund"], ueber)

# ===========================================================================
# Der ganze Abruf, mit Attrappen
# ===========================================================================
class Client:
    def __init__(self, konten):
        self.konten = konten
    def halbjahr_uebersicht(self):
        return {"halbjahre": [], "subjects": [], "students": [{"username": "ga.em", "byHalbjahr": {}}]}
    def lerntheken_meta(self):
        return []
    def studierende(self):
        return self.konten


kreise = D.Baustein(name="Kreise", status="In Bearbeitung", lzk_datum_1=D30,
                    lzk_online_1={"id": 70, "datum": "2026-09-30", "ergebnis": ""})
st = D.Student(vorname="Gabriel", nachname="E", alias="ga.em", bausteine=[kreise])
konten = [{"id": 7, "username": "ga.em", "aktiv": True, "lzk": [eintrag(70, "Kreise", datum="2026-10-05")]}]
app_ = A.App.__new__(A.App)
app_.az = type("AZ", (), {"students": [st], "_wb": None})()
merk = {"liste": 0, "ungespeichert": 0, "bericht": ""}
app_._dubletten_melden = lambda t: False
app_._lt_paare = lambda: [("Gabriel", "E", "ga.em")]
app_._lt_anmelden = lambda still=False: (Client(konten), "M3M4")
app_._detail_anzeigen = lambda: None
app_._liste_aktualisieren = lambda: merk.__setitem__("liste", merk["liste"] + 1)
app_._markiere_ungespeichert = lambda: merk.__setitem__("ungespeichert", merk["ungespeichert"] + 1)
app_._bericht = lambda t, x: merk.__setitem__("bericht", x)
app_.app_ergebnisse_abrufen()

pruefe("A1 Abruf: der online verschobene Termin steht im Baustein", kreise.lzk_datum_1 == date(2026, 10, 5), kreise)
pruefe("A2 die Liste wird neu aufgebaut (Frist-Spalte)", merk["liste"] == 1, merk)
pruefe("A3 der Bericht fasst zusammen und nennt die Aenderung",
       "1 online geänderte LZK übernommen" in merk["bericht"]
       and "Kreise (LZK 1): Datum 30.09.2026 → 05.10.2026" in merk["bericht"], merk["bericht"])
pruefe("A4 und nichts bleibt 'mit Unterschied' uebrig", "mit Unterschied" not in merk["bericht"], merk["bericht"])
print("\n%d Pruefungen bestanden." % ok)
