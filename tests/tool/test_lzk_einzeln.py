"""Prueft: jede LZK aus OSKlar beim Synchronisieren EINZELN zuordnen - ob, in welchen Baustein
und an welche LZK (Nutzerwunsch 2026-11-04). Vorher stand sie mit Vorschlag (schon angehakt) in
der Vorschau, und der Platz war fest: Basis/freie LZK -> LZK 1, Aufbau -> LZK 2."""
import copy
import importlib.util
import os
import sys
from datetime import date, timedelta

from pfade import WERKZEUG  # noqa: E402
import arbeitsstaende_data as D  # noqa: E402

ok = 0


def pruefe(name, bedingung, extra=""):
    global ok
    if not bedingung:
        print(("FAIL: " + name + (("\n      " + str(extra)) if extra else ""))
              .encode("ascii", "replace").decode("ascii"))
        sys.exit(1)
    ok += 1
    print("OK  " + name)


IN14 = date.today() + timedelta(days=14)
IN21 = date.today() + timedelta(days=21)
VOR_HJ = date.today() - timedelta(days=200)           # sicher ein frueheres Halbjahr
HJ14 = D.halbjahr_fuer_datum(IN14)
TITEL = {"kreise": "Baustein Kreise"}


def lt(i, key, typ="Basis", datum=IN14, **z):
    e = {"id": i, "lerntheke": key, "typ": typ, "datum": datum.isoformat() if datum else None,
         "status": "ausstehend", "pokale": 0, "thema": "", "anfrage": None, "fach": "mathe"}
    e.update(z)
    return e


def frei(i, thema, typ="LZK", datum=IN14, **z):
    return lt(i, None, typ=typ, datum=datum, thema=thema, **z)


def person(*bausteine, vorname="Gabi", alias="ga.em"):
    return D.Student(vorname=vorname, nachname="E", alias=alias, bausteine=list(bausteine))


def zu(st, *eintraege, ziele=None):
    return D.lzk_zuordnungen(st, {"lzk": list(eintraege)}, TITEL, ziele or {})


def ist(ziel, b):
    return bool(ziel) and ziel[0] == "baustein" and ziel[1] is b


def stand(b):
    return copy.deepcopy(vars(b))


# ===========================================================================
# P) Wie ein Platz zu einer LZK steht
# ===========================================================================
z = zu(person(), frei(1, "Pythagoras"))[0]
w = lambda b, nr=1: D.lzk_platz_wahl(b, nr, z["datum"], z["halbjahr"])
pruefe("P1 leer: frei", w(D.Baustein(name="P"))[0] == "frei")
pruefe("P2 derselbe Termin: gleich", w(D.Baustein(name="P", lzk_datum_1=IN14))[0] == "gleich")
pruefe("P3 anderer, noch nicht geschriebener Termin im selben Halbjahr: verschoben",
       w(D.Baustein(name="P", lzk_datum_1=IN21))[0] == "verschoben")
geschrieben = D.Baustein(name="P", lzk_datum_1=IN21, lzk_ergebnis_1="2")
pruefe("P4 schon geschrieben (Ergebnis) im selben Halbjahr: eine ANDERE LZK - belegt",
       w(geschrieben)[0] == "belegt" and "Bemerkung" in w(geschrieben)[1], w(geschrieben))
pruefe("P4b ebenso mit Punkten", w(D.Baustein(name="P", lzk_datum_1=IN21, lzk_punkte_1="12", lzk_max_1="20"))[0] == "belegt")
pruefe("P4c die automatischen Wege (Titel-Abgleich) bleiben beim alten Mass",
       D._platz_zustand(geschrieben, 1, z["datum"], z["halbjahr"])[0] is True)
pruefe("P5 Termin aus einem anderen Halbjahr: belegt", w(D.Baustein(name="P", lzk_datum_1=VOR_HJ))[0] == "belegt")
pruefe("P6 mit einer anderen OSKlar-LZK verknuepft: gesperrt",
       w(D.Baustein(name="P", lzk_datum_1=IN21, lzk_online_1={"id": 9, "datum": IN21.isoformat()}))[0] == "gesperrt")
pruefe("P7 Ergebnis ohne Termin: belegt", w(D.Baustein(name="P", lzk_ergebnis_1="1"))[0] == "belegt")
pruefe("P8 Notiz ohne Termin blockiert nicht", w(D.Baustein(name="P", lzk_note_1="Teil 2"))[0] == "frei")

# ===========================================================================
# V) Vorschlaege mit Platz
# ===========================================================================
pyth = D.Baustein(name="Satz des Pythagoras", halbjahr=HJ14, lzk_datum_1=IN21, lzk_ergebnis_1="2")
st = person(pyth)
z = zu(st, frei(10, "Satz des Pythagoras"))[0]
pruefe("V1 LZK 1 schon geschrieben: Vorschlag derselbe Baustein, LZK 2", ist(z["vorschlag"], pyth) and z["platz"] == 2,
       (z["vorschlag"], z["platz"]))
kreise = D.Baustein(name="Kreise")
z = zu(person(kreise), lt(11, "kreise", typ="Aufbau"))[0]
pruefe("V2 Aufbau-LZK: an LZK 2", ist(z["vorschlag"], kreise) and z["platz"] == 2, z)
alt = D.Baustein(name="Geometrie", halbjahr=D.halbjahr_fuer_datum(VOR_HJ), lzk_datum_1=VOR_HJ, lzk_note_1="2")
z = zu(person(alt), frei(12, "Geometrie"))[0]
pruefe("V3 Baustein mit LZK aus frueherem Halbjahr: neuer Baustein fuers Halbjahr (wie bisher)",
       z["vorschlag"] == ("neu", "Geometrie", HJ14) and z["platz"] == 1, z["vorschlag"])
voll = D.Baustein(name="Terme", lzk_datum_1=IN21, lzk_ergebnis_1="1", lzk_datum_2=IN21, lzk_ergebnis_2="1")
z = zu(person(voll), frei(13, "Terme"))[0]
pruefe("V4 beide LZK geschrieben: kein Platz im Rahmen der Anzahl -> neuer Baustein vorgeschlagen",
       z["vorschlag"][0] == "neu", z["vorschlag"])
pruefe("V4b waehlt man den Baustein selbst, wird LZK 3 (zusaetzlich) vorgeschlagen",
       D.lzk_platz_vorschlag(voll, z) == 3 and "zusätzliche" in D.lzk_platz_optionen(voll, z)[2][2])
zwei = D.Baustein(name="Terme", lzk_datum_2=IN14)
z = zu(person(zwei), frei(14, "Terme"))[0]
pruefe("V5 derselbe Termin steht an LZK 2: dorthin", ist(z["vorschlag"], zwei) and z["platz"] == 2, z["platz"])
ziele = {"thema:satz des pythagoras teil 2": {"name": "Satz des Pythagoras", "titel": "Satz des Pythagoras teil 2"}}
z = zu(st, frei(15, "Satz des Pythagoras teil 2"), ziele=ziele)[0]
pruefe("V6 gemerkte Wahl ('teil 2' -> 'Satz des Pythagoras'): dieser Baustein, naechste freie LZK",
       ist(z["vorschlag"], pyth) and z["platz"] == 2, (z["vorschlag"], z["platz"]))
z = zu(st, frei(16, "Satz des Pythagoras teil 2"))[0]
pruefe("V7 ohne gemerkte Wahl: kein Vorschlag (nicht raten)", z["vorschlag"] == ("neu", "Satz des Pythagoras teil 2", HJ14)
       or z["vorschlag"] is None, z["vorschlag"])

# ===========================================================================
# Z) Zuordnen an die gewaehlte LZK
# ===========================================================================
pyth = D.Baustein(name="Satz des Pythagoras", halbjahr=HJ14, status="In Bearbeitung",
                  lzk_datum_1=IN21, lzk_ergebnis_1="2", lzk_bem_1="gut")
st = person(pyth)
z = zu(st, frei(20, "Satz des Pythagoras teil 2", status="bestanden", pokale=1))[0]
zeile, b = D.lzk_zuordnen(st, z, ("baustein", pyth), {}, None, 2)
pruefe("Z1 'teil 2' an LZK 2 von 'Satz des Pythagoras': Termin, Ergebnis, Verknuepfung - LZK 1 unberuehrt",
       b is pyth and pyth.lzk_datum_2 == IN14 and pyth.lzk_ergebnis_2 == "1" and pyth.lzk_online_2["id"] == 20
       and pyth.lzk_datum_1 == IN21 and pyth.lzk_ergebnis_1 == "2" and pyth.lzk_bem_1 == "gut"
       and "LZK 2" in zeile and len(st.bausteine) == 1, (pyth, zeile))
pruefe("Z1b beide bestanden: der Baustein ist jetzt 'Abgeschlossen'",
       pyth.status == "Abgeschlossen" and "Abgeschlossen" in zeile, zeile)

gesperrt = D.Baustein(name="Kreise", lzk_datum_1=IN21, lzk_online_1={"id": 99, "datum": IN21.isoformat(), "ergebnis": ""})
st = person(gesperrt)
z = zu(st, frei(21, "Kreise"))[0]
vorher, ziele = stand(gesperrt), {}
try:
    D.lzk_zuordnen(st, z, ("baustein", gesperrt), ziele, None, 1)
    fehler = None
except ValueError as e:
    fehler = str(e)
pruefe("Z2 an eine LZK, die schon zu einer anderen OSKlar-LZK gehoert: abgelehnt, nichts geaendert",
       fehler and "gehört schon" in fehler and stand(gesperrt) == vorher and ziele == {}, fehler)

app = D.Baustein(name="Baustein Kreise", bemerkung=D.LT_MARKER + " 13 von 27",
                 lzk_datum_1=IN14, lzk_punkte_1="18", lzk_max_1="20", lzk_bem_1="App-Notiz")
kr = D.Baustein(name="Kreise", lzk_datum_1=VOR_HJ, lzk_ergebnis_1="1", lzk_datum_2=VOR_HJ, lzk_ergebnis_2="1")
st = person(kr, app)
z = zu(st, lt(22, "kreise"))[0]
D.lzk_zuordnen(st, z, ("baustein", kr), {}, None, 3)
pruefe("Z3 Lerntheken-LZK (Basis) an LZK 3: was die App-Zeile an LZK 1 hatte, zieht an LZK 3 um",
       kr.lzk_datum_3 == IN14 and kr.lzk_punkte_3 == "18" and kr.lzk_bem_3 == "App-Notiz"
       and kr.lzk_online_3["id"] == 22 and kr.lzk_ergebnis_1 == "1"
       and app.lzk_datum_1 is None and not app.lzk_punkte_1 and not app.lzk_bem_1, (kr, app))
pruefe("Z3b der Baustein hat jetzt 3 LZK (sichtbar)", D.lzk_anzahl(kr) == 3)

beide = D.Baustein(name="Kreise", lzk_datum_1=IN14, lzk_ergebnis_1="2")
st = person(beide)
konto = {"id": 7, "lzk": [frei(23, "Kreise", status="nicht_bestanden")]}
z = D.lzk_zuordnungen(st, konto, TITEL, {})[0]
zeile, _ = D.lzk_zuordnen(st, z, z["vorschlag"], {}, None, z["platz"])
pruefe("Z4 hier bestanden, online nicht bestanden: keiner gewinnt still (hier bleibt, Bericht sagt 'klären')",
       z["platz"] == 1 and beide.lzk_ergebnis_1 == "2" and beide.lzk_online_1["ergebnis"] == "" and "klären" in zeile, zeile)
auf, uebersprungen, _ = D.lt_freie_lzk_senden(st, konto, date.today(), TITEL)
pruefe("Z4b das Senden ueberschreibt online nichts, sondern meldet 'beide geändert'",
       not [a for a in auf if a["art"] == "aendern"] and any("beide geändert" in u["grund"] for u in uebersprungen),
       (auf, uebersprungen))
D.lt_freie_lzk_uebernehmen(st, konto)
pruefe("Z4c und der Abruf ueberschreibt hier nichts", beide.lzk_ergebnis_1 == "2")

belegt = D.Baustein(name="Kreise", lzk_datum_1=IN21, lzk_ergebnis_1="3", lzk_punkte_1="20", lzk_max_1="20")
st = person(belegt)
z = zu(st, frei(24, "Kreise"))[0]
D.lzk_zuordnen(st, z, ("baustein", belegt), {}, None, 1)
pruefe("Z5 bewusst an eine schon geschriebene LZK: ihr Stand wandert in die Bemerkung, das alte Ergebnis "
       "haengt NICHT an der neuen LZK",
       belegt.lzk_datum_1 == IN14 and belegt.lzk_ergebnis_1 == "" and belegt.lzk_punkte_1 == ""
       and "20/20 Punkte" in belegt.bemerkung and "🔥🔥🔥" in belegt.bemerkung, belegt)
auf, _, _ = D.lt_freie_lzk_senden(st, {"id": 7, "lzk": [frei(24, "Kreise")]}, date.today(), TITEL)
pruefe("Z5b deshalb geht auch kein altes Ergebnis zu der neuen LZK hinaus",
       not [a for a in auf if a["art"] == "aendern"], auf)

# ===========================================================================
# F) Der Ablauf: eine Frage nach der anderen
# ===========================================================================
anna_k = D.Baustein(name="Kreise")
anna = person(anna_k, D.Baustein(name="Baustein Kreise", bemerkung=D.LT_MARKER + " x", lzk_datum_1=IN14,
                                 lzk_bem_1="aus der App"), vorname="Anna", alias="an.na")
ben = person(D.Baustein(name="Kreise"), vorname="Ben", alias="be.n")
cem = person(vorname="Cem", alias="ce.m")
fragen = ([(anna, z_) for z_ in zu(anna, lt(30, "kreise"), frei(31, "Terme 2"))]
          + [(ben, z_) for z_ in zu(ben, frei(32, "Terme 2"))] + [(cem, z_) for z_ in zu(cem, lt(33, "kreise"))])
ziele = {}
ablauf = D.LzkFragen(fragen, ziele)
pruefe("F1 vier Fragen, die erste ist Annas Kreise-LZK", len(ablauf.fragen) == 4 and ablauf.index == 0
       and ablauf.aktuell()[0] is anna and ablauf.aktuell()[1]["titel"] == "Baustein Kreise")
ziel, platz = ablauf.vorschlag()
anna_vorher = [stand(b) for b in anna.bausteine]
ablauf.zuordnen(ziel, platz)
pruefe("F2 zugeordnet wird sofort, die naechste Frage kommt",
       anna_k.lzk_online_1["id"] == 30 and anna_k.lzk_bem_1 == "aus der App" and ablauf.index == 1
       and ablauf.zeilen and ablauf.zeilen[0].startswith("Gabi") is False and "Anna" in ablauf.zeilen[0], ablauf.zeilen)
try:
    ablauf.zuordnen(("neu", "  ", HJ14), 1)
    abgelehnt = False
except ValueError:
    abgelehnt = True
pruefe("F3 neuer Baustein ohne Namen: abgelehnt, nichts passiert", abgelehnt and ablauf.index == 1
       and len(anna.bausteine) == 2 and len(ablauf.zeilen) == 1)
ablauf.zuordnen(("neu", "Terme 2", HJ14), 1)
neu_b = anna.bausteine[-1]
pruefe("F4 neuer Baustein 'Terme 2' angelegt", neu_b.name == "Terme 2" and neu_b.lzk_online_1["id"] == 31
       and len(anna.bausteine) == 3 and ablauf.index == 2)
ziel, platz = ablauf.vorschlag()
pruefe("F5 Ben bekommt fuer 'Terme 2' Annas Wahl als Vorschlag (neuer Baustein 'Terme 2')",
       ziel == ("neu", "Terme 2", HJ14) and platz == 1, ziel)
ablauf.diesmal_nicht()
pruefe("F6 'diesmal nicht': nichts geaendert, weiter", ablauf.index == 3 and len(ben.bausteine) == 1
       and len(ablauf.zeilen) == 2)
ablauf.nie()
pruefe("F7 'nie': gemerkt, fertig", ablauf.fertig and ziele["lt:kreise"]["name"] == D.LZK_ZIEL_NIE, ziele)
pruefe("F8 zurueck nimmt 'nie' zurueck: die Wahl fuer Kreise ist wieder die von Anna",
       ablauf.zurueck() and ablauf.index == 3 and ziele["lt:kreise"]["name"] == "Kreise", ziele)
ablauf.zurueck()
ablauf.zurueck()
pruefe("F9 noch zweimal zurueck: der neue Baustein ist wieder weg, die Zeile im Bericht auch",
       ablauf.index == 1 and len(anna.bausteine) == 2 and neu_b not in anna.bausteine and len(ablauf.zeilen) == 1
       and "thema:terme 2" not in ziele, (ablauf.index, anna.bausteine, ablauf.zeilen))
ablauf.zurueck()
pruefe("F10 und die erste Antwort: Annas Bausteine wieder genau wie vorher (App-Zeile mit ihrer Notiz)",
       [stand(b) for b in anna.bausteine] == anna_vorher and ziele == {} and ablauf.index == 0
       and not ablauf.geaendert and not ablauf.zurueck())

# 'nie' ueberspringt weitere LZK derselben Lerntheke
x1, x2 = person(vorname="X", alias="x"), person(vorname="Y", alias="y")
ablauf = D.LzkFragen([(x1, zu(x1, lt(40, "kreise"))[0]), (x2, zu(x2, lt(41, "kreise"))[0])], {})
ablauf.nie()
pruefe("F11 nach 'nie' wird dieselbe Lerntheke bei den anderen nicht mehr gefragt", ablauf.fertig and ablauf.geaendert)

# ===========================================================================
# S) Synchronisieren: fragt einzeln, Bericht, "diesmal nicht" wird genannt
# ===========================================================================
spec = importlib.util.spec_from_file_location("einzelapp", os.path.join(WERKZEUG, "arbeitsstaende_app.py"))
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)


class Client:
    def __init__(self, konten):
        self.konten = konten
        self.aufrufe = []
    def lzk_aendern(self, *a, **k):
        self.aufrufe.append(("aendern", a, k))
    def lzk_setzen(self, *a):
        self.aufrufe.append(("setzen",) + a)
    def lzk_anlegen(self, *a):
        self.aufrufe.append(("anlegen",) + a)
        return 999
    def fach_id(self, key):
        return 1
    def halbjahr_uebersicht(self):
        return {"halbjahre": [], "subjects": [],
                "students": [{"username": k["username"], "byHalbjahr": {}} for k in self.konten]}
    def lerntheken_meta(self):
        return [{"key": k, "title": t, "total": 10} for k, t in TITEL.items()]
    def lerntheken_titel(self):
        return TITEL
    def studierende(self):
        return copy.deepcopy(self.konten)
    def mathe_talks(self):
        return []


gesehen = {}


class Antworten:
    """Wie ein Mensch: erste Frage 'diesmal nicht', die zweite an LZK 2 von 'Satz des Pythagoras'."""
    def __init__(self, parent, ablauf):
        gesehen["fragen"] = [z_["titel"] for _, z_ in ablauf.fragen]
        ablauf.diesmal_nicht()
        st_, _ = ablauf.aktuell()
        ablauf.zuordnen(("baustein", next(b for b in st_.bausteine if b.name == "Satz des Pythagoras")), 2)


class Vorschau:
    def __init__(self, parent, posten, hinweise, klasse, abruf_text):
        gesehen["vorschau"] = posten
        self.result = set()


A.LzkZuordnenDialog, A.SyncDialog = Antworten, Vorschau
pyth = D.Baustein(name="Satz des Pythagoras", halbjahr=HJ14, status="In Bearbeitung",
                  lzk_datum_1=IN21, lzk_ergebnis_1="2",
                  lzk_online_1={"id": 50, "datum": IN21.isoformat(), "ergebnis": "2"})
st = person(pyth, D.Baustein(name="Kreise"))
client = Client([{"id": 7, "username": "ga.em", "aktiv": True,
                  "lzk": [frei(50, "Satz des Pythagoras", datum=IN21, status="bestanden", pokale=2),
                          lt(51, "kreise", datum=IN14 - timedelta(days=1)),
                          frei(52, "Pythagoras Teil 2", datum=IN14)]}])
app_ = A.App.__new__(A.App)
app_.az = D.Arbeitsstaende()
app_.az.students = [st]
app_._lt_client, app_._lt_klasse, app_._lt_konten, app_._lt_titel = None, None, None, None
merk = {"bericht": "", "melde": ""}
app_._dubletten_melden = lambda t: False
app_._lt_paare = lambda: [("Gabi", "E", "ga.em")]
app_._lt_anmelden = lambda still=False: (client, "M3M4")
app_.wait_window = lambda d: None
for name in ("_detail_anzeigen", "_liste_aktualisieren", "_markiere_ungespeichert", "_talks_anzeigen"):
    setattr(app_, name, lambda *a: None)
app_._bericht = lambda t, x: merk.__setitem__("bericht", x)
app_._melde = lambda x: merk.__setitem__("melde", x)
app_.synchronisieren()
pruefe("S1 gefragt werden genau die zwei LZK ohne Baustein (die verknuepfte nicht)",
       gesehen.get("fragen") == ["Baustein Kreise", "Pythagoras Teil 2"], gesehen.get("fragen"))
pruefe("S2 'Pythagoras Teil 2' steht an LZK 2 von 'Satz des Pythagoras'",
       pyth.lzk_online_2 and pyth.lzk_online_2["id"] == 52 and pyth.lzk_datum_2 == IN14, pyth)
pruefe("S2b die neue LZK steht an LZK 2 als noch nicht geschrieben - die Flammen von LZK 1 bleiben bei LZK 1",
       pyth.lzk_ergebnis_2 == "" and not pyth.lzk_punkte_2 and not pyth.lzk_note_2 and not D.lzk_erledigt(pyth, 2)
       and pyth.lzk_ergebnis_1 == "2" and pyth.lzk_online_2["ergebnis"] == "" and pyth.status == "In Bearbeitung", pyth)
pruefe("S3 sonst nichts zu bestaetigen: keine Vorschau, gleich der Bericht",
       "vorschau" not in gesehen and "LZK 2" in merk["bericht"], (gesehen.keys(), merk))
pruefe("S4 der Bericht sagt, dass eine LZK diesmal nicht zugeordnet wurde und wieder gefragt wird",
       "1 LZK aus OSKlar diesmal nicht zugeordnet" in merk["bericht"], merk["bericht"])
pruefe("S5 nichts angelegt oder ueber die App-Zeile gesetzt",
       not [a for a in client.aufrufe if a[0] in ("anlegen", "setzen")], client.aufrufe)
gesehen.clear()
A.LzkZuordnenDialog = lambda parent, ablauf: gesehen.__setitem__("fragen", [z_["titel"] for _, z_ in ablauf.fragen])
app_.synchronisieren()
pruefe("S6 naechstes Mal: die offen gelassene LZK wird wieder gefragt", gesehen.get("fragen") == ["Baustein Kreise"],
       gesehen.get("fragen"))
pruefe("S7 und die Statuszeile sagt es, wenn sonst nichts war",
       "1 LZK aus OSKlar diesmal nicht zugeordnet" in (merk["melde"] + merk["bericht"]), merk)

# ===========================================================================
# D) Das echte Fenster (nur mit Bildschirm - in der CI ohne Display uebersprungen)
# ===========================================================================
try:
    import tkinter as tk
    probe = tk.Tk()
    probe.destroy()
    bildschirm = True
except Exception:
    bildschirm = False
if bildschirm:
    spec2 = importlib.util.spec_from_file_location("einzelapp2", os.path.join(WERKZEUG, "arbeitsstaende_app.py"))
    B = importlib.util.module_from_spec(spec2)
    spec2.loader.exec_module(B)
    B.App._zuletzt_oeffnen = lambda self: None
    fenster = B.App()
    fenster.withdraw()

    pyth = D.Baustein(name="Satz des Pythagoras", halbjahr=HJ14, status="In Bearbeitung",
                      lzk_datum_1=IN21, lzk_ergebnis_1="2",
                      lzk_datum_4=IN21, lzk_online_4={"id": 60, "datum": IN21.isoformat(), "ergebnis": ""})
    mia = person(pyth, D.Baustein(name="Kreise"), vorname="Mia", alias="mi.a")
    ziele = {"thema:pythagoras teil 2": {"name": "Satz des Pythagoras", "titel": "Pythagoras Teil 2"}}
    fragen = [(mia, z_) for z_ in zu(mia, frei(61, "Pythagoras Teil 2"), frei(62, "Würfel und Quader"),
                                     ziele=ziele)]
    ablauf = D.LzkFragen(fragen, ziele)
    dlg = B.LzkZuordnenDialog(fenster, ablauf)
    fenster.update()
    pruefe("D1 Kopf: Person, 'LZK 1 von 2', die LZK mit Datum",
           dlg.lbl_person.cget("text") == "Mia E" and dlg.lbl_fortschritt.cget("text") == "LZK 1 von 2"
           and "Pythagoras Teil 2" in dlg.lbl_lzk.cget("text") and B.fmt_datum(IN14) in dlg.lbl_lzk.cget("text"),
           (dlg.lbl_person.cget("text"), dlg.lbl_fortschritt.cget("text"), dlg.lbl_lzk.cget("text")))
    pruefe("D2 vorausgewaehlt: der gemerkte Baustein und seine naechste freie LZK (2)",
           dlg.baustein_var.get().startswith("Satz des Pythagoras") and dlg.platz_var.get() == 2
           and str(dlg.btn_ok.cget("state")) == "normal", (dlg.baustein_var.get(), dlg.platz_var.get()))
    pruefe("D3 LZK 1 zeigt 'andere LZK', LZK 4 ist gesperrt (gehoert zu einer anderen OSKlar-LZK)",
           "andere LZK" in dlg.platz_knoepfe[1].cget("text")
           and "disabled" in str(dlg.platz_knoepfe[4].cget("state")), dlg.platz_knoepfe[4].cget("state"))
    dlg.platz_var.set(1)
    dlg._platz_gewaehlt()
    pruefe("D4 LZK 1 gewaehlt: Warnung, dass ihr Stand in die Bemerkung wandert",
           "Bemerkung" in dlg.lbl_platz.cget("text") and dlg.lbl_platz.cget("text").startswith("⚠"))
    dlg.baustein_box.current(0)
    dlg._baustein_gewaehlt()
    fenster.update()
    pruefe("D5 '＋ Neuer Baustein': Namensfeld sichtbar und vorbelegt, LZK 1 frei vorgewaehlt",
           dlg.neu_rahmen.winfo_manager() == "pack" and dlg.neu_var.get() == "Pythagoras Teil 2"
           and dlg.platz_var.get() == 1, (dlg.neu_rahmen.winfo_manager(), dlg.neu_var.get(), dlg.platz_var.get()))
    dlg.neu_var.set("  ")
    pruefe("D6 ohne Namen laesst sich nicht zuordnen", str(dlg.btn_ok.cget("state")) == "disabled")
    dlg.baustein_box.current(next(i for i, (_, o) in enumerate(dlg._opts) if o[0] == "baustein" and o[1] is pyth))
    dlg._baustein_gewaehlt()
    fenster.update()
    pruefe("D7 zurueck zum Baustein: Namensfeld weg, LZK 2 vorgewaehlt",
           dlg.neu_rahmen.winfo_manager() == "" and dlg.platz_var.get() == 2)
    dlg._zuordnen()
    fenster.update()
    pruefe("D8 'Zuordnen': steht an LZK 2, die zweite Frage kommt (ohne Vorschlag: nichts gewaehlt)",
           pyth.lzk_online_2 and pyth.lzk_online_2["id"] == 61 and dlg.lbl_fortschritt.cget("text") == "LZK 2 von 2"
           and dlg.baustein_var.get() == "" and str(dlg.btn_ok.cget("state")) == "disabled"
           and all("disabled" in str(k.cget("state")) for k in dlg.platz_knoepfe.values()))
    dlg._zurueck()
    fenster.update()
    pruefe("D9 '‹ Zurück': wieder die erste Frage, die Zuordnung ist zurueckgenommen",
           dlg.lbl_fortschritt.cget("text") == "LZK 1 von 2" and pyth.lzk_online_2 is None and pyth.lzk_datum_2 is None)
    dlg._diesmal_nicht()
    dlg._diesmal_nicht()
    fenster.update()
    pruefe("D10 alles beantwortet: das Fenster schliesst sich, nichts geaendert",
           not dlg.winfo_exists() and ablauf.fertig and not ablauf.geaendert)
    fenster.destroy()
else:
    print("--  Fenster-Pruefungen uebersprungen (kein Bildschirm)")

print(f"\n{ok} Prüfungen bestanden.")
