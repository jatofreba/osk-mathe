"""Sind alle LZK eines Bausteins bestanden (so viele, wie er hat), wechselt er auf
"Abgeschlossen" (2026-10-31) - im Formular, beim Abruf aus OSKlar, beim Zuordnen und
(nach Rueckfrage) wenn die Vorlage die Anzahl verkleinert. Nie rueckwirkend beim Laden,
nie bei "nicht bestanden", nie aus einem Status, den nur der Mensch setzt."""
import json
import os
import sys
from datetime import date

HIER = os.path.dirname(os.path.abspath(__file__))
from pfade import WERKZEUG  # noqa: E402
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


VORLAGE = {"Kreise": 1}
HJ = D.halbjahr_fuer_datum()


def baustein(**k):
    return D.Baustein(**{"name": "Terme", "status": "In Bearbeitung", **k})


# ===========================================================================
# A) Wann ein Baustein fertig ist
# ===========================================================================
pruefe("A1 zwei LZK, beide bestanden (auch ohne Flamme)",
       D.lzk_alle_bestanden(baustein(lzk_ergebnis_1="0", lzk_ergebnis_2="3")))
pruefe("A1b eine fehlt noch / eine nicht bestanden: nicht fertig",
       not D.lzk_alle_bestanden(baustein(lzk_ergebnis_1="2"))
       and not D.lzk_alle_bestanden(baustein(lzk_ergebnis_1="2", lzk_ergebnis_2="nicht_bestanden")))
pruefe("A1c Punkte allein reichen nicht - es zaehlt das Ergebnis",
       not D.lzk_alle_bestanden(baustein(lzk_ergebnis_1="2", lzk_punkte_2="20", lzk_max_2="22")))
pruefe("A2 die Anzahl zaehlt: Vorlage mit einer LZK, oder eigens drei",
       D.lzk_alle_bestanden(baustein(name="Kreise", lzk_ergebnis_1="1"), VORLAGE)
       and not D.lzk_alle_bestanden(baustein(lzk_anzahl=3, lzk_ergebnis_1="1", lzk_ergebnis_2="1")))
pruefe("A3 ein Baustein ohne LZK ist nie 'fertig'", not D.lzk_alle_bestanden(baustein(lzk_anzahl=0)))

for status, erwartet in (("In Bearbeitung", True), ("Ausstehend", True), ("Nicht bestanden", False),
                         ("Sonstiges", False), ("Abgeschlossen", False)):
    b = baustein(status=status, halbjahr="2526_2", lzk_ergebnis_1="2", lzk_ergebnis_2="1")
    pruefe(f"A4 Status '{status}' -> {'Abgeschlossen' if erwartet else 'bleibt'}",
           D.lzk_abschluss_status(b) == erwartet and b.status == ("Abgeschlossen" if erwartet else status)
           and b.halbjahr == "2526_2", b.status)
app_zeile = baustein(bemerkung=D.LT_MARKER + " 20 von 20", lzk_ergebnis_1="2", lzk_ergebnis_2="1")
pruefe("A5 Zeilen aus der App fuehrt der Abruf - kein Abschluss hier",
       not D.lzk_abschluss_status(app_zeile) and app_zeile.status == "In Bearbeitung")
ohne_hj = baustein(lzk_datum_1=date(2026, 3, 2), lzk_ergebnis_1="2", lzk_datum_2=date(2026, 5, 4), lzk_ergebnis_2="1")
D.lzk_abschluss_status(ohne_hj)
pruefe("A6 ohne Halbjahr: das der letzten LZK", ohne_hj.halbjahr == D.halbjahr_fuer_datum(date(2026, 5, 4)), ohne_hj.halbjahr)

az = D.Arbeitsstaende()
az.aus_dict({"format": D.JSON_FORMAT, "version": 2, "personen": [{"vorname": "A", "nachname": "B", "bausteine": [
    {"name": "Terme", "status": "In Bearbeitung", "lzk_1": {"ergebnis": "2"}, "lzk_2": {"ergebnis": "3"}}]}]})
pruefe("A7 nie rueckwirkend: beim Laden bleibt 'In Bearbeitung'", az.students[0].bausteine[0].status == "In Bearbeitung")

# ===========================================================================
# S) Ergebnisse aus OSKlar
# ===========================================================================


def online(i, thema, datum="2026-10-20", status="bestanden", pokale=2, typ="Basis"):
    return {"id": i, "typ": typ, "lerntheke": None, "datum": datum, "status": status, "pokale": pokale,
            "thema": thema, "anfrage": None, "fach": "mathe"}


def verknuepft(i, datum="2026-10-20"):
    return {"id": i, "datum": datum, "ergebnis": ""}


def person(*bausteine):
    return D.Student(vorname="G", nachname="E", alias="ga.em", bausteine=list(bausteine))


kreise = D.Baustein(name="Kreise", status="In Bearbeitung", lzk_datum_1=date(2026, 10, 20), lzk_online_1=verknuepft(5))
uebernommen, _ = D.lt_freie_lzk_uebernehmen(person(kreise), {"id": 1, "lzk": [online(5, "Kreise")]}, VORLAGE)
pruefe("S1 Abruf: Ergebnis kommt herein, die einzige LZK ist bestanden -> 'Abgeschlossen' (im Bericht)",
       kreise.lzk_ergebnis_1 == "2" and kreise.status == "Abgeschlossen"
       and any("Abgeschlossen" in z for z in uebernommen), uebernommen)
kreise2 = D.Baustein(name="Kreise", status="In Bearbeitung", lzk_datum_1=date(2026, 10, 20), lzk_online_1=verknuepft(5))
D.lt_freie_lzk_uebernehmen(person(kreise2), {"id": 1, "lzk": [online(5, "Kreise")]})
pruefe("S1b ohne Vorlage (zwei LZK): die zweite fehlt noch, Status bleibt", kreise2.status == "In Bearbeitung")
kreise3 = D.Baustein(name="Kreise", status="In Bearbeitung", lzk_datum_1=date(2026, 10, 20), lzk_online_1=verknuepft(5))
D.lt_freie_lzk_uebernehmen(person(kreise3), {"id": 1, "lzk": [online(5, "Kreise", status="nicht_bestanden")]}, VORLAGE)
pruefe("S1c nicht bestanden: Status bleibt", kreise3.lzk_ergebnis_1 == "nicht_bestanden" and kreise3.status == "In Bearbeitung")
schon = D.Baustein(name="Kreise", status="In Bearbeitung", lzk_datum_1=date(2026, 10, 20), lzk_ergebnis_1="2",
                   lzk_online_1={"id": 5, "datum": "2026-10-20", "ergebnis": "2"})
D.lt_freie_lzk_uebernehmen(person(schon), {"id": 1, "lzk": [online(5, "Kreise", datum="2026-10-21")]}, VORLAGE)
pruefe("S1d nur das Datum kommt herein (kein neues Ergebnis): Status bleibt",
       schon.lzk_datum_1 == date(2026, 10, 21) and schon.status == "In Bearbeitung")

terme = D.Baustein(name="Terme", status="In Bearbeitung", halbjahr=HJ, lzk_datum_1=date(2026, 9, 10), lzk_ergebnis_1="3")
st = person(terme)
z = D.lzk_zuordnungen(st, {"id": 1, "lzk": [online(9, "Terme", datum="2026-10-22", pokale=1, typ="Aufbau")]})[0]
zeile, ziel = D.lzk_zuordnen(st, z, z["vorschlag"], None, {})
pruefe("S2 Zuordnen mit Ergebnis: LZK 2 bestanden, LZK 1 schon -> 'Abgeschlossen' (im Bericht)",
       ziel is terme and terme.lzk_ergebnis_2 == "1" and terme.status == "Abgeschlossen"
       and "jetzt „Abgeschlossen“" in zeile, zeile)
neu = D.Baustein(name="Kreise", status="Ausstehend")
st2 = person(neu)
z = D.lzk_zuordnungen(st2, {"id": 1, "lzk": [online(10, "Kreise", status="ausstehend", pokale=0)]})[0]
zeile, _ = D.lzk_zuordnen(st2, z, z["vorschlag"], None, VORLAGE)
pruefe("S2b Zuordnen ohne Ergebnis: wie bisher nur 'In Bearbeitung'",
       neu.status == "In Bearbeitung" and "jetzt „In Bearbeitung“" in zeile, zeile)

# ===========================================================================
# V) Vorlage verkleinert die Anzahl: erst fragen
# ===========================================================================
fragen = []


class Dlg:
    def __init__(self, parent, bausteine, anzahl=None):
        self.result, self.anzahl = list(bausteine), {"Kreise": 1}


echt_dlg, echt_ja = A.VorlageDialog, A.messagebox.askyesno
try:
    A.VorlageDialog = Dlg
    for antwort in (False, True):
        app = A.App.__new__(A.App)
        app.az = D.Arbeitsstaende()
        app.az.vorlage_bausteine = ["Kreise"]
        fertig = D.Baustein(name="Kreise", status="In Bearbeitung", lzk_ergebnis_1="2")
        offen = D.Baustein(name="Kreise", status="In Bearbeitung", lzk_ergebnis_1="nicht_bestanden")
        vorher_fertig = D.Baustein(name="Terme", status="In Bearbeitung", lzk_ergebnis_1="2", lzk_ergebnis_2="2")
        app.az.students = [D.Student("Ada", "Berg", bausteine=[fertig, offen, vorher_fertig])]
        app.aktueller_schueler = None
        app.wait_window = lambda d: None
        app._markiere_ungespeichert = app._liste_aktualisieren = lambda: None
        meldungen = []
        app._melde = meldungen.append
        fragen.clear()
        A.messagebox.askyesno = lambda titel, text, **k: fragen.append(text) or antwort
        app.vorlage_bearbeiten()
        if not antwort:
            pruefe("V1 Kreise nur noch eine LZK: Rueckfrage nennt den fertigen Baustein (nicht den nicht bestandenen, "
                   "nicht den schon vorher fertigen)",
                   len(fragen) == 1 and "Ada Berg: Kreise" in fragen[0] and "1 Baustein" in fragen[0]
                   and "Terme" not in fragen[0], fragen)
            pruefe("V1b bei Nein bleibt alles", fertig.status == "In Bearbeitung" and app.az.vorlage_lzk == {"Kreise": 1})
        else:
            pruefe("V2 bei Ja: abgeschlossen, Meldung in der Statuszeile",
                   fertig.status == "Abgeschlossen" and offen.status == "In Bearbeitung"
                   and vorher_fertig.status == "In Bearbeitung" and meldungen and "1 Baustein" in meldungen[-1], meldungen)
    app.vorlage_bearbeiten()
    pruefe("V3 nichts Neues fertig: keine Rueckfrage", len(fragen) == 1)
finally:
    A.VorlageDialog, A.messagebox.askyesno = echt_dlg, echt_ja

# ===========================================================================
# F) Das echte Formular (nur mit Bildschirm)
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
    T = D.LZK_ERGEBNIS_TEXT
    b = D.Baustein(name="Terme", status="In Bearbeitung", halbjahr="2526_2", lzk_ergebnis_1="2",
                   lzk_datum_1=date(2026, 3, 2))
    dlg = A.BausteinDialog(wurzel, b)
    wurzel.update()
    pruefe("F1 beim Oeffnen bleibt der Status", dlg.vars["status"].get() == "In Bearbeitung")
    dlg.vars["lzk_ergebnis_2"].set(T["nicht_bestanden"])
    pruefe("F2 LZK 2 nicht bestanden: Status bleibt", dlg.vars["status"].get() == "In Bearbeitung")
    dlg.vars["lzk_ergebnis_2"].set(T["1"])
    pruefe("F3 LZK 2 bestanden: sofort 'Abgeschlossen', das Halbjahr folgt (laufendes)",
           dlg.vars["status"].get() == "Abgeschlossen" and dlg.vars["halbjahr"].get() == HJ,
           (dlg.vars["status"].get(), dlg.vars["halbjahr"].get()))
    dlg.vars["lzk_ergebnis_2"].set(T[""])
    pruefe("F4 Ergebnis zurueckgenommen: alter Status und altes Halbjahr kehren zurueck",
           dlg.vars["status"].get() == "In Bearbeitung" and dlg.vars["halbjahr"].get() == "2526_2",
           (dlg.vars["status"].get(), dlg.vars["halbjahr"].get()))
    dlg.vars["lzk_anzahl"].set("1")
    pruefe("F5 Anzahl auf 1 (LZK 1 bestanden): 'Abgeschlossen'", dlg.vars["status"].get() == "Abgeschlossen")
    dlg._uebernehmen()
    pruefe("F6 uebernommen: Status 'Abgeschlossen', Anzahl 1",
           dlg.result.status == "Abgeschlossen" and dlg.result.lzk_anzahl == 1, dlg.result)

    sonst = D.Baustein(name="Terme", status="Sonstiges", lzk_ergebnis_1="2")
    dlg2 = A.BausteinDialog(wurzel, sonst)
    dlg2.vars["lzk_ergebnis_2"].set(T["2"])
    pruefe("F7 Status 'Sonstiges' setzt nur der Mensch: bleibt", dlg2.vars["status"].get() == "Sonstiges")
    dlg2.destroy()
    dlg3 = A.BausteinDialog(wurzel, D.Baustein(name="Terme", status="In Bearbeitung", lzk_ergebnis_1="2"))
    dlg3.vars["lzk_ergebnis_2"].set(T["3"])
    dlg3.vars["status"].set("In Bearbeitung")
    dlg3.vars["lzk_ergebnis_2"].set(T["2"])
    pruefe("F8 selbst zurueckgestellt: die naechste Ergebnis-Aenderung schliesst wieder (alle bestanden)",
           dlg3.vars["status"].get() == "Abgeschlossen")
    dlg3.destroy()
    app_b = D.Baustein(name="Baustein Kreise", status="In Bearbeitung", bemerkung=D.LT_MARKER + " 3 von 20",
                       lzk_ergebnis_1="2")
    dlg4 = A.BausteinDialog(wurzel, app_b)
    dlg4.vars["lzk_ergebnis_2"].set(T["2"])
    pruefe("F9 Zeile aus der App: kein Abschluss im Formular", dlg4.vars["status"].get() == "In Bearbeitung")
    dlg4.destroy()
    wurzel.destroy()
else:
    print("--  Fenster-Pruefungen uebersprungen (kein Bildschirm)")

print(f"\n{ok} Prüfungen bestanden.")
