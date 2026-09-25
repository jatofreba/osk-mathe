"""Prueft das Tippen im Kopfbereich und die mehrzeiligen Bemerkungen.

tkinter laesst sich hier nicht anzeigen, deshalb werden die Methoden an einem
Objekt ohne __init__ aufgerufen und die Widget-Zugriffe durch Attrappen ersetzt.
"""
import importlib.util
import os
import sys
from datetime import date

from pfade import WERKZEUG  # noqa: E402
QUELLE = os.path.join(WERKZEUG, "arbeitsstaende_app.py")
spec = importlib.util.spec_from_file_location("naapp", QUELLE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
quelle = open(QUELLE, encoding="utf-8").read()

ok = 0


def pruefe(name, bedingung, extra=""):
    global ok
    if not bedingung:
        print("FAIL: " + name + (("\n      " + str(extra)) if extra else ""))
        sys.exit(1)
    ok += 1
    print("OK  " + name)


# Der Abschnitt zum Eintippen der Deadline steckt jetzt in test_deadline2.py -
# dort mit verzoegerter Ereigniszustellung, wie Tk sie tatsaechlich macht.

# ===========================================================================
# Bis zur schliessenden Klammer am Zeilenanfang -- halbjahr_optionen([...]) enthaelt
# selbst eine eckige Klammer.
felder = quelle.split('felder = [')[1].split(chr(10) + '        ]')[0]
pruefe("B1 Bemerkung zur LZK 1 ist mehrzeilig",
       '("Bemerkung zur LZK 1", "lzk_bem_1", "text", 3)' in felder, felder)
pruefe("B2 Bemerkung zur LZK 2 ebenso",
       '("Bemerkung zur LZK 2", "lzk_bem_2", "text", 3)' in felder, felder)
pruefe("B3 die grosse Bemerkung bleibt so hoch wie bisher",
       '("Bemerkung", "bemerkung", "text", 10)' in felder, felder)
pruefe("B4 die Hoehe kommt aus der Feldliste",
       'height=optionen or 10' in quelle)

# Enter macht eine neue Zeile, statt den Dialog zu schliessen
class TextAttrappe:
    def __init__(self):
        self.inhalt = ""
    def insert(self, _pos, text):
        self.inhalt += text


ereignis = type("E", (), {})()
ereignis.widget = TextAttrappe()
ergebnis = mod.BausteinDialog._zeilenumbruch(ereignis)
pruefe("B5 Enter fuegt eine Zeilenschaltung ein", ereignis.widget.inhalt == "\n")
pruefe("B5b und reicht das Ereignis nicht ans Fenster weiter (kein 'Uebernehmen')",
       ergebnis == "break", ergebnis)
pruefe("B6 die Textfelder sind auch daran gebunden",
       'w.bind("<Return>", self._zeilenumbruch)' in quelle)

# Anzeige in der Tabelle
pruefe("C1 mehrzeilige Bemerkung wird fuer die Tabelle zusammengefaltet",
       mod._einzeilig("Bruchrechnen sicher\nTextaufgaben üben")
       == "Bruchrechnen sicher / Textaufgaben üben")
pruefe("C1b Leerzeilen fallen weg",
       mod._einzeilig("a\n\n  \nb") == "a / b")
pruefe("C1c einzeilig bleibt einzeilig", mod._einzeilig("nur eine Zeile") == "nur eine Zeile")
pruefe("C1d leer bleibt leer", mod._einzeilig("") == "" and mod._einzeilig(None) == "")
pruefe("C2 auch neben dem LZK-Datum",
       mod._mit_bemerkung("16.09.2026", "gut\nnoch üben") == "16.09.2026 · gut / noch üben")
pruefe("C2b ohne Datum steht nur die Bemerkung",
       mod._mit_bemerkung("", "gut\nnoch üben") == "gut / noch üben")
pruefe("C3 die Baustein-Bemerkung wird ebenfalls gefaltet",
       "_einzeilig(b.bemerkung)" in quelle)

print("\n%d Pruefungen bestanden." % ok)
