"""Notenspiegel fuer LZK im Python-Tool (2026-10-31): Prozent und Note aus den Punkten,
Speichern/Laden, das Baustein-Formular, der Einstellungs-Dialog - und dass Punkte,
Prozent und Note nie hochgeladen werden (zum Server gehen nur Termin und Flammen)."""
import io
import json
import os
import sys
from datetime import date
from fractions import Fraction

HIER = os.path.dirname(os.path.abspath(__file__))
from pfade import WERKZEUG  # noqa: E402
for name in ("arbeitsstaende_data", "osk_sync", "arbeitsstaende_app"):
    sys.modules.pop(name, None)
import arbeitsstaende_data as D  # noqa: E402
import arbeitsstaende_app as A   # noqa: E402
import osk_sync                  # noqa: E402

ok = 0


def pruefe(name, bedingung, extra=""):
    global ok
    if not bedingung:
        print(("FAIL: " + name + (("\n      " + str(extra)) if extra else "")).encode("ascii", "replace").decode("ascii"))
        sys.exit(1)
    ok += 1
    print("OK  " + name)


SP = D.Notenspiegel()


def note(p, m, sp=SP):
    a = D.lzk_auswertung(p, m, sp)
    return a and a["note"]


# ===========================================================================
# A) Rechnen
# ===========================================================================
# Die Tabelle "Notenverteilung bei 40%" mit 22 Punkten - Wert fuer Wert aus der Vorlage.
VORLAGE_22 = [("1+", "95", "21,0"), ("1", "90", "20,0"), ("1-", "85", "18,5"), ("2+", "80", "17,5"),
              ("2", "75", "16,5"), ("2-", "70", "15,5"), ("3+", "65", "14,5"), ("3", "60", "13,0"),
              ("3-", "55", "12,0"), ("4+", "50", "11,0"), ("4", "45", "10,0"), ("4-", "40", "9,0"),
              ("5+", "33 1/3", "7,5"), ("5", "26 2/3", "6,0"), ("5-", "20", "4,5"), ("6", "0", "0,0")]
tab = D.notenspiegel_tabelle(SP, 22)
ist = [(n, f"{float(g):.1f}".replace(".", ",")) for n, _p, g in tab]
pruefe("R1 Standard = die Vorlage: 16 Noten, Punkte-Untergrenzen bei 22 Punkten genau wie dort",
       ist == [(n, g) for n, _p, g in VORLAGE_22], ist)
pruefe("R1b die Prozent-Untergrenzen stehen wie in der Vorlage (33 1/3, 26 2/3)",
       [D.NOTENSPIEGEL_STANDARD[n] for n in D.NOTEN] == [p for _n, p, _g in VORLAGE_22])
pruefe("R2 genau auf der Grenze: 21 -> 1+, 18,5 -> 1-, 9 -> 4-, 0 -> 6, 22 -> 1+",
       [note(x, "22") for x in ("21", "18,5", "9", "0", "22")] == ["1+", "1-", "4-", "6", "1+"])
pruefe("R2b knapp darunter: 20,9 -> 1, 18,4 -> 2+, 8,5 -> 5+, 7 -> 5",
       [note(x, "22") for x in ("20,9", "18,4", "8,5", "7")] == ["1", "2+", "5+", "5"])
a = D.lzk_auswertung("18,5", "22", SP)
pruefe("R3 Prozent exakt (Bruch) und als Text: 18,5 von 22 = 84,1 %",
       a["prozent"] == Fraction(37, 44) * 100 and D.prozent_text(a["prozent"]) == "84,1 %", a)
pruefe("R3b der Text neben den Punkten", D.lzk_auswertung_text(a) == "= 84,1 % → Note 1-", D.lzk_auswertung_text(a))
pruefe("R3c glatte Prozent ohne ,0", D.prozent_text(Fraction(100)) == "100 %" and D.prozent_text(Fraction(0)) == "0 %")
genau = D.Notenspiegel(runden="genau")
pruefe("R4 'genau nach Prozent': 18,5/22 (84,09 %) ist 2+, 18,7/22 (85 %) ist 1-",
       note("18,5", "22", genau) == "2+" and note("18,7", "22", genau) == "1-")
ganz = D.Notenspiegel(runden="ganz")
pruefe("R4b 'ganze Punkte': 85 % von 22 = 18,7 -> Grenze 19", D.punktgrenze(Fraction(85), 22, "ganz") == 19
       and note("18,5", "22", ganz) == "2+")
pruefe("R4c x,25 rundet wie Excel aufwaerts (nicht zur geraden Zahl)",
       D.punktgrenze(Fraction(50), Fraction(9, 2), "halb") == Fraction(5, 2))
pruefe("R5 Zahlen lesen: 18,5 / 18.5 / 33 1/3 / 2/3 / leer",
       D.zahl_lesen("18,5") == D.zahl_lesen("18.5") == Fraction(37, 2) and D.zahl_lesen("33 1/3") == Fraction(100, 3)
       and D.zahl_lesen("2/3") == Fraction(2, 3) and D.zahl_lesen("  ") is None)
fehler = []
for t in ("abc", "-3", "1/0", "18,5,5"):
    try:
        D.zahl_lesen(t)
    except ValueError:
        fehler.append(t)
pruefe("R5b keine Zahl -> ValueError (auch negativ)", fehler == ["abc", "-3", "1/0", "18,5,5"], fehler)
pruefe("R6 unvollstaendig oder unsinnig: keine Note",
       D.lzk_auswertung("", "22", SP) is None and D.lzk_auswertung("18", "", SP) is None
       and D.lzk_auswertung("x", "22", SP) is None and D.lzk_auswertung("3", "0", SP) is None)
pruefe("R6b Zusatzpunkte (mehr als maximal) ergeben 1+", note("23", "22") == "1+")
pruefe("R7 Punkte als Text: 18,5 / 22 / 7,33", D.zahl_text(Fraction(37, 2)) == "18,5"
       and D.zahl_text(Fraction(22)) == "22" and D.zahl_text(Fraction(22, 3)) == "7,33")


def ungueltig(**aenderung):
    g = dict(D.NOTENSPIEGEL_STANDARD)
    g.update(aenderung)
    try:
        D.notenspiegel_werte(D.Notenspiegel(grenzen=g))
        return ""
    except ValueError as e:
        return str(e)


pruefe("R8 Grenzen muessen fallen", "unter der von" in ungueltig(**{"2+": "90"}), ungueltig(**{"2+": "90"}))
pruefe("R8b keine Zahl / leer / ueber 100 / die 6 nicht bei 0",
       all(ungueltig(**x) for x in ({"3": "drei"}, {"3": ""}, {"1+": "101"}, {"6": "5"})))
kaputt = D.Notenspiegel(grenzen={"1+": "x"})
pruefe("R8c ein kaputter Spiegel rechnet mit dem Standard weiter (statt abzustuerzen)",
       note("18,5", "22", kaputt) == "1-")

# ===========================================================================
# B) Speichern und Laden
# ===========================================================================
b = D.Baustein(name="Kreise", lzk_datum_1=date(2026, 10, 20), lzk_note_1="1-", lzk_punkte_1="18,5", lzk_max_1="22",
               lzk_ergebnis_1="2")
d = D.baustein_als_dict(b)
pruefe("S1 die Punkte stehen im LZK-Block der Arbeitsdatei", d["lzk_1"].get("punkte") == "18,5"
       and d["lzk_1"].get("max_punkte") == "22" and "lzk_2" not in d, d)
b2 = D.baustein_aus_dict(json.loads(json.dumps(d)))
pruefe("S1b und kommen unveraendert zurueck", (b2.lzk_punkte_1, b2.lzk_max_1, b2.lzk_note_1) == ("18,5", "22", "1-"), b2)
alt = D.baustein_aus_dict({"name": "Alt", "lzk_1": {"datum": "2025-05-01", "note": "29/34 = 1-"}})
pruefe("S2 alte Dateien ohne Punkte laden wie bisher (Note bleibt Freitext)",
       alt.lzk_punkte_1 == "" and alt.lzk_max_1 == "" and alt.lzk_note_1 == "29/34 = 1-", alt)

az = D.Arbeitsstaende()
az.students = [D.Student(vorname="Merle", nachname="T", bausteine=[b])]
pruefe("S3 der Standard-Notenspiegel steht nicht in der Datei", "notenspiegel" not in az.als_dict())
az.notenspiegel = D.Notenspiegel(grenzen=dict(D.NOTENSPIEGEL_STANDARD, **{"1+": "96"}), runden="genau")
roh = json.loads(json.dumps(az.als_dict(), ensure_ascii=False))
pruefe("S4 ein geaenderter schon", roh.get("notenspiegel", {}).get("grenzen", {}).get("1+") == "96"
       and roh["notenspiegel"]["runden"] == "genau", roh.get("notenspiegel"))
az2 = D.Arbeitsstaende()
w = az2.aus_dict(roh)
pruefe("S4b und wird wieder gelesen", az2.notenspiegel == az.notenspiegel and not w, (az2.notenspiegel, w))
roh["notenspiegel"] = {"grenzen": {"1+": "95"}, "runden": "halb"}
az3 = D.Arbeitsstaende()
w = az3.aus_dict(roh)
pruefe("S5 ein unvollstaendiger Notenspiegel: Standard und eine Warnung beim Laden",
       az3.notenspiegel == D.Notenspiegel() and any("Notenspiegel" in x for x in w), w)
pfad = os.path.join(os.environ.get("TEMP", "/tmp"), "test_notenspiegel_arbeitsdatei.json")
az.speichern_json(pfad)
az4 = D.Arbeitsstaende()
az4.laden(pfad)
os.remove(pfad)
pruefe("S6 Datei schreiben und lesen: Punkte und Notenspiegel bleiben",
       az4.students[0].bausteine[0].lzk_punkte_1 == "18,5" and az4.notenspiegel.grenzen["1+"] == "96")

# ===========================================================================
# C) Nie hochgeladen
# ===========================================================================
sync = io.open(os.path.join(WERKZEUG, "osk_sync.py"), encoding="utf-8").read()
pruefe("H1 der Server-Zugriff kennt weder Punkte noch Note noch Prozent noch Notenspiegel",
       not any(w in sync.lower() for w in ("punkte", "lzk_note", "notenspiegel", "prozent", "max_punkte")))

gesendet = []
client = osk_sync.AppClient.__new__(osk_sync.AppClient)
client._post = lambda pfad_, daten: gesendet.append(("post", pfad_, dict(daten))) or {"id": 99, "ids": [99]}
client._patch = lambda pfad_, daten: gesendet.append(("patch", pfad_, dict(daten))) or {"ok": True}
client.lzk_setzen(5, "kreise", "Basis", date(2026, 10, 20), "bestanden", 2)
client.lzk_aendern(70, datum=date(2026, 10, 20), status="bestanden", pokale=2)
try:
    client.lzk_anlegen(5, date(2026, 10, 20), "Kreise", "Basis", 1)
except Exception:
    pass
schluessel = set().union(*(set(x[2]) for x in gesendet))
pruefe("H2 was zum Server geht: nur Termin, Status/Flammen, Thema, Typ (und wer/welches Fach)",
       schluessel <= {"userId", "userIds", "lerntheke", "typ", "datum", "status", "pokale", "thema", "subjectId"}
       and len(gesendet) == 3, (schluessel, gesendet))

# Ein verknuepfter Platz, an dem sich seit dem letzten Abgleich NUR Punkte und Note geaendert
# haben: daraus darf kein Sendeauftrag werden.
link = {"id": 70, "datum": "2026-10-20", "ergebnis": "2"}
mit_punkten = D.Baustein(name="Kreise", status="In Bearbeitung", halbjahr="2627_1",
                         lzk_datum_1=date(2026, 10, 20), lzk_ergebnis_1="2", lzk_online_1=dict(link),
                         lzk_note_1="1-", lzk_punkte_1="18,5", lzk_max_1="22")
st = D.Student(vorname="Gabriel", nachname="E", alias="ga.em", bausteine=[mit_punkten])
online = [{"id": 70, "typ": "Basis", "lerntheke": None, "datum": "2026-10-20", "status": "bestanden", "pokale": 2,
           "thema": "Kreise", "anfrage": None, "fach": "mathe"}]
auftraege, _u, _v = D.lt_freie_lzk_senden(st, {"id": 7, "lzk": online}, date(2026, 10, 25), {})
pruefe("H3 nur Punkte/Note geaendert: nichts geht hinaus",
       [x for x in auftraege if x.get("art") != "verknuepfen"] == [], auftraege)
mit_punkten.lzk_ergebnis_1 = "3"
auftraege, _u, _v = D.lt_freie_lzk_senden(st, {"id": 7, "lzk": online}, date(2026, 10, 25), {})
echte = [x for x in auftraege if x.get("art") != "verknuepfen"]
pruefe("H4 neue Flammen gehen hinaus - ohne Punkte, Prozent oder Note im Auftrag",
       len(echte) == 1 and set(echte[0].get("felder", {})) <= {"datum", "status", "pokale"}
       and not any(k in echte[0] for k in ("punkte", "max", "note", "prozent", "lzk_note")), echte)

# ===========================================================================
# D) Mitwandern beim Umziehen und neu Berechnen
# ===========================================================================
z_alt = D.Baustein(name="Kreise", halbjahr="2526_2", lzk_datum_1=date(2026, 5, 4), lzk_note_1="2",
                   lzk_punkte_1="16", lzk_max_1="20", lzk_ergebnis_1="1")
stz = D.Student(vorname="Ava", nachname="B", bausteine=[z_alt])
e = {"id": 81, "typ": "Basis", "lerntheke": None, "datum": "2026-11-10", "status": "ausstehend", "pokale": 0,
     "thema": "Kreise", "anfrage": None, "fach": "mathe"}
z = {"eintrag": e, "nummer": 1, "datum": date(2026, 11, 10), "halbjahr": "2627_1", "titel": "Kreise",
     "typ": "Basis", "ergebnis": "", "schluessel": "thema:kreise"}
D.lzk_zuordnen(stz, z, ("baustein", z_alt))
pruefe("U1 kommt eine andere LZK in den Platz, wandern die alten Punkte mit in die Bemerkung (nichts verloren)",
       "16/20 Punkte" in z_alt.bemerkung and z_alt.lzk_punkte_1 == "" and z_alt.lzk_max_1 == "", z_alt.bemerkung)

s1 = D.Baustein(name="A", lzk_note_1="1-", lzk_punkte_1="18,5", lzk_max_1="22",
                lzk_note_2="4", lzk_punkte_2="10", lzk_max_2="22")
stn = D.Student(vorname="N", nachname="N", bausteine=[s1])
neu = D.Notenspiegel(runden="genau")
n = D.noten_neu_berechnen([stn], D.Notenspiegel(), neu)
pruefe("U2 neuer Notenspiegel: jede aus Punkten berechnete Note folgt (1- -> 2+, 4 bleibt 4)",
       n == 1 and s1.lzk_note_1 == "2+" and s1.lzk_note_2 == "4", (n, s1))

# ===========================================================================
# M) Die Note ist kein Eingabefeld mehr (2026-10-31): Freitext zieht in die LZK-Bemerkung
# ===========================================================================
roh = {"format": "osk-arbeitsstaende", "version": 1, "vorlage_bausteine": [], "personen": [{
    "vorname": "Merle", "nachname": "T", "bausteine": [
        {"name": "Kreise", "lzk_1": {"datum": "2026-05-04", "note": "best"},
         "lzk_2": {"datum": "2026-06-01", "note": "29/34 = 1-", "bemerkung": "Teil 2 sicher"}},
        {"name": "Terme", "lzk_1": {"note": "1-", "punkte": "18,5", "max_punkte": "22"},
         "lzk_2": {"note": "2", "punkte": "18,5", "max_punkte": "22"}},
        {"name": "Leer"}]}]}
azm = D.Arbeitsstaende()
w = azm.aus_dict(json.loads(json.dumps(roh)))
kr, te, leer = azm.students[0].bausteine
pruefe("M1 Freitext ohne Punkte: steht danach als 'Note: ...' in der Bemerkung zur LZK, das Notenfeld ist leer",
       (kr.lzk_note_1, kr.lzk_bem_1) == ("", "Note: best")
       and (kr.lzk_note_2, kr.lzk_bem_2) == ("", "Teil 2 sicher\nNote: 29/34 = 1-") and not w, (kr, w))
pruefe("M2 passt die Note zu den Punkten, bleibt sie; passt sie nicht, zieht sie um und die berechnete steht da",
       (te.lzk_note_1, te.lzk_bem_1) == ("1-", "") and (te.lzk_note_2, te.lzk_bem_2) == ("1-", "Note: 2"), te)
pruefe("M2b ein Baustein ohne LZK bleibt leer", (leer.lzk_note_1, leer.lzk_bem_1, leer.lzk_note_2) == ("", "", ""))
azm2 = D.Arbeitsstaende()
azm2.aus_dict(json.loads(json.dumps(azm.als_dict(), ensure_ascii=False)))
pruefe("M3 beim naechsten Laden nichts doppelt", [D.baustein_als_dict(b) for b in azm2.students[0].bausteine]
       == [D.baustein_als_dict(b) for b in azm.students[0].bausteine])
roh["notenspiegel"] = {"grenzen": dict(D.NOTENSPIEGEL_STANDARD), "runden": "genau"}
roh["personen"][0]["bausteine"] = [{"name": "Terme", "lzk_1": {"note": "2+", "punkte": "18,5", "max_punkte": "22"}}]
azm3 = D.Arbeitsstaende()
azm3.aus_dict(json.loads(json.dumps(roh)))
pruefe("M4 gerechnet wird mit dem Notenspiegel der Datei (genau nach Prozent: 18,5/22 = 2+ bleibt)",
       (azm3.students[0].bausteine[0].lzk_note_1, azm3.students[0].bausteine[0].lzk_bem_1) == ("2+", ""))
alt_hj = D.Baustein(name="Satz des Pythagoras", halbjahr="2526_2", lzk_bem_1="Note: best",
                    lzk_online_1={"id": 9, "datum": "2026-11-10", "ergebnis": ""}, lzk_datum_1=date(2026, 11, 10))
pruefe("M5 eine umgezogene Note gilt weiter als Spur einer frueheren LZK (Umziehen ins richtige Halbjahr)",
       len(D.lzk_falsches_halbjahr(D.Student(vorname="P", nachname="Q", bausteine=[alt_hj]))) == 1)

pruefe("U3 Tabellenzelle: Note, Prozent und Flammen", A._note_mit_ergebnis("1-", "2", "84,1 %") == "1- (84,1 %) 🔥🔥"
       and A._note_mit_ergebnis("", "", "84,1 %") == "84,1 %" and A._note_mit_ergebnis("2-", "2") == "2- 🔥🔥")

quelle = io.open(os.path.join(WERKZEUG, "arbeitsstaende_app.py"), encoding="utf-8").read()
pruefe("U4 Menue Einstellungen -> Notenspiegel für LZK…",
       'label="Notenspiegel für LZK…", command=self.notenspiegel_bearbeiten' in quelle
       and 'menu.add_cascade(label="Einstellungen", menu=einstellungen_menu)' in quelle)
pruefe("U5 beide Wege ins Formular geben den Notenspiegel (und die LZK-Vorgaben) der Arbeitsdatei mit",
       quelle.count("notenspiegel=self.az.notenspiegel, vorlage_lzk=self.az.vorlage_lzk)") == 2)


# App-Teil ohne Fenster: Notenspiegel aendern
class Dlg:
    ergebnis = None

    def __init__(self, parent, sp):
        self.result = Dlg.ergebnis


app = A.App.__new__(A.App)
app.az = D.Arbeitsstaende()
app.az.students = [D.Student(vorname="N", nachname="N", bausteine=[
    D.Baustein(name="A", lzk_note_1="1-", lzk_punkte_1="18,5", lzk_max_1="22")])]
app.aktueller_schueler = None
app.wait_window = lambda d: None
meldungen, markiert = [], []
app._melde = meldungen.append
app._markiere_ungespeichert = lambda: markiert.append(1)
echt_dlg = A.NotenspiegelDialog
A.NotenspiegelDialog = Dlg
try:
    Dlg.ergebnis = None
    app.notenspiegel_bearbeiten()
    pruefe("U6 abgebrochen: nichts geaendert, nichts markiert", app.az.notenspiegel == D.Notenspiegel() and not markiert)
    Dlg.ergebnis = D.Notenspiegel(runden="genau")
    app.notenspiegel_bearbeiten()
    pruefe("U7 uebernommen: Spiegel gesetzt, Note nachgerechnet, ungespeichert, Meldung in der Statuszeile",
           app.az.notenspiegel.runden == "genau" and app.az.students[0].bausteine[0].lzk_note_1 == "2+"
           and markiert and "1 berechnete" in meldungen[-1], meldungen)
finally:
    A.NotenspiegelDialog = echt_dlg

# ===========================================================================
# E) Die echten Fenster (nur mit Bildschirm)
# ===========================================================================
try:
    import tkinter as tk
    probe = tk.Tk()
    probe.destroy()
    bildschirm = True
except Exception:
    bildschirm = False
if bildschirm:
    wurzel = tk.Tk()
    wurzel.withdraw()
    rueckfragen = []
    echt_ja, echt_fehler = A.messagebox.askyesno, A.messagebox.showerror
    A.messagebox.askyesno = lambda titel, text, **k: rueckfragen.append(text) or rueckfragen_antwort
    A.messagebox.showerror = lambda titel, text, **k: rueckfragen.append("FEHLER " + text)
    try:
        dlg = A.BausteinDialog(wurzel, D.Baustein(name="Kreise"), notenspiegel=D.Notenspiegel())
        wurzel.update()
        texte = [w.cget("text") for w in dlg._form.winfo_children() if isinstance(w, tk.ttk.Label)]
        pruefe("F1 unter dem Ergebnis: 'Punkte 1 (erreicht von max.)'",
               texte.index("Punkte 1 (erreicht von max.)") == texte.index("LZK-Ergebnis 1") + 1, texte)
        pruefe("F1b die Note ist kein Eingabefeld mehr (keine Zeile 'LZK-Note', kein Feld)",
               not any("LZK-Note" in x for x in texte) and "lzk_note_1" not in dlg.vars
               and "lzk_note_2" not in dlg.vars, texte)
        dlg.vars["lzk_punkte_1"].set("18,5")
        dlg.vars["lzk_max_1"].set("22")
        pruefe("F2 Punkte eingetippt: daneben Prozent und Note (nur Anzeige)",
               dlg._punkte_info[1].cget("text") == "= 84,1 % → Note 1-", dlg._punkte_info[1].cget("text"))
        dlg.vars["lzk_punkte_1"].set("17")
        pruefe("F3 andere Punkte: die Anzeige rechnet neu", dlg._punkte_info[1].cget("text") == "= 77,3 % → Note 2")
        pruefe("F3b die Flammen setzt das nicht", dlg.vars["lzk_ergebnis_1"].get() == D.LZK_ERGEBNIS_TEXT[""])
        dlg.vars["lzk_punkte_1"].set("")
        pruefe("F5 Punkte weg: Anzeige leer", dlg._punkte_info[1].cget("text") == "")
        dlg.vars["lzk_punkte_1"].set("abc")
        pruefe("F6 keine Zahl: Hinweis neben den Punkten", "Zahlen" in dlg._punkte_info[1].cget("text"))
        dlg._uebernehmen()
        pruefe("F6b und Übernehmen sagt, was fehlt (kein Speichern)",
               dlg.result is None and any("erreichte Punkte" in r for r in rueckfragen), rueckfragen)
        dlg.vars["lzk_punkte_1"].set("18.5")
        dlg.vars["lzk_punkte_2"].set("30")
        dlg.vars["lzk_max_2"].set("25")
        rueckfragen_antwort = False
        dlg._uebernehmen()
        pruefe("F7 mehr Punkte als maximal: Rueckfrage, bei Nein bleibt das Formular offen",
               dlg.result is None and any("30 von 25" in r for r in rueckfragen), rueckfragen)
        rueckfragen_antwort = True
        dlg._uebernehmen()
        r = dlg.result
        pruefe("F8 bei Ja gespeichert: Punkte einheitlich geschrieben, die Note aus den Punkten",
               r is not None and (r.lzk_punkte_1, r.lzk_max_1, r.lzk_note_1) == ("18,5", "22", "1-")
               and (r.lzk_punkte_2, r.lzk_max_2, r.lzk_note_2) == ("30", "25", "1+"), r)

        # Vorhandener Baustein: neue Punkte -> neue Note
        vorh = D.Baustein(name="Terme", lzk_note_2="2", lzk_punkte_2="17", lzk_max_2="22")
        dlg2 = A.BausteinDialog(wurzel, vorh, notenspiegel=D.Notenspiegel())
        wurzel.update()
        pruefe("F9 beim Oeffnen: Prozent und Note neben den Punkten", dlg2._punkte_info[2].cget("text") == "= 77,3 % → Note 2")
        dlg2.vars["lzk_punkte_2"].set("20")
        dlg2._uebernehmen()
        pruefe("F9b neue Punkte: gespeicherte Note folgt", dlg2.result.lzk_note_2 == "1", dlg2.result)

        # Alter Freitext im Notenfeld: steht im Formular in der Bemerkung zur LZK
        handnote = D.Baustein(name="Terme", lzk_note_1="best", lzk_punkte_1="17", lzk_max_1="22",
                              lzk_note_2="n.b. da Klinik", lzk_bem_2="Nachschreiben")
        dlg3 = A.BausteinDialog(wurzel, handnote, notenspiegel=D.Notenspiegel())
        wurzel.update()
        bem1 = dlg3.vars["lzk_bem_1"].get("1.0", "end").strip()
        bem2 = dlg3.vars["lzk_bem_2"].get("1.0", "end").strip()
        pruefe("F10 alter Freitext ('best', 'n.b. da Klinik') steht als 'Note: ...' in der Bemerkung zur LZK",
               bem1 == "Note: best" and bem2 == "Nachschreiben\nNote: n.b. da Klinik", (bem1, bem2))
        pruefe("F10b das Original bleibt unangetastet, solange nicht übernommen ist",
               handnote.lzk_note_1 == "best" and handnote.lzk_bem_1 == "")
        dlg3._uebernehmen()
        r3 = dlg3.result
        pruefe("F10c nach Übernehmen: berechnete Note bzw. leer, der Freitext steht in der Bemerkung",
               (r3.lzk_note_1, r3.lzk_bem_1) == ("2", "Note: best")
               and (r3.lzk_note_2, r3.lzk_bem_2) == ("", "Nachschreiben\nNote: n.b. da Klinik"), r3)

        # Einstellungs-Dialog
        nd = A.NotenspiegelDialog(wurzel, D.Notenspiegel())
        wurzel.update()
        vorschau = [(n, nd._punkte_labels[n].cget("text")) for n in D.NOTEN]
        pruefe("D1 Vorschau mit 22 Punkten = die Tabelle der Vorlage", vorschau == [(n, g) for n, _p, g in VORLAGE_22],
               vorschau)
        pruefe("D1b die 6 bleibt bei 0 (nicht bearbeitbar)", nd.grenzen_vars["6"].get() == "0")
        nd.grenzen_vars["2+"].set("90")
        pruefe("D2 falsche Reihenfolge: Hinweis im Fenster", "unter der von" in nd.fehler.cget("text"), nd.fehler.cget("text"))
        nd._uebernehmen()
        pruefe("D2b und Übernehmen lehnt ab", nd.result is None and any("unter der von" in r for r in rueckfragen))
        nd._standard()
        nd.grenzen_vars["1+"].set("96")
        nd.max_var.set("30")
        pruefe("D3 andere Beispiel-Punktzahl: Vorschau rechnet neu (96 % von 30 = 28,8 -> 29,0)",
               nd._punkte_labels["1+"].cget("text") == "29,0" and nd.fehler.cget("text") == "")
        nd.runden_var.set(D.NOTEN_RUNDEN["genau"])
        pruefe("D3b 'genau': Grenze ohne Rundung", nd._punkte_labels["1+"].cget("text") == "28,8")
        nd._uebernehmen()
        pruefe("D4 Übernehmen liefert den neuen Spiegel",
               nd.result == D.Notenspiegel(grenzen=dict(D.NOTENSPIEGEL_STANDARD, **{"1+": "96"}), runden="genau"),
               nd.result)
        wurzel.destroy()
    finally:
        A.messagebox.askyesno, A.messagebox.showerror = echt_ja, echt_fehler
else:
    print("--  Fenster-Pruefungen uebersprungen (kein Bildschirm)")

print(f"\n{ok} Prüfungen bestanden.")
