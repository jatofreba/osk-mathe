"""Prueft die Halbjahres-Zusammenfassung einer Person und die HJ-Noten je Halbjahr."""
import importlib.util
import json
import os
import sys
from datetime import date, timedelta

from pfade import WERKZEUG  # noqa: E402
import arbeitsstaende_data as d  # noqa: E402

ok = 0


def pruefe(name, bedingung, extra=""):
    global ok
    if not bedingung:
        print(("FAIL: " + name + (("\n      " + str(extra)) if extra else ""))
              .encode("ascii", "replace").decode("ascii"))
        sys.exit(1)
    ok += 1
    print("OK  " + name)


HJ = d.halbjahr_fuer_datum()
# Ein Tag sicher im laufenden und einer im vorigen Halbjahr
heute = date.today()
im_hj = heute
vor_hj = heute - timedelta(days=200)
HJ_ALT = d.halbjahr_fuer_datum(vor_hj)
assert HJ_ALT != HJ

p = d.Student(vorname="Ben", nachname="Jansen", alias="be.ja", kursung="E", jahrgangsstufe=9)
p.bausteine = [
    d.Baustein(name="Bruchrechnung", status="Abgeschlossen", halbjahr=HJ,
               bausteinarbeit="Heft komplett", bemerkung="sauber gearbeitet\nTextaufgaben üben",
               lzk_datum_1=im_hj, lzk_note_1="2", lzk_ergebnis_1="2", lzk_bem_1="Teil 1 sicher"),
    d.Baustein(name="Prozente", status="In Bearbeitung", halbjahr=HJ,
               lzk_note_2="3"),                       # undatierte LZK mit Note
    d.Baustein(name="Terme", status="Abgeschlossen", halbjahr=HJ_ALT, lzk_datum_1=vor_hj),
    d.Baustein(name=f"{d.LT_TALK_NAME} {HJ}", status="Sonstiges", halbjahr=HJ,
               bemerkung=f"{d.LT_MARKER} 1x gehalten"),
    d.Baustein(name="Kreise", status="Ausstehend", halbjahr=HJ,
               bemerkung=f"{d.LT_MARKER} 4/10 Stationen"),
]
p.fb_besuche = sorted([im_hj, vor_hj])
p.talks = [d.MatheTalk(rolle="gehalten", online_id=1, datum=im_hj, halbjahr=HJ, thema="Pythagoras",
                       status="erledigt", flammen=2),
           d.MatheTalk(rolle="zugehoert", online_id=2, datum=vor_hj, halbjahr=HJ_ALT, thema="Alt")]

# ===========================================================================
# A) Inhalt
# ===========================================================================
z = d.hj_zusammenfassung(p, HJ)
namen = [b.name for b in z["bausteine"]]
pruefe("A1 nur Bausteine dieses Halbjahres", "Terme" not in namen and "Bruchrechnung" in namen, namen)
pruefe("A2 ohne die Talk-Textzeile (Talks stehen einzeln)",
       not any(n.startswith(d.LT_TALK_NAME) for n in namen), namen)
pruefe("A3 Lerntheken-Zeilen aus der App bleiben", "Kreise" in namen)
pruefe("A4 LZK: datierte nach Datum, undatierte mit Note nach Baustein",
       [(l["baustein"], l["nr"]) for l in z["lzk"]] == [("Bruchrechnung", 1), ("Prozente", 2)], z["lzk"])
pruefe("A5 FB-Besuche nur dieses Halbjahres", z["fb_besuche"] == [im_hj], z["fb_besuche"])
pruefe("A6 Talks nur dieses Halbjahres", [t.thema for t in z["talks"]] == ["Pythagoras"])
z_alt = d.hj_zusammenfassung(p, HJ_ALT)
pruefe("A7 ein anderes Halbjahr zeigt dessen Stand",
       [b.name for b in z_alt["bausteine"]] == ["Terme"] and z_alt["fb_besuche"] == [vor_hj])

text = d.hj_zusammenfassung_text(p, z)
pruefe("A8 Text: Kommentare zu den Bausteinen, auch mehrzeilig",
       "sauber gearbeitet" in text and "Textaufgaben üben" in text, text)
pruefe("A9 Text: LZK mit Note, Ergebnis und Bemerkung",
       "Note 2" in text and "Teil 1 sicher" in text and d.LZK_ERGEBNIS_TEXT["2"] in text, text)
pruefe("A10 Text: Anzahl Fachbüro-Besuche", "FACHBÜRO-BESUCHE: 1" in text, text)
pruefe("A11 Text: App-Markierung lesbar statt [Lerntheken-App]",
       d.LT_MARKER not in text and "(aus der App) 4/10 Stationen" in text, text)

# ===========================================================================
# B) HJ-Noten je Halbjahr
# ===========================================================================
d.hj_note_setzen(p, HJ_ALT, "3+")
pruefe("B1 Note eines frueheren Halbjahres beruehrt das Kopffeld nicht",
       p.hj_note == "" and d.hj_note_von(p, HJ_ALT) == "3+")
d.hj_note_setzen(p, HJ, " 2- ")
pruefe("B2 Note des laufenden Halbjahres zieht das Kopffeld mit", p.hj_note == "2-")
pruefe("B3 und steht in der Zusammenfassung", "HJ-Note: 2-" in d.hj_zusammenfassung_text(p, d.hj_zusammenfassung(p, HJ)))
d.hj_note_setzen(p, HJ, "")
pruefe("B4 leer entfernt die Note", HJ not in p.hj_noten and p.hj_note == "")
d.hj_note_setzen(p, HJ, "2")

az = d.Arbeitsstaende()
az.students = [p]
daten = json.loads(json.dumps(az.als_dict(), ensure_ascii=False))
az2 = d.Arbeitsstaende()
az2.aus_dict(daten)
q = az2.students[0]
pruefe("B5 beide Noten ueberstehen Speichern und Laden",
       q.hj_noten == {HJ: "2", HJ_ALT: "3+"} and q.hj_note == "2", (q.hj_noten, q.hj_note))

alt = d.Arbeitsstaende()
alt.aus_dict({"format": d.JSON_FORMAT, "version": 1,
              "personen": [{"vorname": "A", "nachname": "B", "hj_note": "4"}]})
pruefe("B6 aeltere Datei mit nur EINER Note: gilt fuers laufende Halbjahr",
       alt.students[0].hj_noten == {HJ: "4"} and alt.students[0].hj_note == "4", alt.students[0].hj_noten)

pruefe("B7 Auswahl enthaelt alle Halbjahre der Person",
       HJ in d.hj_auswahl(p) and HJ_ALT in d.hj_auswahl(p))

# ===========================================================================
# C) Oberflaeche (nur mit Bildschirm)
# ===========================================================================
QUELLE = os.path.join(WERKZEUG, "arbeitsstaende_app.py")
spec = importlib.util.spec_from_file_location("hjapp", QUELLE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
try:
    import tkinter as tk
    probe = tk.Tk()
    probe.destroy()
    bildschirm = True
except Exception:
    bildschirm = False
if bildschirm:
    mod.App._zuletzt_oeffnen = lambda self: None
    app = mod.App()
    app.withdraw()
    app.az.students = [p]
    app.aktueller_schueler = p
    app._detail_anzeigen()
    gemeldet = []

    def bei_note(hj, note):
        gemeldet.append((hj, note))
        d.hj_note_setzen(p, hj, note)

    dlg = mod.HjZusammenfassungDialog(app, p, bei_note)
    pruefe("C1 startet im laufenden Halbjahr mit dessen Note",
           dlg.v_hj.get() == HJ and dlg.v_note.get() == "2")
    pruefe("C2 zeigt die Zusammenfassung", "Bruchrechnung" in dlg.feld.get("1.0", "end"))
    dlg.v_note.set("1-")
    dlg.v_hj.set(HJ_ALT)
    dlg._halbjahr_gewechselt()
    pruefe("C3 beim Halbjahreswechsel wird die getippte Note uebernommen",
           gemeldet == [(HJ, "1-")] and p.hj_note == "1-", gemeldet)
    pruefe("C4 und das andere Halbjahr zeigt seine Note und seinen Stand",
           dlg.v_note.get() == "3+" and "Terme" in dlg.feld.get("1.0", "end"))
    dlg.v_note.set("3")
    dlg._schliessen()
    pruefe("C5 Schliessen uebernimmt die Note ebenfalls", d.hj_note_von(p, HJ_ALT) == "3")
    app.destroy()
else:
    print("--  Oberflaechen-Pruefungen uebersprungen (kein Bildschirm)")

print(f"\n{ok} Prüfungen bestanden.")
