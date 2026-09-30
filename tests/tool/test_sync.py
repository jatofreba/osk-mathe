"""Prueft Synchronisieren und die LZK einer Lerntheke, die online nur ueber das Thema dranhaengt."""
import copy
import importlib.util
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


TITEL = {"kreise-und-zylinder": "Kreise und Zylinder", "lineare-funktionen": "Lineare Funktionen"}
IN14 = (date.today() + timedelta(days=14)).isoformat()
IN21 = (date.today() + timedelta(days=21)).isoformat()


def frei(i, thema, datum=IN14, typ="Basis", **z):
    e = {"id": i, "lerntheke": None, "typ": typ, "datum": datum, "status": "ausstehend", "pokale": 0,
         "thema": thema, "anfrage": None, "fach": "mathe"}
    e.update(z)
    return e


# ===========================================================================
# A) Zuordnung ueber das Thema
# ===========================================================================
konto = {"id": 7, "lzk": [frei(1, "  kreise UND zylinder "), frei(2, "Lineare Funktionen", typ="Aufbau"),
                         frei(3, "Bruchrechnung"), frei(4, "Kreise und Zylinder", fach="englisch"),
                         frei(5, "lineare-funktionen", typ="LZK")]}
n = D.lzk_lerntheken_zuordnen(konto, TITEL)
e = {x["id"]: x for x in konto["lzk"]}
pruefe("A1 Thema = Lerntheken-Titel (Gross/klein, Leerzeichen egal) -> Lerntheke",
       e[1]["lerntheke"] == "kreise-und-zylinder" and e[1]["ueber_thema"], e[1])
pruefe("A2 Aufbau bleibt Aufbau", e[2]["lerntheke"] == "lineare-funktionen" and e[2]["typ"] == "Aufbau")
pruefe("A3 Thema = Schluessel geht auch, 'LZK' zaehlt als Basis",
       e[5]["lerntheke"] == "lineare-funktionen" and e[5]["typ"] == "Basis", e[5])
pruefe("A4 anderes Thema bleibt frei", e[3]["lerntheke"] is None)
pruefe("A5 andere Faecher bleiben unberuehrt", e[4]["lerntheke"] is None)
pruefe("A6 Anzahl stimmt, zweiter Aufruf aendert nichts",
       n == 3 and D.lzk_lerntheken_zuordnen(konto, TITEL) == 0)

echt = {"id": 9, "lerntheke": "kreise-und-zylinder", "typ": "Basis", "datum": IN21, "status": "ausstehend", "pokale": 0}
konto = {"id": 7, "lzk": [echt, frei(1, "Kreise und Zylinder")]}
D.lzk_lerntheken_zuordnen(konto, TITEL)
pruefe("A7 eine echte Lerntheken-LZK desselben Typs hat Vorrang", konto["lzk"][1]["lerntheke"] is None)
konto = {"id": 7, "lzk": [frei(1, "Kreise und Zylinder")]}
D.lzk_lerntheken_zuordnen(konto, TITEL, {1})
pruefe("A8 schon mit einem Baustein verknuepft: bleibt dort", konto["lzk"][0]["lerntheke"] is None)
konto = {"id": 7, "lzk": [frei(1, "Kreise und Zylinder", datum=IN14), frei(2, "Kreise und Zylinder", datum=IN21)]}
D.lzk_lerntheken_zuordnen(konto, TITEL)
pruefe("A9 zwei fuer denselben Platz: die juengste gilt",
       konto["lzk"][1]["lerntheke"] and not konto["lzk"][0]["lerntheke"], konto)

konto = {"id": 7, "lzk": [frei(1, "Kreise und Zylinder", datum=IN14),
                         frei(2, "Kreise und Zylinder", datum=IN21, anfrage="offen")]}
D.lzk_lerntheken_zuordnen(konto, TITEL)
pruefe("A10 ein fester Termin geht einer (spaeteren) Anfrage vor",
       konto["lzk"][0]["lerntheke"] and not konto["lzk"][1]["lerntheke"], konto)

konto = {"id": 7, "lzk": [frei(1, "Kreise und Zylinder")]}
eigen = D.Student(vorname="A", nachname="B", alias="a.b",
                  bausteine=[D.Baustein(name="kreise und zylinder")])
D.lzk_lerntheken_zuordnen(konto, TITEL, (), D.eigene_baustein_namen(eigen))
pruefe("A11 ein von Hand gepflegter Baustein mit genau diesem Namen behaelt die LZK",
       konto["lzk"][0]["lerntheke"] is None, konto)

# ===========================================================================
# B) Die Lerntheken-Zeile bekommt den Termin, zurueck geht es an GENAU diese LZK
# ===========================================================================
LT = [{"key": "kreise-und-zylinder", "title": "Kreise und Zylinder", "total": 10}]
konto = {"id": 7, "lzk": [frei(1, "Kreise und Zylinder")]}
D.lzk_lerntheken_zuordnen(konto, TITEL)
zeilen = D.lt_lerntheke_zeilen({}, konto["lzk"], LT, D.halbjahr_fuer_datum())
pruefe("B1 die Zeile 'Kreise und Zylinder' traegt den Termin als LZK 1",
       len(zeilen) == 1 and zeilen[0]["lzk_datum_1"] == date.fromisoformat(IN14), zeilen)

st = D.Student(vorname="Gabi", nachname="E", alias="ga.em")
D.lt_zeilen_aktualisieren(st, {}, {}, konto["lzk"], LT)
zeile = st.bausteine[0]
aend, _ = D.lt_lzk_aenderungen(st, konto, TITEL)
pruefe("B2 gleicher Termin: nichts zurueckzuschicken (vorher entstand hier eine zweite LZK)", aend == [], aend)
zeile.lzk_datum_1 = date.fromisoformat(IN21)
aend, _ = D.lt_lzk_aenderungen(st, konto, TITEL)
pruefe("B3 hier verschoben: Aenderung an der LZK mit ihrer ID",
       len(aend) == 1 and aend[0]["ueber_thema"] and aend[0]["id"] == 1, aend)

aufrufe = []


class Client:
    def __init__(self, konten=None, talks=None):
        self.konten = konten or []
        self.talks = talks or []
    def lzk_aendern(self, lzk_id, datum=None, status=None, pokale=None):
        aufrufe.append(("aendern", lzk_id, datum, status, pokale))
    def lzk_setzen(self, *a):
        aufrufe.append(("setzen",) + a)
    def halbjahr_uebersicht(self):
        return {"halbjahre": [], "subjects": [],
                "students": [{"username": k["username"], "byHalbjahr": {}} for k in self.konten]}
    def lerntheken_meta(self):
        return LT
    def lerntheken_titel(self):
        return TITEL
    def studierende(self):
        return copy.deepcopy(self.konten)
    def mathe_talks(self):
        return self.talks
    def talk_bewerten(self, rolle, online_id, status, flammen, emoji):
        aufrufe.append(("talk", rolle, online_id, status, flammen, emoji))


app = A.App.__new__(A.App)
app._lt_konten = [dict(konto, username="ga.em")]
gesendet, fehler = app._lzk_uebertragen(Client(), aend)
pruefe("B4 gesendet wird per lzk_aendern(id) - nicht als neue Lerntheken-LZK",
       aufrufe == [("aendern", 1, date.fromisoformat(IN21), None, None)] and not fehler, aufrufe)

# ===========================================================================
# C) Synchronisieren, ganz, mit Attrappen
# ===========================================================================
aufrufe.clear()
hand = D.Baustein(name="Bruchrechnung", status="In Bearbeitung", halbjahr=D.halbjahr_fuer_datum())
st = D.Student(vorname="Gabi", nachname="E", alias="ga.em", bausteine=[hand])
talk = D.MatheTalk(rolle="gehalten", online_id=11, session_id=11, datum=date.today(), halbjahr=D.halbjahr_fuer_datum(),
                   thema="Pythagoras", status="erledigt", flammen=2,
                   online={"status": "ausstehend", "flammen": 0, "emoji": "", "thema": "Pythagoras"})
st.talks = [talk]
konten = [{"id": 7, "username": "ga.em", "aktiv": True,
           "lzk": [frei(1, "Kreise und Zylinder"), frei(3, "Bruchrechnung", datum=IN21)]}]
talk_slots = [{"id": 1, "datum": date.today().isoformat(), "uhrzeit": "10:00", "halbjahr": D.halbjahr_fuer_datum(),
               "typ": "talk", "session_id": 11, "thema": "Pythagoras", "presentedStatus": "ausstehend",
               "pokale": 0, "qualityEmoji": None, "presenter_username": "ga.em", "coPresenters": [], "invitees": []}]
client = Client(konten, talk_slots)

gesehen = {}


class DialogAttrappe:
    def __init__(self, parent, posten, hinweise, klasse, abruf_text):
        gesehen["posten"], gesehen["hinweise"] = posten, hinweise
        self.result = set(range(len(posten)))      # alles angewaehlt


A.SyncDialog = DialogAttrappe
app = A.App.__new__(A.App)
app.az = type("AZ", (), {"students": [st], "_wb": None})()
app._lt_client, app._lt_klasse, app._lt_konten, app._lt_titel = None, None, None, None
merk = {"bericht": "", "melde": ""}
app._dubletten_melden = lambda t: False
app._lt_paare = lambda: [("Gabi", "E", "ga.em")]
app._lt_anmelden = lambda still=False: (client, "M3M4")
app.wait_window = lambda d: None
for name in ("_detail_anzeigen", "_liste_aktualisieren", "_markiere_ungespeichert", "_talks_anzeigen"):
    setattr(app, name, lambda *a: None)
app._bericht = lambda t, x: merk.__setitem__("bericht", x)
app._melde = lambda x: merk.__setitem__("melde", x)
app.synchronisieren()

lt_zeile = next((b for b in st.bausteine if b.name == "Kreise und Zylinder"), None)
pruefe("C1 die LZK aus dem LZK-Reiter steht jetzt in der Lerntheken-Zeile",
       lt_zeile is not None and lt_zeile.lzk_datum_1 == date.fromisoformat(IN14), lt_zeile)
arten = sorted(p["art"] for p in gesehen["posten"])
pruefe("C2 die Vorschau bietet die passende freie LZK zum Uebernehmen und den Talk zum Senden an",
       arten == ["frei_herein", "talk"], arten)
pruefe("C3 nach Bestaetigung: der leere Platz im Baustein ist gefuellt und verknuepft",
       hand.lzk_datum_1 == date.fromisoformat(IN21) and (hand.lzk_online_1 or {}).get("id") == 3, hand)
pruefe("C4 und die Talk-Bewertung ist hochgeladen", ("talk", "gehalten", 11, "erledigt", 2, "") in aufrufe, aufrufe)
pruefe("C5 keine zweite LZK angelegt", not any(a[0] == "setzen" for a in aufrufe), aufrufe)
pruefe("C6 der Bericht nennt beides", "Bruchrechnung" in merk["bericht"] and "Talk" in merk["bericht"], merk)

# Zweiter Lauf: alles gleich -> nichts mehr zu bestaetigen
aufrufe.clear()
app.synchronisieren()
pruefe("C7 zweiter Lauf: nichts mehr zu bestaetigen, nichts gesendet",
       gesehen["posten"] == [] and aufrufe == [], (gesehen["posten"], aufrufe))

# Abgewaehlt: nichts wird geschrieben
hand2 = D.Baustein(name="Prozente", status="In Bearbeitung")
st.bausteine.append(hand2)
client.konten[0]["lzk"].append(frei(8, "Prozente", datum=IN21))


class AbwahlAttrappe(DialogAttrappe):
    def __init__(self, *a):
        super().__init__(*a)
        self.result = set()


A.SyncDialog = AbwahlAttrappe
app.synchronisieren()
pruefe("C8 abgewaehlt: der Baustein bleibt leer", hand2.lzk_datum_1 is None and hand2.lzk_online_1 is None, hand2)

# ===========================================================================
# D) Die echten Fenster (nur mit Bildschirm - in der CI ohne Display uebersprungen)
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
    posten = [{"gruppe": "herein", "person": "Gabi E", "text": "Bruchrechnung, LZK 1: 14.10.2026"},
              {"gruppe": "raus", "person": "Gabi E", "text": "Talk 30.09.2026 „Pythagoras“: ✓ ok 🔥🔥"}]
    dlg = B.SyncDialog(fenster, posten, [("Ben J", "„Prozente“ – kein Baustein mit diesem Namen")],
                       "M3M4", "Tandem M3M4, nur Mathe.\n" + "Zeile\n" * 40)
    fenster.update()
    pruefe("D1 Vorschau: beide Gruppen und die Hinweise stehen da",
           set(dlg.baum.get_children()) == {"herein", "raus", "hinweise"}, dlg.baum.get_children())
    pruefe("D2 alles ist zunaechst angewaehlt", dlg.an == {0, 1} and dlg.baum.item("0", "text").startswith("☑"))
    dlg._umschalten("0")
    pruefe("D3 Klick waehlt ab", dlg.an == {1} and dlg.baum.item("0", "text").startswith("☐"))
    dlg._umschalten("hinweise")
    pruefe("D4 Gruppen- und Hinweiszeilen lassen sich nicht anwaehlen", dlg.an == {1})
    pruefe("D5 der lange Abruf-Bericht schiebt das Fenster nicht aus dem Bild",
           dlg.winfo_reqheight() < 900, dlg.winfo_reqheight())
    dlg._ok()
    pruefe("D6 Uebernehmen liefert die Auswahl", dlg.result == {1}, dlg.result)
    leer = B.SyncDialog(fenster, [], [], "M3M4", "alles gleich")
    fenster.update()
    pruefe("D7 nichts zu bestaetigen: Uebernehmen ist aus", str(leer.btn_ok.cget("state")) == "disabled")
    leer.destroy()

    # Die Talk-Fenster (seit den Mathe-Talks) - bisher nur ueber Attrappen geprueft
    t = D.MatheTalk(rolle="zugehoert", online_id=5, datum=date.today(), thema="Pythagoras", mit="an.be",
                    online={"status": "ausstehend", "flammen": 0, "emoji": "", "thema": "Pythagoras"})
    tdlg = B.TalkDialog(fenster, t, "Gabi E")
    fenster.update()
    tdlg.v_status.set(D.TALK_STATUS_TEXT["erledigt"])
    tdlg.v_flammen.set("2")
    tdlg.v_emoji.set("🌟")
    tdlg.t_bem.insert("1.0", "gut zugehoert")
    tdlg._uebernehmen()
    pruefe("D8 Talk bewerten: das Fenster liefert Status, Flammen, Emoji, Bemerkung",
           tdlg.result == {"status": "erledigt", "flammen": 2, "emoji": "🌟",
                           "bemerkung": "gut zugehoert", "thema": "Pythagoras"}, tdlg.result)
    hdlg = B.TalkHochladenDialog(fenster, [(st, talk, "bewertung", talk.bewertung(), talk.online)], "M3M4")
    fenster.update()
    hdlg._ok()
    pruefe("D9 Hochladen-Vorschau oeffnet und bestaetigt", hdlg.result is True)
    fenster.destroy()
else:
    print("--  Fenster-Pruefungen uebersprungen (kein Bildschirm)")

print(f"\n{ok} Prüfungen bestanden.")
