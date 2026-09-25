"""Prueft die Logik des Umbenennen-Dialogs ohne echte Oberflaeche.

tkinter laesst sich hier nicht anzeigen, deshalb werden die Methoden an einem
Objekt ohne __init__ aufgerufen und die Widget-Zugriffe durch Attrappen ersetzt.
"""
import ast
import importlib.util
import os
import sys
import types

from pfade import WERKZEUG  # noqa: E402
QUELLE = os.path.join(WERKZEUG, "arbeitsstaende_app.py")

# --- 1: Klasse und Verdrahtung sind vorhanden ---
baum = ast.parse(open(QUELLE, encoding="utf-8").read(), QUELLE)
klassen = {n.name for n in ast.walk(baum) if isinstance(n, ast.ClassDef)}
assert "AliasUmbenennenDialog" in klassen, "T1 FAIL: Dialog-Klasse fehlt"
quelle = open(QUELLE, encoding="utf-8").read()
assert "ttk.Combobox" in quelle.split("class AliasUmbenennenDialog")[1].split("class ")[0], \
    "T1 FAIL: Dialog nutzt keine Combobox"
assert "dlg = AliasUmbenennenDialog(self, konten, namen_zu_alias)" in quelle, \
    "T1 FAIL: Methode nutzt den Dialog nicht"
assert "self.wait_window(dlg)" in quelle.split("def alias_umbenennen")[1], \
    "T1 FAIL: auf den Dialog wird nicht gewartet"
assert "simpledialog.askstring" not in quelle.split("def alias_umbenennen")[1].split("def ")[0], \
    "T1 FAIL: alte Texteingabe noch im Ablauf"
print("T1 (Dialog-Klasse mit Combobox vorhanden und eingebunden, alte Abfrage raus) OK")

# --- Dialog-Logik isoliert nachstellen ---
# Nachbarmodule (arbeitsstaende_data, osk_sync) liegen im echten App-Ordner.

spec = importlib.util.spec_from_file_location("ddapp", QUELLE)
mod = importlib.util.module_from_spec(spec)
# tkinter-Import zulassen, aber nie eine Oberflaeche erzeugen.
try:
    spec.loader.exec_module(mod)
except Exception as e:
    print("Modul konnte nicht geladen werden:", e)
    sys.exit(1)

class Attrappe:
    """Minimaler Ersatz fuer StringVar/Label."""
    def __init__(self, wert=""):
        self._w = wert
        self.text = ""
    def get(self):
        return self._w
    def set(self, w):
        self._w = w
    def config(self, text=""):
        self.text = text

class ListenAttrappe:
    """Ersatz fuer die Listbox der Vormerkungen."""
    def __init__(self):
        self.eintraege = []
        self._auswahl = ()
        self.state = ""
    def delete(self, *_a):
        self.eintraege = []
    def insert(self, _pos, text):
        self.eintraege.append(text)
    def curselection(self):
        return self._auswahl
    def config(self, **kw):
        if "state" in kw:
            self.state = kw["state"]
    def current(self, i=0):
        pass


def mach_dialog(konten, auswahl_anzeige, neu):
    d = mod.AliasUmbenennenDialog.__new__(mod.AliasUmbenennenDialog)
    d._konten = sorted(konten, key=lambda k: (k.get("username") or "").lower())
    d._namen_zu_alias = {}
    d._vorgemerkt = []
    d._nach_anzeige = {(k.get("username") or ""): k for k in d._konten}
    d.auswahl = Attrappe(auswahl_anzeige)
    d.neu_var = Attrappe(neu)
    d.hinweis = Attrappe()
    d.liste = ListenAttrappe()
    d.ausfuehren_btn = ListenAttrappe()
    d.box = ListenAttrappe()
    d.result = None
    d.destroy = lambda: None
    return d

konten = [
    {"id": 1, "username": "be.ja"},
    {"id": 2, "username": "ma.ba"},
]

# --- 2: gueltige Umbenennung wird vorgemerkt und erst beim Ausfuehren geliefert ---
d = mach_dialog(konten, "be.ja", "ben.ja")
d._vormerken()
assert d.result is None, "T2 FAIL: Vormerken darf noch kein Ergebnis liefern"
assert len(d._vorgemerkt) == 1, f"T2 FAIL: {d._vorgemerkt}"
d._ausfuehren()
assert d.result is not None, "T2 FAIL: keine Uebernahme"
konto, neu = d.result[0]
assert konto["id"] == 1 and neu == "ben.ja", f"T2 FAIL: {d.result}"
print("T2 (gueltige Umbenennung wird vorgemerkt und beim Ausfuehren geliefert) OK")

# --- 3: unveraenderter Name wird abgefangen ---
d = mach_dialog(konten, "be.ja", "be.ja")
d._vormerken()
assert not d._vorgemerkt and "unverändert" in d.hinweis.text, f"T3 FAIL: {d.hinweis.text}"
print("T3 (unveraenderter Alias wird abgefangen) OK")

# --- 4: Kollision mit einem anderen Konto wird vor dem Server abgefangen ---
d = mach_dialog(konten, "be.ja", "ma.ba")
d._vormerken()
assert not d._vorgemerkt and "vergeben" in d.hinweis.text, f"T4 FAIL: {d.hinweis.text}"
print("T4 (bereits vergebener Alias wird schon im Dialog gemeldet) OK")

# --- 5: leere Eingabe ---
d = mach_dialog(konten, "be.ja", "   ")
d._vormerken()
assert not d._vorgemerkt and "neuen Alias" in d.hinweis.text, f"T5 FAIL: {d.hinweis.text}"
print("T5 (leere Eingabe wird abgefangen) OK")

# --- 6: Gross-/Kleinschreibung wird vereinheitlicht ---
d = mach_dialog(konten, "be.ja", "  BEN.JA  ")
d._vormerken()
d._ausfuehren()
assert d.result[0][1] == "ben.ja", f"T6 FAIL: {d.result}"
print("T6 (Eingabe wird getrimmt und kleingeschrieben) OK")

# --- 7: Auswahl setzt den bisherigen Namen als Startwert ---
d = mach_dialog(konten, "ma.ba", "")
d._auswahl_geaendert()
assert d.neu_var.get() == "ma.ba", f"T7 FAIL: {d.neu_var.get()}"
print("T7 (Auswahl belegt das Eingabefeld mit dem bisherigen Alias vor) OK")

# --- 8: mehrere Umbenennungen in einem Durchgang ---
d = mach_dialog(konten, "be.ja", "ben.ja")
d._vormerken()
d.auswahl.set("ma.ba"); d._nach_anzeige = {"ma.ba": konten[1]}
d.neu_var.set("mara.ba")
d._vormerken()
d._ausfuehren()
assert [n for _k, n in d.result] == ["ben.ja", "mara.ba"], f"T8 FAIL: {d.result}"
print("T8 (mehrere Vormerkungen werden zusammen ausgefuehrt) OK")

# --- 9: ein schon vorgemerkter Name blockiert einen zweiten Eintrag ---
d = mach_dialog(konten, "be.ja", "ben.ja")
d._vormerken()
d.auswahl.set("ma.ba"); d._nach_anzeige = {"ma.ba": konten[1]}
d.neu_var.set("ben.ja")
d._vormerken()
assert len(d._vorgemerkt) == 1 and "vergeben" in d.hinweis.text, f"T9 FAIL: {d.hinweis.text}"
print("T9 (ein bereits vorgemerkter Alias wird nicht doppelt vergeben) OK")

# --- 10: ein vorgemerkter Eintrag laesst sich wieder entfernen ---
d = mach_dialog(konten, "be.ja", "ben.ja")
d._vormerken()
d.liste._auswahl = (0,)
d._entfernen()
assert d._vorgemerkt == [], f"T10 FAIL: {d._vorgemerkt}"
d._ausfuehren()
assert d.result is None and "Noch nichts vorgemerkt" in d.hinweis.text, f"T10 FAIL: {d.hinweis.text}"
print("T10 (Vormerkung entfernbar; ohne Vormerkung passiert nichts) OK")

print("ALL TESTS PASSED")
