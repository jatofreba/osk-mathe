"""Pfade fuer die Tool-Tests: die Wurzel des Repos und das Python-Tool darin.

Die Tests laden das Tool genau von dort, wo es liegt (tools/arbeitsstaende/app) -
nie eine Kopie, sonst pruefen sie einen alten Stand.
"""
import os
import sys

WURZEL = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
WERKZEUG = os.path.join(WURZEL, "tools", "arbeitsstaende", "app")
if WERKZEUG not in sys.path:
    sys.path.insert(0, WERKZEUG)


def formular_zeilen(quelle):
    """Die Feldliste des Baustein-Formulars aus dem Quelltext: die feste Liste
    (`felder = [...]`) und - seit es bis zu vier LZK gibt (2026-10-31) - der Block je
    LZK (`for nr in LZK_NUMMERN: felder += [...]`), ausgeschrieben fuer jede Nummer.
    Je Feld der Quelltext des Tupels, etwa '("Bemerkung zur LZK 1", "lzk_bem_1", "text", 3)'."""
    import re
    import arbeitsstaende_data as D
    dialog = quelle.replace("\r\n", "\n").split("class BausteinDialog")[1].split("\nclass ")[0]
    kopf = dialog.split("felder = [")[1].split("\n        ]")[0]
    zeilen = [z.strip().rstrip(",") for z in kopf.splitlines() if z.strip().startswith('("')]
    marke = "for nr in LZK_NUMMERN:\n            felder += ["
    if marke in dialog:
        block = dialog.split(marke)[1].split("\n            ]")[0]
        for nr in D.LZK_NUMMERN:
            for z in block.splitlines():
                z = z.strip().rstrip(",")
                if z.startswith(('("', '(f"')):
                    zeilen.append(re.sub(r'(?<![A-Za-z])f"', '"', z).replace("{nr}", str(nr)))
    return zeilen


def formular_felder(quelle):
    """Nur die Feldnamen (zweiter Eintrag jedes Tupels) der Feldliste."""
    return [z.split('"')[3] for z in formular_zeilen(quelle)]
