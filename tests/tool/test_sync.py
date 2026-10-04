"""Prueft Synchronisieren: online-LZK einem Baustein zuordnen (Vorschlag, Auswahl, Halbjahr),
das Umziehen falsch abgelegter LZK, das Halbjahr beim Statuswechsel und die echten Fenster."""
import copy
import importlib.util
import json
import os
import sys
from datetime import date, timedelta

from pfade import WERKZEUG  # noqa: E402
import arbeitsstaende_data as D  # noqa: E402

spec = importlib.util.spec_from_file_location("syncapp", os.path.join(WERKZEUG, "arbeitsstaende_app.py"))
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)

ok = 0


def pruefe(name, bedingung, extra=""):
    global ok
    if not bedingung:
        print(("FAIL: " + name + (("\n      " + str(extra)) if extra else ""))
              .encode("ascii", "replace").decode("ascii"))
        sys.exit(1)
    ok += 1
    print("OK  " + name)


HJ = D.halbjahr_fuer_datum()
IN14 = date.today() + timedelta(days=14)
IN21 = date.today() + timedelta(days=21)
VOR_HJ = date.today() - timedelta(days=200)           # sicher ein frueheres Halbjahr
HJ_ALT = D.halbjahr_fuer_datum(VOR_HJ)
HJ14 = D.halbjahr_fuer_datum(IN14)
TITEL = {"kreise": "Baustein Kreise", "wz": "Baustein Wahrscheinlichkeit und Zufall"}


def lt_lzk(i, key, typ="Basis", datum=IN14, **z):
    e = {"id": i, "lerntheke": key, "typ": typ, "datum": datum.isoformat() if datum else None,
         "status": "ausstehend", "pokale": 0, "thema": "", "anfrage": None, "fach": "mathe"}
    e.update(z)
    return e


def frei(i, thema, typ="Basis", datum=IN14, **z):
    return lt_lzk(i, None, typ=typ, datum=datum, thema=thema, **z)


def person(*bausteine, alias="ga.em"):
    return D.Student(vorname="Gabi", nachname="E", alias=alias, bausteine=list(bausteine))


# ===========================================================================
# A) Hilfen
# ===========================================================================
pruefe("A1 'Baustein Kreise' = 'kreise' (Praefix, Gross/klein)", D._name_norm("Baustein Kreise") == D._name_norm("kreise"))
pruefe("A2 '&' = 'und'", D._name_norm("Glück & Zufall") == D._name_norm("glück und zufall"))
pruefe("A3 neuer Name aus dem Lerntheken-Titel ohne 'Baustein '",
       D.lzk_neuer_name(lt_lzk(1, "wz"), TITEL) == "Wahrscheinlichkeit und Zufall")
pruefe("A4 freie LZK: ihr Thema", D.lzk_neuer_name(frei(2, "Terme 1"), TITEL) == "Terme 1")
konto = {"lzk": [lt_lzk(1, "kreise"), frei(2, "X", anfrage="offen"), frei(3, "Y", datum=None),
                 frei(4, "Z", fach="deutsch"), frei(5, "W")]}
pruefe("A5 zur Auswahl: feste Mathe-LZK mit Datum, mit oder ohne Lerntheke",
       [e["id"] for e in D.lzk_online_alle(konto)] == [1, 5], D.lzk_online_alle(konto))

# ===========================================================================
# B) Vorschlaege
# ===========================================================================
kreise = D.Baustein(name="Kreise")
gz = D.Baustein(name="Glück & Zufall")
pyth_alt = D.Baustein(name="Satz des Pythagoras", halbjahr=HJ_ALT, lzk_datum_1=VOR_HJ, lzk_note_1="best")
geo = D.Baustein(name="Geometrie", lzk_datum_1=VOR_HJ, lzk_note_1="22/25")       # ohne Halbjahr
terme = D.Baustein(name="Terme 1", halbjahr=HJ14, lzk_datum_1=IN21, lzk_ergebnis_1="2")
st = person(kreise, gz, pyth_alt, geo, terme)
konto = {"lzk": [lt_lzk(10, "kreise"), lt_lzk(11, "wz"), frei(12, "Satz des Pythagoras"),
                 frei(13, "Geometrie"), frei(14, "terme 1")]}
zu = {z["eintrag"]["id"]: z for z in D.lzk_zuordnungen(st, konto, TITEL, {})}


def ist(ziel, b):
    """Ziel zeigt auf GENAU diesen Baustein (Bausteine sind Dataclasses: == vergleicht Felder)."""
    return bool(ziel) and ziel[0] == "baustein" and ziel[1] is b


pruefe("B1 Lerntheke 'Baustein Kreise' -> dein Baustein 'Kreise'", ist(zu[10]["vorschlag"], kreise), zu[10])
pruefe("B2 'Wahrscheinlichkeit und Zufall' passt zu nichts: du waehlst", zu[11]["vorschlag"] is None, zu[11])
pruefe("B3 gleicher Name, aber Baustein aus frueherem Halbjahr mit LZK: neuer Baustein fuers Halbjahr",
       zu[12]["vorschlag"] == ("neu", "Satz des Pythagoras", HJ14), zu[12]["vorschlag"])
pruefe("B4 Baustein ohne Halbjahr mit LZK aus frueherem Halbjahr: ebenso neuer Baustein",
       zu[13]["vorschlag"] == ("neu", "Geometrie", HJ14), zu[13]["vorschlag"])
pruefe("B5 anderer Termin im selben Halbjahr: dieselbe (verschobene) LZK",
       ist(zu[14]["vorschlag"], terme), zu[14]["vorschlag"])
zu2 = {z["eintrag"]["id"]: z for z in D.lzk_zuordnungen(st, konto, TITEL,
                                                        {"lt:wz": {"name": "Glück & Zufall", "titel": "x"}})}
pruefe("B6 die gemerkte Wahl wird zum Vorschlag", ist(zu2[11]["vorschlag"], gz), zu2[11]["vorschlag"])
zu3 = D.lzk_zuordnungen(st, konto, TITEL, {"lt:wz": {"name": D.LZK_ZIEL_NIE, "titel": "x"}})
pruefe("B7 'nie zuordnen' fragt nicht mehr", all(z["eintrag"]["id"] != 11 for z in zu3))
kreise.lzk_online_1 = {"id": 10, "datum": IN14.isoformat(), "ergebnis": ""}
pruefe("B8 schon verknuepfte LZK stehen nicht zur Auswahl",
       all(z["eintrag"]["id"] != 10 for z in D.lzk_zuordnungen(st, konto, TITEL, {})))
kreise.lzk_online_1 = None
opts = D.lzk_ziel_optionen(st, zu[12])
texte = [t for t, _ in opts]
pruefe("B9 Auswahl: neuer Baustein zuerst, dann alle eigenen, 'nicht'/'nie' am Ende",
       texte[0].startswith("＋ neuer Baustein „Satz des Pythagoras“") and texte[-2].startswith("— nicht")
       and texte[-1].startswith("— nie") and any("⚠ wird ersetzt" in t for t in texte), texte)
pruefe("B10 'für alle': dieselbe Wahl je Person nach Namen",
       D.lzk_ziel_nach_name(person(D.Baustein(name="Glück & Zufall")), zu[11], "Glück & Zufall")[0] == "baustein"
       and D.lzk_ziel_nach_name(person(), zu[11], "Glück & Zufall") == ("neu", "Glück & Zufall", HJ14))

# Ein Thema laeuft ueber das Halbjahr hinaus: leerer Platz im Baustein von damals bleibt moeglich
laeuft = D.Baustein(name="Kreise", halbjahr=HJ_ALT, status="In Bearbeitung")
z11 = D.lzk_zuordnungen(person(laeuft), {"lzk": [lt_lzk(60, "kreise")]}, TITEL, {})[0]
pruefe("B11 Baustein von damals mit leerem Platz: das Thema laeuft weiter", ist(z11["vorschlag"], laeuft), z11)
jetzt_b, damals_b = D.Baustein(name="Kreise", halbjahr=HJ14), D.Baustein(name="Kreise", halbjahr=HJ_ALT)
z12 = D.lzk_zuordnungen(person(damals_b, jetzt_b), {"lzk": [lt_lzk(61, "kreise")]}, TITEL, {})[0]
pruefe("B12 gibt es beide, gewinnt der Baustein des Halbjahres", ist(z12["vorschlag"], jetzt_b), z12["vorschlag"])

# ===========================================================================
# C) Zuordnen
# ===========================================================================
ziele = {}
app = D.Baustein(name="Baustein Kreise", bemerkung=D.LT_MARKER + " 13 von 27",
                 lzk_datum_1=IN14, lzk_note_1="95%", lzk_ergebnis_1="3")
kr = D.Baustein(name="Kreise")
st = person(kr, app)
z = D.lzk_zuordnungen(st, {"lzk": [lt_lzk(20, "kreise", status="bestanden", pokale=3)]}, TITEL, ziele)[0]
zeile, ziel_b = D.lzk_zuordnen(st, z, z["vorschlag"], ziele)
pruefe("C1 Termin, Ergebnis und Verknuepfung im gewaehlten Baustein",
       kr.lzk_datum_1 == IN14 and kr.lzk_ergebnis_1 == "3" and kr.lzk_online_1["id"] == 20 and ziel_b is kr, kr)
pruefe("C2 die Note aus der App-Zeile zieht mit, die App-Zeile gibt den Platz frei",
       kr.lzk_note_1 == "95%" and app.lzk_datum_1 is None and not app.lzk_note_1 and not app.lzk_ergebnis_1, (kr, app))
pruefe("C3 die Wahl wird gemerkt", ziele.get("lt:kreise", {}).get("name") == "Kreise", ziele)

alt = D.Baustein(name="Geometrie", lzk_datum_1=VOR_HJ, lzk_note_1="22/25", lzk_bem_1="Teil 2")
st = person(alt)
z = D.lzk_zuordnungen(st, {"lzk": [frei(21, "Geometrie")]}, TITEL, {})[0]
D.lzk_zuordnen(st, z, ("baustein", alt), {})
pruefe("C4 bewusst einen belegten Platz gewaehlt: der alte Stand wandert in die Bemerkung",
       alt.lzk_datum_1 == IN14 and not alt.lzk_note_1 and "22/25" in alt.bemerkung
       and D._fmt_kurz(VOR_HJ) in alt.bemerkung and "Teil 2" in alt.bemerkung, alt)

st = person()
z = D.lzk_zuordnungen(st, {"lzk": [lt_lzk(22, "wz")]}, TITEL, {})[0]
_, b_neu = D.lzk_zuordnen(st, z, ("neu", "Glück & Zufall", HJ14), {})
pruefe("C5 neuer Baustein: Name, Halbjahr, 'In Bearbeitung', verknuepft",
       b_neu in st.bausteine and b_neu.name == "Glück & Zufall" and b_neu.halbjahr == HJ14
       and b_neu.status == "In Bearbeitung" and b_neu.lzk_online_1["id"] == 22, b_neu)

versch = D.Baustein(name="Terme 1", lzk_datum_1=IN21, lzk_note_1="best", lzk_ergebnis_1="2")
st = person(versch)
z = D.lzk_zuordnungen(st, {"lzk": [frei(23, "Terme 1")]}, TITEL, {})[0]
D.lzk_zuordnen(st, z, z["vorschlag"], {})
pruefe("C6 im selben Halbjahr verschoben: Termin von online, Note und Ergebnis bleiben, nichts in die Bemerkung",
       versch.lzk_datum_1 == IN14 and versch.lzk_note_1 == "best" and versch.lzk_ergebnis_1 == "2"
       and not versch.bemerkung, versch)

ziele = {}
D.lzk_zuordnen(st, z, ("nie",), ziele)
pruefe("C7 'nie' merkt sich nur die Wahl", ziele[z["schluessel"]]["name"] == D.LZK_ZIEL_NIE, ziele)

# ===========================================================================
# D) Danach gilt der Baustein - nicht mehr die App-Zeile
# ===========================================================================
LT = [{"key": "kreise", "title": "Baustein Kreise", "total": 27}]
kr = D.Baustein(name="Kreise", lzk_datum_1=IN14, lzk_online_1={"id": 30, "datum": IN14.isoformat(), "ergebnis": ""})
app = D.Baustein(name="Baustein Kreise", bemerkung=D.LT_MARKER + " alt", lzk_datum_1=IN21)   # veraltet
st = person(kr, app)
konto = {"id": 7, "lzk": [lt_lzk(30, "kreise")]}
zeilen = D.lt_lerntheke_zeilen({"kreise": ["a", "b"]}, konto["lzk"], LT, HJ, D.verknuepfte_lzk_ids([st]))
pruefe("D1 die App-Zeile fuehrt die zugeordnete LZK nicht mehr", zeilen and zeilen[0]["lzk_datum_1"] is None
       and "LZK" not in zeilen[0]["bemerkung"], zeilen)
aend, _ = D.lt_lzk_aenderungen(st, konto, TITEL)
pruefe("D2 ein alter Termin in der App-Zeile geht NICHT mehr hinaus", aend == [], aend)
kr.lzk_datum_1 = IN21
auf, _, _ = D.lt_freie_lzk_senden(st, konto, date.today(), TITEL)
pruefe("D3 hier verschoben: die Lerntheken-LZK wird per ID geaendert",
       len(auf) == 1 and auf[0]["art"] == "aendern" and auf[0]["id"] == 30 and auf[0]["felder"] == {"datum": IN21}, auf)
kr.lzk_datum_1 = IN14
konto2 = {"id": 7, "lzk": [lt_lzk(30, "kreise", datum=IN21, status="bestanden", pokale=2)]}
u, _ = D.lt_freie_lzk_uebernehmen(st, konto2)
pruefe("D4 online verschoben und bewertet: kommt in den Baustein",
       kr.lzk_datum_1 == IN21 and kr.lzk_ergebnis_1 == "2" and len(u) == 1, (kr, u))

# ===========================================================================
# E) Falsch abgelegt: umziehen (Fall "Satz des Pythagoras")
# ===========================================================================
falsch = D.Baustein(name="Satz des Pythagoras", halbjahr=HJ_ALT, lzk_datum_1=IN14, lzk_note_1="best",
                    lzk_online_1={"id": 73, "datum": IN14.isoformat(), "ergebnis": ""})
st = person(falsch)
t = D.lzk_falsches_halbjahr(st)
pruefe("E1 erkannt: LZK im Baustein eines anderen Halbjahres", len(t) == 1 and t[0]["halbjahr"] == HJ14, t)
D.lzk_umziehen(st, t[0])
neu = st.bausteine[-1]
pruefe("E2 neuer Baustein im richtigen Halbjahr, mit Termin und Verknuepfung",
       neu is not falsch and neu.halbjahr == HJ14 and neu.lzk_datum_1 == IN14 and neu.lzk_online_1["id"] == 73, neu)
pruefe("E3 der alte behaelt seine Note, verliert den fremden Termin und sagt Bescheid",
       falsch.lzk_note_1 == "best" and falsch.lzk_datum_1 is None and falsch.lzk_online_1 is None
       and "nachtragen" in falsch.bemerkung, falsch)
weiter = D.Baustein(name="Kreise", halbjahr=HJ_ALT, lzk_datum_1=IN14,
                    lzk_online_1={"id": 74, "datum": IN14.isoformat(), "ergebnis": ""})
pruefe("E4 ein weiterlaufendes Thema (ohne Spuren einer frueheren LZK) ist kein Fall",
       D.lzk_falsches_halbjahr(person(weiter)) == [])

# ===========================================================================
# F) Halbjahr beim Statuswechsel (Formular)
# ===========================================================================
f = D.hj_nach_statuswechsel
pruefe("F1 auf 'In Bearbeitung': laufendes Halbjahr", f("Ausstehend", "In Bearbeitung", "", "", None) == (HJ, HJ))
pruefe("F2 zurueck: alter Wert kehrt zurueck", f("Ausstehend", "Ausstehend", "", HJ, HJ) == ("", None))
pruefe("F3 auf 'Abgeschlossen' aus altem Halbjahr: laufendes",
       f("In Bearbeitung", "Abgeschlossen", HJ_ALT, HJ_ALT, None)[0] == HJ)
pruefe("F4 selbst eingetragenes Halbjahr bleibt", f("Ausstehend", "Abgeschlossen", "", "2425_2", None) == ("2425_2", None))
pruefe("F5 andere Zustaende aendern nichts", f("Ausstehend", "Nicht bestanden", "", "", None) == ("", None))

# ===========================================================================
# G) Gemerkte Wahl in der Datei
# ===========================================================================
az = D.Arbeitsstaende()
az.lzk_ziele = {"lt:wz": {"name": "Glück & Zufall", "titel": "Baustein Wahrscheinlichkeit und Zufall"}}
az2 = D.Arbeitsstaende()
az2.aus_dict(json.loads(json.dumps(az.als_dict(), ensure_ascii=False)))
pruefe("G1 lzk_ziele uebersteht Speichern und Laden", az2.lzk_ziele == az.lzk_ziele, az2.lzk_ziele)
az3 = D.Arbeitsstaende()
az3.aus_dict({"format": D.JSON_FORMAT, "version": 1, "personen": []})
pruefe("G2 aeltere Dateien: leer", az3.lzk_ziele == {})

# ===========================================================================
# H) Synchronisieren, ganz, mit Attrappen
# ===========================================================================
aufrufe = []


class Client:
    def __init__(self, konten):
        self.konten = konten
    def lzk_aendern(self, lzk_id, datum=None, status=None, pokale=None):
        aufrufe.append(("aendern", lzk_id, datum, status, pokale))
    def lzk_setzen(self, *a):
        aufrufe.append(("setzen",) + a)
    def lzk_anlegen(self, *a):
        aufrufe.append(("anlegen",) + a)
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


kreise = D.Baustein(name="Kreise")
gz = D.Baustein(name="Glück & Zufall")
falsch = D.Baustein(name="Satz des Pythagoras", halbjahr=HJ_ALT, lzk_datum_1=IN14, lzk_note_1="best",
                    lzk_online_1={"id": 73, "datum": IN14.isoformat(), "ergebnis": ""})
st = person(kreise, gz, falsch)
client = Client([{"id": 7, "username": "ga.em", "aktiv": True,
                  "lzk": [lt_lzk(40, "kreise"), lt_lzk(41, "wz", status="bestanden", pokale=3),
                          frei(73, "Satz des Pythagoras")]}])
gesehen = {}


class DialogAttrappe:
    """Waehlt bei der unklaren LZK 'Glück & Zufall' (wie ein Klick) und nimmt alles."""
    def __init__(self, parent, posten, hinweise, klasse, abruf_text, optionen=None, nach_name=None, text=None):
        gesehen["posten"] = posten
        gesehen["texte"] = [text(p) for p in posten] if text else []
        for p in posten:
            if p["art"] == "zuordnen" and p["ziel"] is None:
                p["ziel"] = nach_name(p, "Glück & Zufall")
                gesehen["optionen"] = optionen(p)
        self.result = set(range(len(posten)))


A.SyncDialog = DialogAttrappe
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

arten = sorted(p["art"] for p in gesehen["posten"])
pruefe("H1 Vorschau: zwei LZK zum Zuordnen, eine zum Umziehen", arten == ["umziehen", "zuordnen", "zuordnen"], arten)
pruefe("H2 die Zeile nennt LZK und Ziel", any("„Baustein Kreise“ Basis-LZK" in t and "→ Kreise" in t
                                              for t in gesehen["texte"]), gesehen["texte"])
pruefe("H3 Kreise und Glück & Zufall sind zugeordnet und verknuepft",
       kreise.lzk_online_1["id"] == 40 and gz.lzk_online_1["id"] == 41 and gz.lzk_ergebnis_1 == "3", (kreise, gz))
pruefe("H4 die falsch abgelegte LZK ist umgezogen",
       falsch.lzk_online_1 is None and any(b.lzk_online_1 and b.lzk_online_1["id"] == 73 and b.halbjahr == HJ14
                                           for b in st.bausteine), st.bausteine)
pruefe("H5 die Wahl fuer W&Z ist gemerkt", app_.az.lzk_ziele.get("lt:wz", {}).get("name") == "Glück & Zufall",
       app_.az.lzk_ziele)
pruefe("H6 nichts wurde doppelt angelegt oder ueber die App-Zeile gesetzt",
       not any(a[0] in ("anlegen", "setzen") for a in aufrufe), aufrufe)
pruefe("H7 der Bericht nennt die Zuordnungen", "→ Kreise" in merk["bericht"] and "Glück & Zufall" in merk["bericht"],
       merk["bericht"])
aufrufe.clear()
app_.synchronisieren()
pruefe("H8 zweiter Lauf: nichts mehr zuzuordnen, nichts gesendet",
       [p["art"] for p in gesehen["posten"]] == [] and aufrufe == [], ([p["art"] for p in gesehen["posten"]], aufrufe))

# ===========================================================================
# I) Die echten Fenster (nur mit Bildschirm - in der CI ohne Display uebersprungen)
# ===========================================================================
try:
    import tkinter as tk
    probe = tk.Tk()
    probe.destroy()
    bildschirm = True
except Exception:
    bildschirm = False
if bildschirm:
    spec2 = importlib.util.spec_from_file_location("syncapp2", os.path.join(WERKZEUG, "arbeitsstaende_app.py"))
    B = importlib.util.module_from_spec(spec2)
    spec2.loader.exec_module(B)          # frisch: oben wurde SyncDialog durch eine Attrappe ersetzt
    B.App._zuletzt_oeffnen = lambda self: None
    fenster = B.App()
    fenster.withdraw()

    # Vorschau mit zwei Zuordnungen derselben Lerntheke (zwei Personen) und einem Talk
    a1, a2 = person(D.Baustein(name="Glück & Zufall")), person(D.Baustein(name="Glück & Zufall"), alias="be.ja")
    z1 = D.lzk_zuordnungen(a1, {"lzk": [lt_lzk(50, "wz")]}, TITEL, {})[0]
    z2 = D.lzk_zuordnungen(a2, {"lzk": [lt_lzk(51, "wz")]}, TITEL, {})[0]
    posten = [{"gruppe": "herein", "art": "zuordnen", "st": a1, "z": z1, "ziel": None, "an": False, "person": "A"},
              {"gruppe": "herein", "art": "zuordnen", "st": a2, "z": z2, "ziel": None, "an": False, "person": "B"},
              {"gruppe": "raus", "person": "A", "text": "Talk"}]
    dlg = B.SyncDialog(fenster, posten, [], "M3M4", "Bericht\n" * 30,
                       optionen=lambda p: D.lzk_ziel_optionen(p["st"], p["z"]),
                       nach_name=lambda p, name: D.lzk_ziel_nach_name(p["st"], p["z"], name),
                       text=B.App._sync_text)
    fenster.update()
    dlg._umschalten("0")
    pruefe("I1 ohne Ziel ist eine Zuordnung abgewaehlt und laesst sich nicht anwaehlen", 0 not in dlg.an, dlg.an)
    dlg.baum.selection_set("0")
    dlg._markiert()
    werte = list(dlg.ziel_box.cget("values"))
    pruefe("I2 Markieren zeigt die Auswahl der Person", any(w.startswith("Glück & Zufall") for w in werte), werte)
    dlg.ziel_box.current(next(i for i, w in enumerate(werte) if w.startswith("Glück & Zufall")))
    dlg._ziel_gewaehlt()
    pruefe("I3 Wahl setzt Ziel und Haken", posten[0]["ziel"][0] == "baustein" and 0 in dlg.an
           and "→ Glück & Zufall" in dlg.baum.item("0", "values")[0], dlg.baum.item("0", "values"))
    dlg._fuer_alle()
    pruefe("I4 'für alle': die zweite Person bekommt IHREN Baustein",
           ist(posten[1]["ziel"], a2.bausteine[0]) and 1 in dlg.an, posten[1]["ziel"])
    pruefe("I5 die Fensterhoehe bleibt im Bild", dlg.winfo_reqheight() < 950, dlg.winfo_reqheight())
    dlg._ok()
    pruefe("I6 Uebernehmen liefert die Auswahl", dlg.result == {0, 1, 2}, dlg.result)

    # Baustein-Formular: Halbjahr folgt dem Status
    bdlg = B.BausteinDialog(fenster, D.Baustein(name="Kreise", status="Ausstehend", halbjahr=""))
    fenster.update()
    bdlg.vars["status"].set("In Bearbeitung")
    pruefe("I7 Formular: 'In Bearbeitung' setzt das laufende Halbjahr", bdlg.vars["halbjahr"].get() == HJ,
           bdlg.vars["halbjahr"].get())
    bdlg.vars["status"].set("Ausstehend")
    pruefe("I8 zurueck: das Feld ist wieder leer", bdlg.vars["halbjahr"].get() == "", bdlg.vars["halbjahr"].get())
    bdlg.vars["halbjahr"].set("2425_2")
    bdlg.vars["status"].set("Abgeschlossen")
    pruefe("I9 ein selbst eingetragenes Halbjahr bleibt", bdlg.vars["halbjahr"].get() == "2425_2")
    bdlg.destroy()

    # Gemerkte Zuordnungen verwalten
    ziele = {"lt:wz": {"name": "Glück & Zufall", "titel": "Baustein Wahrscheinlichkeit und Zufall"},
             "thema:x": {"name": D.LZK_ZIEL_NIE, "titel": "X"}}
    zdlg = B.LzkZieleDialog(fenster, ziele)
    fenster.update()
    zeilen = zdlg.liste.get(0, "end")
    pruefe("I10 die Liste zeigt Lerntheke und Ziel", any("Wahrscheinlichkeit" in z_ and "Glück & Zufall" in z_
                                                       for z_ in zeilen) and any("nie zuordnen" in z_ for z_ in zeilen),
           zeilen)
    zdlg.liste.selection_set(0)
    zdlg._vergessen()
    pruefe("I11 'vergessen' entfernt den Eintrag", zdlg.geaendert and len(ziele) == 1, ziele)
    zdlg.destroy()
    fenster.destroy()
else:
    print("--  Fenster-Pruefungen uebersprungen (kein Bildschirm)")

print(f"\n{ok} Prüfungen bestanden.")
