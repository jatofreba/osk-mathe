"""Prueft die vier Bedienbarkeits-Korrekturen am Arbeitsstaende-Tool."""
import importlib.util
import os
import sys

from pfade import WERKZEUG  # noqa: E402
QUELLE = os.path.join(WERKZEUG, "arbeitsstaende_app.py")
spec = importlib.util.spec_from_file_location("ncapp", QUELLE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
quelle = open(QUELLE, encoding="utf-8").read()

ok = 0


def pruefe(name, bedingung, extra=""):
    global ok
    if not bedingung:
        print(("FAIL: " + name + (("\n      " + str(extra)) if extra else ""))
              .encode("ascii", "replace").decode("ascii"))
        sys.exit(1)
    ok += 1
    print("OK  " + name)


def block(kopf, ende="\n    def "):
    a = quelle.index(kopf)
    return quelle[a:quelle.index(ende, a + len(kopf))]


# ===========================================================================
# 1) Tastenkuerzel: richtig beschriftet und tatsaechlich belegt
# ===========================================================================
menue = block("def _menu_aufbauen", "\n    def _layout_aufbauen")
pruefe("T1 die Beschriftung richtet sich nach dem System, statt fest 'Cmd' zu sein",
       'strg = "Cmd" if sys.platform == "darwin" else "Strg"' in menue, menue[:400])
pruefe("T1b und wird fuer alle drei Eintraege benutzt",
       menue.count('accelerator=f"{strg}+') == 3, menue)
pruefe("T1c nirgends mehr ein fest verdrahtetes Cmd im Menue",
       'accelerator="Cmd' not in quelle)
pruefe("T2 Strg+N ist jetzt auch wirklich belegt (stand nur im Menue)",
       '<Control-n>' in menue and '<Command-n>' in menue, menue[-400:])
pruefe("T2b Speichern und Oeffnen weiterhin",
       all(t in menue for t in ('<Control-s>', '<Control-o>', '<Command-s>', '<Command-o>')))
pruefe("T3 auch der Mehrfachauswahl-Hinweis nennt die richtige Taste",
       'MEHRFACH_TASTE = "Cmd" if sys.platform == "darwin" else "Strg"' in quelle
       and "Cmd-Klick" not in quelle, "")
pruefe("T3b und steht nur noch an einer Stelle",
       quelle.count("MEHRFACH_HINWEIS = ") == 1 and quelle.count("MEHRFACH_HINWEIS)") == 2)
if sys.platform != "darwin":
    pruefe("T4 auf diesem System heisst die Taste Strg", mod.MEHRFACH_TASTE == "Strg")
    pruefe("T4b und der Hinweistext sagt das auch", "Strg-Klick" in mod.MEHRFACH_HINWEIS)


# ===========================================================================
# 2) Routine-Meldungen: Statusleiste und Berichtsfenster statt Popup
# ===========================================================================
pruefe("S1 es gibt einen Weg fuer kurze Rueckmeldungen", "def _melde(self, text: str)" in quelle)
pruefe("S1b und einen fuer lange Berichte", "def _bericht(self, titel: str, text: str)" in quelle)
pruefe("S2 das Berichtsfenster ist scrollbar und nicht modal",
       "class BerichtFenster" in quelle
       and "ttk.Scrollbar" in block("class BerichtFenster", "\nclass BausteinDialog")
       and "grab_set" not in block("class BerichtFenster", "\nclass BausteinDialog"),
       "")
pruefe("S2b man kann den Text markieren, aber nicht versehentlich tippen",
       'self.feld.config(state="disabled")' in quelle)
pruefe("S2c und ihn kopieren", "def _kopieren" in quelle and "clipboard_append" in quelle)

for titel in ("Ergebnisse abrufen", "LZK-Termine senden", "Aliasse ergänzen",
              "Aliasse exportieren", "Aliasse umbenennen"):
    pruefe("S3 Bericht statt Textwand: " + titel,
           ('self._bericht("%s"' % titel) in quelle, "")

pruefe("S4 die gespeicherten Einstellungen melden sich nur noch unten",
       'self._melde("Einstellungen der Lerntheken-App gespeichert.")' in quelle
       and 'showinfo("Einstellungen"' not in quelle, "")
pruefe("S5 Fehler bleiben modal - da muss man hinschauen",
       'messagebox.showwarning("Aliasse umbenennen", text)' in quelle)
pruefe("S6 uebrig sind nur noch Schutz-Meldungen, keine Erfolgsmeldungen",
       all(t in ("Keine Auswahl", "Nichts zu exportieren", "Aliasse",
                 "Alias umbenennen", "Ergebnisse abrufen", "LZK-Termine senden")
           for t in __import__("re").findall(r'showinfo\("([^"]+)"', quelle)),
       __import__("re").findall(r'showinfo\("([^"]+)"', quelle))


# ===========================================================================
# 3) Knoepfe ausgrauen statt hinterher meckern
# ===========================================================================
class Knopf:
    def __init__(self):
        self.state = None
    def config(self, state=None, **kw):
        if state is not None:
            self.state = state


class Auswahl:
    def __init__(self, eintraege=()):
        self.eintraege = tuple(eintraege)
    def selection(self):
        return self.eintraege


def mach_app(personen=(), bausteine=()):
    app = mod.App.__new__(mod.App)
    app.liste = Auswahl(personen)
    app.tabelle = Auswahl(bausteine)
    for name in ("btn_person_entfernen", "btn_fb_heute", "btn_fb_nachtragen",
                 "btn_baustein_neu", "btn_baustein_bearbeiten", "btn_baustein_entfernen"):
        setattr(app, name, Knopf())
    return app


app = mach_app()
app._knoepfe_aktualisieren()
pruefe("K1 ohne Auswahl sind alle Knoepfe aus",
       all(getattr(app, n).state == "disabled" for n in
           ("btn_person_entfernen", "btn_fb_heute", "btn_fb_nachtragen", "btn_baustein_neu")))
pruefe("K1b und Bearbeiten/Entfernen der Bausteine ebenfalls",
       app.btn_baustein_bearbeiten.state == "disabled"
       and app.btn_baustein_entfernen.state == "disabled")

app = mach_app(personen=("Ben Jansen",))
app._knoepfe_aktualisieren()
pruefe("K2 mit ausgewaehlter Person sind die Personen-Knoepfe an",
       all(getattr(app, n).state == "normal" for n in
           ("btn_person_entfernen", "btn_fb_heute", "btn_fb_nachtragen", "btn_baustein_neu")))
pruefe("K2b aber Bearbeiten/Entfernen erst mit markiertem Baustein",
       app.btn_baustein_bearbeiten.state == "disabled")

app = mach_app(personen=("Ben Jansen", "Mara Bauer"), bausteine=("B1",))
app._knoepfe_aktualisieren()
pruefe("K3 Mehrfachauswahl zaehlt genauso (FB-Besuch fuer mehrere)",
       app.btn_fb_heute.state == "normal")
pruefe("K3b mit markiertem Baustein sind auch dessen Knoepfe an",
       app.btn_baustein_bearbeiten.state == "normal"
       and app.btn_baustein_entfernen.state == "normal")

pruefe("K4 die Knopf-Zustaende werden bei jedem Auswahlwechsel nachgezogen",
       "self._knoepfe_aktualisieren()" in block("def _auswahl_geaendert", "\n    def schueler_hinzufuegen"))
pruefe("K4b auch wenn die Baustein-Tabelle neu gefuellt wird",
       "self._knoepfe_aktualisieren()" in block("def _detail_anzeigen", "\n    def _baustein_key"))
pruefe("K4c und wenn die Markierung beim Filtern wegfaellt",
       "self._knoepfe_aktualisieren()" in block("def _liste_aktualisieren", "\n    def _auswahl_geaendert"))
pruefe("K4d die Baustein-Tabelle meldet ihre Auswahl",
       'self.tabelle.bind("<<TreeviewSelect>>", self._knoepfe_aktualisieren)' in quelle)
pruefe("K5 beim Start werden sie einmal gesetzt",
       "self._knoepfe_aktualisieren()" in block("def _layout_aufbauen", "\n        self._letzte_quelle"))
pruefe("K6 die Schutz-Abfragen in den Methoden bleiben (Doppelklick, Tastatur)",
       quelle.count('showinfo("Keine Auswahl"') == 4, "")

print("\n%d Pruefungen bestanden." % ok)
