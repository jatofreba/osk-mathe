"""Prueft die Sammel-Umbenennung ohne echte Oberflaeche."""
import importlib.util
import os
import sys

from pfade import WERKZEUG  # noqa: E402
QUELLE = os.path.join(WERKZEUG, "arbeitsstaende_app.py")
spec = importlib.util.spec_from_file_location("mbapp", QUELLE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class Attrappe:
    def __init__(self, wert=""):
        self._w = wert; self.text = ""; self.werte = []; self.state = ""
    def get(self): return self._w
    def set(self, w): self._w = w
    def config(self, text=None, values=None, state=None, **kw):
        if text is not None: self.text = text
        if values is not None: self.werte = list(values)
        if state is not None: self.state = state
    def current(self, i): self._w = self.werte[i] if self.werte else ""
    # Listbox-Ersatz
    def delete(self, *a): self.eintraege = []
    def insert(self, _pos, text): getattr(self, 'eintraege', None) or setattr(self, 'eintraege', []); self.eintraege.append(text)
    def curselection(self): return getattr(self, '_sel', ())

def mach(konten, namen_zu_alias=None):
    d = mod.AliasUmbenennenDialog.__new__(mod.AliasUmbenennenDialog)
    d._konten = sorted(konten, key=lambda k: (k.get("username") or "").lower())
    d._namen_zu_alias = namen_zu_alias or {}
    d._vorgemerkt = []
    d.auswahl = Attrappe(); d.neu_var = Attrappe(); d.hinweis = Attrappe()
    d.box = Attrappe(); d.liste = Attrappe(); d.liste.eintraege = []
    d.ausfuehren_btn = Attrappe()
    d.destroy = lambda: None
    d.result = None
    d._auswahl_neu_aufbauen()
    return d

konten = [{"id": 1, "username": "be.ja"},
          {"id": 2, "username": "ma.ba"},
          {"id": 3, "username": "fi.ko"}]

# --- 1: mehrere nacheinander vormerken ---
d = mach(konten)
d.auswahl.set("be.ja"); d.neu_var.set("ben.ja"); d._vormerken()
d.auswahl.set("ma.ba"); d.neu_var.set("mara.ba"); d._vormerken()
assert len(d._vorgemerkt) == 2, d._vorgemerkt
d._ausfuehren()
assert d.result and len(d.result) == 2, d.result
assert [(k["id"], n) for k, n in d.result] == [(1, "ben.ja"), (2, "mara.ba")], d.result
print("T1 (mehrere Umbenennungen vormerken und gemeinsam ausfuehren) OK")

# --- 2: vorgemerktes Konto verschwindet aus der Auswahl ---
d = mach(konten)
d.auswahl.set("be.ja"); d.neu_var.set("ben.ja"); d._vormerken()
assert "be.ja" not in d._nach_anzeige, d._nach_anzeige.keys()
assert len(d._nach_anzeige) == 2, d._nach_anzeige.keys()
print("T2 (bereits vorgemerktes Konto ist nicht mehr waehlbar) OK")

# --- 3: freigewordener Name darf weiterverwendet werden ---
d = mach(konten)
d.auswahl.set("be.ja"); d.neu_var.set("neu.x"); d._vormerken()
d.auswahl.set("ma.ba"); d.neu_var.set("be.ja"); d._vormerken()   # be.ja ist frei geworden
assert len(d._vorgemerkt) == 2 and d.hinweis.text == "", d.hinweis.text
print("T3 (durch Umbenennung frei gewordener Name ist wieder nutzbar) OK")

# --- 4: Kollision mit noch bestehendem Konto wird abgefangen ---
d = mach(konten)
d.auswahl.set("be.ja"); d.neu_var.set("fi.ko"); d._vormerken()
assert not d._vorgemerkt and "vergeben" in d.hinweis.text, d.hinweis.text
print("T4 (Kollision mit bestehendem Konto wird abgefangen) OK")

# --- 5: zwei Vormerkungen duerfen nicht denselben neuen Namen bekommen ---
d = mach(konten)
d.auswahl.set("be.ja"); d.neu_var.set("gleich.x"); d._vormerken()
d.auswahl.set("ma.ba"); d.neu_var.set("gleich.x"); d._vormerken()
assert len(d._vorgemerkt) == 1 and "vorgemerkt" in d.hinweis.text, d.hinweis.text
print("T5 (doppelter Ziel-Alias wird abgefangen) OK")

# --- 6: Entfernen gibt das Konto wieder frei ---
d = mach(konten)
d.auswahl.set("be.ja"); d.neu_var.set("ben.ja"); d._vormerken()
d.liste._sel = (0,)
d._entfernen()
assert not d._vorgemerkt and "be.ja" in d._nach_anzeige
print("T6 (Entfernen macht das Konto wieder waehlbar) OK")

# --- 7: ohne Vormerkung passiert nichts ---
d = mach(konten)
d._ausfuehren()
assert d.result is None and "vorgemerkt" in d.hinweis.text
print("T7 (Ausfuehren ohne Vormerkung wird abgefangen) OK")

# --- 8: Klarname wird in der Auswahl angezeigt ---
d = mach(konten, {"be.ja": "Ben Jansen"})
assert any("Ben Jansen" in a for a in d._nach_anzeige), d._nach_anzeige.keys()
print("T8 (lokaler Klarname erscheint in der Auswahl) OK")

# --- 9: Ablauf verarbeitet eine LISTE, nicht mehr ein einzelnes Paar ---
quelle = open(QUELLE, encoding="utf-8").read()
ablauf = quelle.split("def alias_umbenennen")[1].split("\n    # ---")[0]
assert "auftraege = dlg.result" in ablauf, "T9 FAIL: Ergebnis wird nicht als Liste verarbeitet"
assert "for konto, neu in auftraege:" in ablauf, "T9 FAIL: keine Schleife ueber die Auftraege"
assert "fehler.append" in ablauf, "T9 FAIL: Fehler einzelner Konten werden nicht gesammelt"
assert "continue" in ablauf, "T9 FAIL: ein Fehler darf die uebrigen nicht abbrechen"
print("T9 (Ablauf arbeitet die Liste ab und bricht bei Einzelfehlern nicht ab) OK")

print("ALL TESTS PASSED")
