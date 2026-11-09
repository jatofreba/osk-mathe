"""Prueft: Status per Rechtsklick in der Bausteintabelle wechseln, und Beginn und Ende der
Bearbeitung festhalten (Nutzerwunsch 2026-11-09) - mit Dauer in der HJ-Zusammenfassung.
Der Wechsel auf "In Bearbeitung" setzt den Beginn, der auf "Abgeschlossen"/"Nicht
bestanden" das Ende; im Formular, per Rechtsklick und auf den automatischen Wegen."""
import json
import os
import sys
from datetime import date, timedelta

from pfade import WERKZEUG  # noqa: E402
for name in ("arbeitsstaende_data", "osk_sync", "arbeitsstaende_app"):
    sys.modules.pop(name, None)
import arbeitsstaende_data as D  # noqa: E402
import arbeitsstaende_app as A   # noqa: E402

ok = 0


def pruefe(name, bedingung, extra=""):
    global ok
    if not bedingung:
        print(("FAIL: " + name + (("\n      " + str(extra)) if extra else ""))
              .encode("ascii", "replace").decode("ascii"))
        sys.exit(1)
    ok += 1
    print("OK  " + name)


TAG = date(2026, 11, 9)                 # fester "heute" fuer die reinen Regeln
TAG_HJ = D.halbjahr_fuer_datum(TAG)     # 2627_1
HEUTE = date.today()
HJ = D.halbjahr_fuer_datum()
HJ_ALT = D.halbjahr_fuer_datum(HEUTE - timedelta(days=200))
OKT = date(2026, 10, 1)
regel = D.bearbeitung_nach_statuswechsel

# ===========================================================================
# A) Die Regeln
# ===========================================================================
pruefe("A1 Ausstehend -> In Bearbeitung: Beginn heute, kein Ende",
       regel("Ausstehend", "In Bearbeitung", None, None, TAG_HJ, TAG) == (TAG, None))
pruefe("A2 ein frueherer Beginn bleibt (die Bearbeitung laeuft weiter)",
       regel("Ausstehend", "In Bearbeitung", OKT, None, TAG_HJ, TAG) == (OKT, None))
pruefe("A3 In Bearbeitung -> Abgeschlossen: Ende heute, Beginn bleibt",
       regel("In Bearbeitung", "Abgeschlossen", OKT, None, TAG_HJ, TAG) == (OKT, TAG))
pruefe("A4 -> Nicht bestanden ist auch ein Ende",
       regel("In Bearbeitung", "Nicht bestanden", OKT, None, TAG_HJ, TAG) == (OKT, TAG))
pruefe("A5 Abgeschlossen -> Nicht bestanden: das Ende bleibt, wie es war",
       regel("Abgeschlossen", "Nicht bestanden", OKT, date(2026, 10, 20), TAG_HJ, TAG) == (OKT, date(2026, 10, 20)))
pruefe("A6 wieder geoeffnet (Abgeschlossen -> In Bearbeitung): das Ende faellt weg, der Beginn bleibt",
       regel("Abgeschlossen", "In Bearbeitung", OKT, date(2026, 10, 20), TAG_HJ, TAG) == (OKT, None))
for status in ("Ausstehend", "Sonstiges"):
    pruefe(f"A7 In Bearbeitung -> {status}: beides bleibt",
           regel("In Bearbeitung", status, OKT, None, TAG_HJ, TAG) == (OKT, None))
pruefe("A8 derselbe Status: nichts", regel("In Bearbeitung", "In Bearbeitung", None, None, TAG_HJ, TAG) == (None, None))
pruefe("A9 Baustein eines frueheren Halbjahres: heute waere falsch - der Tag bleibt offen",
       regel("Ausstehend", "In Bearbeitung", None, None, "2526_2", TAG) == (None, None)
       and regel("In Bearbeitung", "Abgeschlossen", OKT, None, "2526_2", TAG) == (OKT, None))
pruefe("A10 ohne Halbjahr: heute", regel("", "In Bearbeitung", None, None, "", TAG) == (TAG, None))

# ===========================================================================
# B) Die automatischen Wege
# ===========================================================================
b = D.Baustein(name="Terme", status="Ausstehend", halbjahr=HJ)
D.lzk_import_status(b, HEUTE + timedelta(days=3))
pruefe("B1 LZK kommt in einen ausstehenden Baustein: In Bearbeitung, Beginn heute",
       b.status == "In Bearbeitung" and b.beginn == HEUTE and b.ende is None, b)
alt = D.Baustein(name="Terme", status="Ausstehend")
D.lzk_import_status(alt, HEUTE - timedelta(days=200))
pruefe("B2 LZK aus einem frueheren Halbjahr: Halbjahr wie die LZK, kein Beginn (heute stimmte nicht)",
       alt.status == "In Bearbeitung" and alt.halbjahr == HJ_ALT and alt.beginn is None, alt)
fertig = D.Baustein(name="Terme", status="In Bearbeitung", halbjahr=HJ, beginn=OKT,
                    lzk_ergebnis_1="2", lzk_ergebnis_2="1")
D.lzk_abschluss_status(fertig)
pruefe("B3 alle LZK bestanden: Abgeschlossen, Ende heute, Beginn bleibt",
       fertig.status == "Abgeschlossen" and fertig.beginn == OKT and fertig.ende == HEUTE, fertig)
st = D.Student(vorname="Gabi", nachname="E", alias="ga.em")
datum = HEUTE + timedelta(days=5)
eintrag = {"id": 1, "lerntheke": None, "typ": "LZK", "datum": datum.isoformat(), "status": "ausstehend",
           "pokale": 0, "thema": "Pythagoras", "anfrage": None, "fach": "mathe"}
z = D.lzk_zuordnungen(st, {"lzk": [eintrag]}, {}, {})[0]
D.lzk_zuordnen(st, z, ("neu", "Pythagoras", D.halbjahr_fuer_datum(datum)), {})
neu = st.bausteine[-1]
pruefe("B4 LZK aus OSKlar in einen NEUEN Baustein: der beginnt heute",
       neu.status == "In Bearbeitung" and neu.beginn == (HEUTE if D.halbjahr_fuer_datum(datum) == HJ else None), neu)
falsch = D.Baustein(name="Kreise", status="In Bearbeitung", halbjahr=HJ_ALT, lzk_datum_1=datum, lzk_note_1="best",
                    lzk_online_1={"id": 73, "datum": datum.isoformat(), "ergebnis": ""})
st2 = D.Student(vorname="P", nachname="Q", bausteine=[falsch])
D.lzk_umziehen(st2, D.lzk_falsches_halbjahr(st2)[0])
pruefe("B5 umgezogen in einen neuen Baustein des laufenden Halbjahres: Beginn heute",
       st2.bausteine[-1] is not falsch and st2.bausteine[-1].beginn == (HEUTE if st2.bausteine[-1].halbjahr == HJ else None)
       and falsch.beginn is None, st2.bausteine[-1])

# ===========================================================================
# C) Status wechseln ohne Formular (Rechtsklick)
# ===========================================================================
b = D.Baustein(name="Kreise", status="Ausstehend", halbjahr="2526_2")
v1 = D.status_wechseln(b, "In Bearbeitung", None, TAG)
pruefe("C1 Ausstehend -> In Bearbeitung: Halbjahr folgt (wie im Formular), Beginn heute",
       b.status == "In Bearbeitung" and b.halbjahr == TAG_HJ and b.beginn == TAG and b.ende is None, b)
v2 = D.status_wechseln(b, "Ausstehend", v1, TAG)
pruefe("C2 zurueck auf Ausstehend (Fehlklick): Halbjahr und Beginn wie vorher",
       b.status == "Ausstehend" and b.halbjahr == "2526_2" and b.beginn is None and v2 == [], (b, v2))
ab = D.Baustein(name="Terme", status="Abgeschlossen", halbjahr="2526_2", beginn=date(2026, 3, 1), ende=date(2026, 4, 2))
v = D.status_wechseln(ab, "In Bearbeitung", None, TAG)
pruefe("C3 Abgeschlossen -> In Bearbeitung: wieder offen, Ende weg, Halbjahr laufend",
       ab.ende is None and ab.beginn == date(2026, 3, 1) and ab.halbjahr == TAG_HJ, ab)
D.status_wechseln(ab, "Abgeschlossen", v, TAG)
pruefe("C3b und zurueck: das alte Ende und das alte Halbjahr sind wieder da",
       ab.status == "Abgeschlossen" and ab.ende == date(2026, 4, 2) and ab.halbjahr == "2526_2", ab)
k = D.Baustein(name="Kreise", status="Ausstehend", halbjahr="2526_2")
v = D.status_wechseln(k, "In Bearbeitung", None, TAG)
v = D.status_wechseln(k, "Abgeschlossen", v, TAG + timedelta(days=20))
pruefe("C4 nacheinander In Bearbeitung, dann Abgeschlossen: Beginn vom ersten, Ende vom zweiten Klick",
       k.beginn == TAG and k.ende == TAG + timedelta(days=20) and k.status == "Abgeschlossen", k)
v = D.status_wechseln(k, "In Bearbeitung", v, TAG + timedelta(days=20))
v = D.status_wechseln(k, "Ausstehend", v, TAG + timedelta(days=20))
pruefe("C5 Schritt fuer Schritt zurueck: am Ende wie ganz am Anfang",
       (k.status, k.halbjahr, k.beginn, k.ende) == ("Ausstehend", "2526_2", None, None) and v == [], k)
m = D.Baustein(name="Kreise", status="Ausstehend", halbjahr="2526_2")
v = D.status_wechseln(m, "In Bearbeitung", None, TAG)
m.halbjahr = "2627_2"                    # dazwischen im Formular geaendert
D.status_wechseln(m, "Ausstehend", v, TAG)
pruefe("C6 dazwischen anders geaendert: nichts wird zurueckgedreht, der Beginn bleibt",
       m.status == "Ausstehend" and m.halbjahr == "2627_2" and m.beginn == TAG, m)
app_b = D.Baustein(name="Baustein Kreise", status="Sonstiges", halbjahr="2526_2",
                   bemerkung=D.LT_MARKER + " 3 von 20")
D.status_wechseln(app_b, "In Bearbeitung", None, TAG)
pruefe("C7 App-Zeile: das Halbjahr bleibt (der Abruf findet sie daran wieder)",
       app_b.status == "In Bearbeitung" and app_b.halbjahr == "2526_2" and app_b.beginn is None, app_b)

# ===========================================================================
# D) Arbeitsdatei
# ===========================================================================
az = D.Arbeitsstaende()
az.students = [D.Student(vorname="A", nachname="B", bausteine=[
    D.Baustein(name="Kreise", status="Abgeschlossen", halbjahr=TAG_HJ, beginn=OKT, ende=TAG),
    D.Baustein(name="Terme")])]
datei = json.loads(json.dumps(az.als_dict(), ensure_ascii=False))
bs = datei["personen"][0]["bausteine"]
pruefe("D1 gespeichert als Datum (ISO), ohne Angabe gar nicht",
       bs[0]["beginn"] == "2026-10-01" and bs[0]["ende"] == "2026-11-09" and "beginn" not in bs[1] and "ende" not in bs[1], bs)
az2 = D.Arbeitsstaende()
az2.aus_dict(datei)
k2 = az2.students[0].bausteine[0]
pruefe("D2 und wieder geladen", k2.beginn == OKT and k2.ende == TAG and az2.students[0].bausteine[1].beginn is None, k2)
pruefe("D3 die Datei hat Version 3", datei["version"] == 3 == D.JSON_VERSION)
echt = D.JSON_VERSION
try:
    D.JSON_VERSION = 2          # so liest eine aeltere Anwendung (Mac-App noch nicht neu gebaut) die Datei
    w = D.Arbeitsstaende().aus_dict(datei)
finally:
    D.JSON_VERSION = echt
pruefe("D4 eine aeltere Anwendung warnt, statt Beginn und Ende still zu verlieren",
       any("neueren Version" in x for x in w), w)
alt_datei = {"format": D.JSON_FORMAT, "version": 2, "personen": [{"vorname": "A", "nachname": "B",
             "bausteine": [{"name": "Kreise", "status": "In Bearbeitung"}]}]}
az3 = D.Arbeitsstaende()
pruefe("D5 aeltere Datei: laedt ohne Warnung, ohne Beginn und Ende",
       not az3.aus_dict(alt_datei) and az3.students[0].bausteine[0].beginn is None)

# ===========================================================================
# E) In Worten - HJ-Zusammenfassung
# ===========================================================================
t = lambda **k: D.bearbeitung_text(D.Baustein(name="K", **k), TAG)
pruefe("E1 begonnen und beendet: Zeitraum und Dauer",
       t(status="Abgeschlossen", beginn=date(2026, 10, 17), ende=TAG)
       == "bearbeitet 17.10.2026 – 09.11.2026 (23 Tage ≈ 3 Wochen)", t(status="Abgeschlossen", beginn=date(2026, 10, 17), ende=TAG))
pruefe("E1b kurz: nur Tage, ein Tag, am selben Tag",
       t(beginn=date(2026, 11, 2), ende=TAG).endswith("(7 Tage)") and t(beginn=date(2026, 11, 8), ende=TAG).endswith("(1 Tag)")
       and t(beginn=TAG, ende=TAG).endswith("(am selben Tag)"))
lauf = D.Baustein(name="K", status="In Bearbeitung", beginn=date(2026, 11, 1))
pruefe("E2 laeuft noch: seit wann, bisher wie lange",
       D.status_mit_bearbeitung(lauf, TAG) == "In Bearbeitung seit 01.11.2026 (bisher 8 Tage)", D.status_mit_bearbeitung(lauf, TAG))
pruefe("E3 heute begonnen", t(status="In Bearbeitung", beginn=TAG) == "seit heute (09.11.2026)")
pruefe("E4 begonnen, jetzt wieder ausstehend", t(status="Ausstehend", beginn=OKT) == "begonnen am 01.10.2026")
pruefe("E5 nur ein Ende", t(status="Abgeschlossen", ende=TAG) == "beendet am 09.11.2026")
pruefe("E6 ohne Angaben: nur der Status", t(status="Abgeschlossen") == ""
       and D.status_mit_bearbeitung(D.Baustein(name="K", status="Abgeschlossen")) == "Abgeschlossen")
pruefe("E7 Ende vor Beginn (von Hand verdreht): Zeitraum ohne Dauer",
       t(beginn=TAG, ende=OKT) == "bearbeitet 09.11.2026 – 01.10.2026")
person = D.Student(vorname="A", nachname="B", bausteine=[
    D.Baustein(name="Kreise", status="Abgeschlossen", halbjahr=HJ, beginn=date(2026, 10, 17), ende=TAG),
    D.Baustein(name="Terme", status="In Bearbeitung", halbjahr=HJ, beginn=HEUTE),
    D.Baustein(name="Prozente", status="Ausstehend", halbjahr=HJ)])
text = D.hj_zusammenfassung_text(person, D.hj_zusammenfassung(person, HJ))
pruefe("E8 die HJ-Zusammenfassung zeigt je Baustein Beginn, Ende und Dauer",
       "• Kreise — Abgeschlossen, bearbeitet 17.10.2026 – 09.11.2026 (23 Tage ≈ 3 Wochen)" in text
       and f"• Terme — In Bearbeitung seit heute ({HEUTE.strftime('%d.%m.%Y')})" in text
       and "• Prozente — Ausstehend\n" in text + "\n", text)

# ===========================================================================
# F) Formular und G) Rechtsklick (nur mit Bildschirm)
# ===========================================================================
try:
    import tkinter as tk
    tk.Tk().destroy()
    bildschirm = True
except Exception:
    bildschirm = False

if bildschirm:
    wurzel = tk.Tk()
    wurzel.withdraw()
    meldungen = []
    echt_warn, echt_fehler = A.messagebox.showwarning, A.messagebox.showerror
    A.messagebox.showwarning = lambda titel, text, **k: meldungen.append(text)
    A.messagebox.showerror = lambda titel, text, **k: meldungen.append("FEHLER " + text)
    heute_text = HEUTE.strftime("%d.%m.%Y")
    try:
        dlg = A.BausteinDialog(wurzel, D.Baustein(name="Kreise", status="Ausstehend", halbjahr=HJ_ALT))
        wurzel.update()
        pruefe("F1 das Formular hat Beginn und Ende der Bearbeitung, leer",
               dlg.vars["beginn"].get() == "" and dlg.vars["ende"].get() == "")
        dlg.vars["status"].set("In Bearbeitung")
        pruefe("F2 Status auf In Bearbeitung: Halbjahr laufend, Beginn heute - sichtbar im Feld",
               dlg.vars["halbjahr"].get() == HJ and dlg.vars["beginn"].get() == heute_text and dlg.vars["ende"].get() == "")
        dlg.vars["status"].set("Ausstehend")
        pruefe("F3 zurueck: Beginn wieder leer, Halbjahr wie vorher",
               dlg.vars["beginn"].get() == "" and dlg.vars["halbjahr"].get() == HJ_ALT)
        dlg.vars["status"].set("In Bearbeitung")
        dlg.vars["beginn"].set("01.10.2026")
        dlg.vars["status"].set("Abgeschlossen")
        pruefe("F4 selbst eingetragener Beginn bleibt; Abgeschlossen setzt das Ende",
               dlg.vars["beginn"].get() == "01.10.2026" and dlg.vars["ende"].get() == heute_text)
        dlg._uebernehmen()
        pruefe("F5 uebernommen: Beginn und Ende als Datum am Baustein",
               dlg.result is not None and dlg.result.beginn == OKT and dlg.result.ende == HEUTE, dlg.result)

        dlg = A.BausteinDialog(wurzel, D.Baustein(name="Kreise", status="In Bearbeitung", halbjahr=HJ))
        dlg.vars["beginn"].set("10.11.2026")
        dlg.vars["ende"].set("01.11.2026")
        dlg._uebernehmen()
        pruefe("F6 Ende vor Beginn: Hinweis, nichts uebernommen",
               dlg.result is None and any("vor ihrem Beginn" in x for x in meldungen), meldungen)
        dlg.vars["ende"].set("1.13.2026")
        meldungen.clear()
        dlg._uebernehmen()
        pruefe("F7 kein Datum: Hinweis mit dem Feldnamen", dlg.result is None
               and any("Ende der Bearbeitung" in x for x in meldungen), meldungen)
        dlg.destroy()

        voll = D.Baustein(name="Terme", status="Abgeschlossen", halbjahr=HJ, beginn=OKT, ende=date(2026, 10, 30),
                          lzk_datum_1=date(2026, 10, 20), lzk_ergebnis_1="2")
        dlg = A.BausteinDialog(wurzel, voll)
        wurzel.update()
        dlg._uebernehmen()
        pruefe("F8 nur geoeffnet und uebernommen: Beginn und Ende bleiben (nichts geht verloren)",
               dlg.result.beginn == OKT and dlg.result.ende == date(2026, 10, 30) and voll.beginn == OKT, dlg.result)

        app_zeile = D.Baustein(name="Baustein Kreise", status="Sonstiges", halbjahr=HJ_ALT,
                               bemerkung=D.LT_MARKER + " 3 von 20")
        dlg = A.BausteinDialog(wurzel, app_zeile)
        dlg.vars["status"].set("In Bearbeitung")
        pruefe("F9 App-Zeile: das Halbjahr folgt dem Status nicht (sonst doppelte Zeile beim Abruf)",
               dlg.vars["halbjahr"].get() == HJ_ALT and dlg.vars["beginn"].get() == "")
        dlg.destroy()

        dlg = A.BausteinDialog(wurzel, D.Baustein(name="Terme", status="In Bearbeitung", halbjahr=HJ, beginn=OKT,
                                                  lzk_datum_1=HEUTE, lzk_ergebnis_1="2", lzk_datum_2=HEUTE))
        dlg.vars["lzk_ergebnis_2"].set(D.LZK_ERGEBNIS_TEXT["1"])
        pruefe("F10 letzte LZK bestanden -> Abgeschlossen (automatisch), Ende heute",
               dlg.vars["status"].get() == "Abgeschlossen" and dlg.vars["ende"].get() == heute_text
               and dlg.vars["beginn"].get() == "01.10.2026")
        dlg.destroy()

        # ---- Rechtsklick in der Bausteintabelle ------------------------------------
        A.App._zuletzt_oeffnen = lambda self: None
        app = A.App()
        app.withdraw()
        kreise = D.Baustein(name="Kreise", status="Ausstehend", halbjahr=HJ_ALT)
        terme = D.Baustein(name="Terme", status="In Bearbeitung", halbjahr=HJ, beginn=OKT)
        prozente = D.Baustein(name="Prozente", status="Ausstehend", halbjahr=HJ)
        pers = D.Student("A", "B", bausteine=[kreise, terme, prozente])
        app.az.students = [pers]
        app.aktueller_schueler = pers
        app._detail_anzeigen()
        taste = "<Button-2>" if sys.platform == "darwin" else "<Button-3>"
        pruefe("G1 die rechte Maustaste ist an der Bausteintabelle gebunden", bool(app.tabelle.bind(taste)))

        gezeigt = []

        class MenueAttrappe:
            def tk_popup(self, x, y):
                gezeigt.append((x, y, tuple(app.tabelle.selection())))

            def grab_release(self):
                pass

        echt_menue = app._status_menue
        app._status_menue = lambda: MenueAttrappe()
        app.tabelle.selection_set("0")
        app.tabelle.identify_row = lambda y: "1"

        class Klick:
            x_root, y_root, y = 300, 200, 40
        ergebnis = app._baustein_menue(Klick())
        pruefe("G2 Rechtsklick auf eine nicht markierte Zeile: sie wird markiert, das Menue erscheint dort",
               gezeigt == [(300, 200, ("1",))] and ergebnis == "break", gezeigt)
        app.tabelle.selection_set(("0", "1"))
        gezeigt.clear()
        app._baustein_menue(Klick())
        pruefe("G2b auf eine markierte Zeile: die Markierung (zwei) bleibt", gezeigt and gezeigt[0][2] == ("0", "1"), gezeigt)
        app._status_menue = echt_menue

        app.tabelle.selection_set("1")
        menue = app._status_menue()
        eintraege = [(menue.type(i), menue.entrycget(i, "label") if menue.type(i) != "separator" else "")
                     for i in range(menue.index("end") + 1)]
        labels = [l for _, l in eintraege]
        pruefe("G3 Menue: Name, Beginn, dann alle Zustaende, der jetzige angehakt, dann Bearbeiten",
               labels[0] == "Terme" and labels[1].startswith("seit 01.10.2026")
               and [l for typ, l in eintraege if typ == "radiobutton"] == D.STATUS_OPTIONEN
               and app._status_menue_var.get() == "In Bearbeitung" and labels[-1] == "Bearbeiten…", eintraege)

        app.tabelle.selection_set("0")
        menue = app._status_menue()
        index = next(i for i in range(menue.index("end") + 1)
                     if menue.type(i) == "radiobutton" and menue.entrycget(i, "label") == "In Bearbeitung")
        app.ungespeichert = False
        menue.invoke(index)
        wurzel.update()
        zeile = app.tabelle.item("0", "values")
        status_text = app.status_leiste.cget("text")
        pruefe("G4 'In Bearbeitung' gewaehlt: Status, Halbjahr laufend, Beginn heute - in der Tabelle, ungespeichert",
               kreise.status == "In Bearbeitung" and kreise.halbjahr == HJ and kreise.beginn == HEUTE
               and zeile[0] == "In Bearbeitung" and app.ungespeichert, (kreise, zeile))
        pruefe("G5 die Zeile bleibt markiert, die Statuszeile sagt, was mitging",
               app.tabelle.selection() == ("0",) and "Beginn " + heute_text in status_text
               and f"Halbjahr {HJ}" in status_text, (app.tabelle.selection(), status_text))
        app.status_setzen("Ausstehend")
        pruefe("G6 Fehlklick zurueck: Ausstehend, altes Halbjahr, kein Beginn",
               (kreise.status, kreise.halbjahr, kreise.beginn) == ("Ausstehend", HJ_ALT, None), kreise)

        app.tabelle.selection_set(("1", "2"))
        menue = app._status_menue()
        pruefe("G7 zwei markiert: Kopf sagt es, kein Haken (verschieden), Bearbeiten gesperrt",
               menue.entrycget(0, "label") == "2 Bausteine markiert" and app._status_menue_var.get() == ""
               and menue.entrycget(menue.index("end"), "state") == "disabled")
        app.status_setzen("Abgeschlossen")
        pruefe("G8 beide abgeschlossen: Ende heute (Prozente ohne Beginn), Terme behaelt den Beginn",
               terme.status == prozente.status == "Abgeschlossen" and terme.ende == HEUTE == prozente.ende
               and terme.beginn == OKT and prozente.beginn is None and "2 Bausteine" in app.status_leiste.cget("text"),
               (terme, prozente))
        app.destroy()
    finally:
        A.messagebox.showwarning, A.messagebox.showerror = echt_warn, echt_fehler
    wurzel.destroy()
else:
    print("--  Fenster-Pruefungen uebersprungen (kein Bildschirm)")

print(f"\n{ok} Prüfungen bestanden.")
