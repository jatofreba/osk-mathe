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
