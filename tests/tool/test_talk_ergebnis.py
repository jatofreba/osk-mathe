"""Mathe-Talk bewerten im Tool: eine Flamme setzt "✓ ok" (hat stattgefunden) - dieselbe
Regel wie in der App (Nutzerwunsch 2026-10-14). Vorher blieb "noch nicht bewertet" mit
Flammen stehen und wurde nie hochgeladen.

Erst die Regel selbst, dann das Bewertungsfenster: ohne Oberflaeche (Attrappen) und, wenn
ein Bildschirm da ist, als echtes Fenster.
"""
import importlib.util
import os
import sys

from pfade import WERKZEUG  # noqa: F401  (setzt den Suchpfad aufs Tool)
import arbeitsstaende_data as d

ok = 0


def pruefe(name, bedingung, extra=""):
    global ok
    if not bedingung:
        print(f"FAIL: {name}  {extra}")
        sys.exit(1)
    ok += 1
    print(f"OK  {name}")


# --- R) die Regel ------------------------------------------------------------
pruefe("R1 Flammen mit 'noch nicht bewertet' werden '✓ ok'", d.talk_ergebnis("ausstehend", 2, 3) == ("erledigt", 2))
pruefe("R2 '✗ nicht ok' traegt keine Flammen", d.talk_ergebnis("nicht_erledigt", 2, 3) == ("nicht_erledigt", 0))
pruefe("R3 ohne Flammen bleibt 'noch nicht bewertet'", d.talk_ergebnis("ausstehend", 0, 3) == ("ausstehend", 0))
pruefe("R4 '✓ ok' ohne Flamme geht weiter", d.talk_ergebnis("erledigt", 0, 2) == ("erledigt", 0))
pruefe("R5 Zuhoeren hoechstens 2 Flammen", d.talk_ergebnis("erledigt", 3, 2) == ("erledigt", 2))
pruefe("R6 Unsinn als Flammen zaehlt als 0", d.talk_ergebnis("ausstehend", "x", 3) == ("ausstehend", 0))
pruefe("R7 ein Vortrag bis 4 Flammen (seit 2026-10-14)", d.talk_ergebnis("erledigt", 9) == ("erledigt", 4)
       and d.talk_ergebnis("ausstehend", 4, d.MatheTalk(rolle="gehalten").max_flammen) == ("erledigt", 4))

# --- D) das Fenster ohne Oberflaeche -----------------------------------------
QUELLE = os.path.join(WERKZEUG, "arbeitsstaende_app.py")
spec = importlib.util.spec_from_file_location("talkerg_app", QUELLE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class Var:
    def __init__(self, w=""):
        self.w = w

    def get(self):
        return self.w

    def set(self, w):
        self.w = w


class Text:
    def get(self, *_a):
        return "\n"


def fenster(talk, status_text, flammen):
    dlg = mod.TalkDialog.__new__(mod.TalkDialog)
    dlg.talk = talk
    dlg._status_texte = [d.TALK_STATUS_TEXT[w] for w in d.TALK_STATUS_WERTE]
    dlg.v_status, dlg.v_flammen, dlg.v_emoji = Var(status_text), Var(str(flammen)), Var("")
    dlg.v_thema, dlg.t_bem = Var(talk.thema), Text()
    dlg.destroy = lambda: None
    return dlg


OK_TEXT, OFFEN_TEXT, NEIN_TEXT = (d.TALK_STATUS_TEXT[w] for w in ("erledigt", "ausstehend", "nicht_erledigt"))
dlg = fenster(d.MatheTalk(rolle="zugehoert"), OFFEN_TEXT, 0)
dlg.v_flammen.set("2")
dlg._flammen_gewaehlt()
pruefe("D1 eine Flamme waehlen setzt '✓ ok'", dlg.v_status.get() == OK_TEXT, dlg.v_status.get())
dlg.v_status.set(NEIN_TEXT)
dlg._status_gewaehlt()
pruefe("D2 '✗ nicht ok' waehlen nimmt die Flammen weg", dlg.v_flammen.get() == "0", dlg.v_flammen.get())
dlg.v_status.set(OK_TEXT)
dlg._status_gewaehlt()
dlg.v_flammen.set("0")
dlg._flammen_gewaehlt()
pruefe("D3 '✓ ok' mit 0 Flammen bleibt '✓ ok'", dlg.v_status.get() == OK_TEXT and dlg.v_flammen.get() == "0")
# Uebernehmen wendet die Regel auch dann an, wenn die Felder ohne Auswahl-Ereignis
# zusammenkamen (etwa per Tastatur).
dlg = fenster(d.MatheTalk(rolle="gehalten", thema="Kreise"), OFFEN_TEXT, 3)
dlg._uebernehmen()
pruefe("D4 Uebernehmen: 'noch nicht bewertet' mit 3 Flammen wird '✓ ok' mit 3",
       dlg.result["status"] == "erledigt" and dlg.result["flammen"] == 3, dlg.result)
dlg = fenster(d.MatheTalk(rolle="zugehoert"), NEIN_TEXT, 2)
dlg._uebernehmen()
pruefe("D5 Uebernehmen: '✗ nicht ok' mit Flammen speichert keine Flammen",
       dlg.result["status"] == "nicht_erledigt" and dlg.result["flammen"] == 0, dlg.result)

# --- E) das echte Fenster ----------------------------------------------------
try:
    import tkinter as tk
    from tkinter import ttk
    wurzel = tk.Tk()
    bildschirm = True
except Exception:
    bildschirm = False
if bildschirm:
    wurzel.withdraw()
    echt = mod.TalkDialog(wurzel, d.MatheTalk(rolle="zugehoert"), "Anna Probe")
    echt.update()
    boxen = {str(w.cget("textvariable")): w for w in echt.winfo_children() if isinstance(w, ttk.Combobox)}
    cb_flammen, cb_status = boxen.get(str(echt.v_flammen)), boxen.get(str(echt.v_status))
    pruefe("E1 das Fenster hat je eine Auswahl fuer Status und Flammen", cb_flammen is not None and cb_status is not None, boxen)
    echt.v_flammen.set("1")
    cb_flammen.event_generate("<<ComboboxSelected>>")
    pruefe("E2 Flamme im echten Fenster gewaehlt -> '✓ ok'", echt.v_status.get() == OK_TEXT, echt.v_status.get())
    echt.v_status.set(OFFEN_TEXT)
    cb_status.event_generate("<<ComboboxSelected>>")
    pruefe("E3 zurueck auf 'noch nicht bewertet' -> 0 Flammen", echt.v_flammen.get() == "0", echt.v_flammen.get())
    echt.destroy()
    wurzel.destroy()
else:
    print("--  Oberflaechen-Pruefungen uebersprungen (kein Bildschirm)")

print(f"\n{ok} Prüfungen bestanden.")
