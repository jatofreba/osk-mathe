"""Prueft das Eintippen der "Sonstigen Deadline".

WICHTIG gegenueber dem ersten Anlauf: Tk stellt <<TreeviewSelect>> NICHT sofort
zu, sondern ueber die Ereignisschleife. Die Attrappe hier legt das Ereignis
deshalb in eine Warteschlange, die erst spaeter abgearbeitet wird -- genau das
liess die erste Korrektur (eine Sperr-Variable um selection_set herum) ins Leere
laufen. Ein Test, der den Handler synchron aufruft, haette den Fehler nicht
gezeigt.
"""
import importlib.util
import os
import sys
from datetime import date

from pfade import WERKZEUG  # noqa: E402
QUELLE = os.path.join(WERKZEUG, "arbeitsstaende_app.py")
spec = importlib.util.spec_from_file_location("nbapp", QUELLE)
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


class Var:
    def __init__(self, wert=""):
        self._w = wert
    def get(self):
        return self._w
    def set(self, w):
        self._w = w


class Liste:
    """Treeview-Ersatz mit VERZOEGERTER Ereigniszustellung."""
    def __init__(self, app):
        self.app = app
        self._sel = ("Ben Jansen",)
    def selection(self):
        return self._sel
    def selection_set(self, was):
        self._sel = (was,) if isinstance(was, str) else tuple(was)
        self.app._warteschlange.append(self.app._auswahl_geaendert)
    def delete(self, *a):
        pass
    def get_children(self):
        return ["Ben Jansen", "Mara Bauer"]
    def insert(self, *a, **kw):
        pass


def mach_app(zweite=False):
    app = mod.App.__new__(mod.App)
    app._laden_sperre = False
    app._liste_timer = None
    app._warteschlange = []
    app._detail_aufrufe = []
    ben = mod.Student(vorname="Ben", nachname="Jansen")
    mara = mod.Student(vorname="Mara", nachname="Bauer")
    app.aktueller_schueler = ben
    app.az = type("AZ", (), {"students": [ben, mara]})()
    app.f_kursung, app.f_jahrgang = Var(""), Var("")
    app.f_hjnote, app.f_alias = Var(""), Var("")
    app.f_deadline, app.f_deadline_bem = Var(""), Var("")
    app.deadline_hinweis = type("L", (), {"config": lambda self, **kw: None})()
    app.liste = Liste(app)
    app._markiere_ungespeichert = lambda: None
    # Seit dem Bedienbarkeits-Durchgang zieht _auswahl_geaendert die Knopf-Zustaende
    # nach; hier nicht der Pruefgegenstand, deshalb stillgelegt.
    app._knoepfe_aktualisieren = lambda *a: None
    # after()/after_cancel() brauchen ein echtes Fenster - hier nur mitzaehlen.
    app._entprellt = []
    app.after = lambda ms, fn: app._entprellt.append(fn) or len(app._entprellt)
    app.after_cancel = lambda _id: None

    def detail():
        # Das echte _detail_anzeigen() schreibt die Kopf-Felder aus dem Modell zurueck.
        s = app.aktueller_schueler
        app._detail_aufrufe.append(s.voller_name if s else None)
        app.f_deadline.set(mod.fmt_datum(s.sonstige_deadline) if s else "")
    app._detail_anzeigen = detail
    return app, ben, mara


def ereignisse_abarbeiten(app):
    """Das, was Tk spaeter tut: die gesammelten Ereignisse zustellen."""
    while app._warteschlange:
        app._warteschlange.pop(0)()


def liste_baut_neu_auf(app, name="Ben Jansen"):
    """Was _liste_aktualisieren() am Ende tut: die Markierung wiederherstellen.

    Der echte Neuaufbau braucht ein halbes Fenster an Attrappen; entscheidend fuer
    diesen Fehler ist allein dieser letzte Schritt.
    """
    app.liste.selection_set(name)
    ereignisse_abarbeiten(app)


# ===========================================================================
# A) Tippen: das Feld darf zwischendurch nie geleert werden
# ===========================================================================
app, ben, mara = mach_app()
verlauf = []
for zeichen in "1", "16", "16.", "16.0", "16.09", "16.09.", "16.09.2", "16.09.20", "16.09.2026":
    app.f_deadline.set(zeichen)
    app._kopf_uebernehmen()
    # Zwischendurch baut die Liste einmal neu auf (die Entprellung feuert beim
    # langsamen Tippen mitten hinein) und danach laeuft die Ereignisschleife.
    liste_baut_neu_auf(app)
    verlauf.append(app.f_deadline.get())

pruefe("A1 kein Zeichen geht beim Tippen verloren",
       verlauf == ["1", "16", "16.", "16.0", "16.09", "16.09.", "16.09.2", "16.09.20", "16.09.2026"],
       verlauf)
pruefe("A1b insbesondere ab der dritten Stelle nicht (dort nullte es)",
       verlauf[2] == "16." and verlauf[3] == "16.0", verlauf[:4])
pruefe("A2 das fertige Datum kommt im Modell an",
       ben.sonstige_deadline == date(2026, 9, 16), ben.sonstige_deadline)
pruefe("A3 dieselbe Person wird dabei nie neu geladen",
       app._detail_aufrufe == [], app._detail_aufrufe)

# --- leeren loescht die Deadline ---------------------------------------
app.f_deadline.set("")
app._kopf_uebernehmen()
liste_baut_neu_auf(app)
pruefe("A4 ein geleertes Feld loescht die Deadline",
       ben.sonstige_deadline is None and app.f_deadline.get() == "")

# --- der Anlass kommt an ------------------------------------------------
app.f_deadline_bem.set("Referat abgeben")
app._kopf_uebernehmen()
pruefe("A5 der Anlass wird uebernommen",
       ben.sonstige_deadline_bemerkung == "Referat abgeben")

# --- Jahrgang und Alias hatten dasselbe Problem -------------------------
app, ben, _ = mach_app()
app.f_jahrgang.set("9")
app._kopf_uebernehmen(); liste_baut_neu_auf(app)
pruefe("A6 auch bei Jahrgang/Alias wird nichts zurueckgeschrieben",
       app._detail_aufrufe == [] and ben.jahrgangsstufe == 9, app._detail_aufrufe)


# ===========================================================================
# B) Ein echter Personenwechsel laedt weiterhin neu
# ===========================================================================
app, ben, mara = mach_app()
app.liste.selection_set("Mara Bauer")
ereignisse_abarbeiten(app)
pruefe("B1 Klick auf eine andere Person laedt die Detailansicht",
       app._detail_aufrufe == ["Mara Bauer"] and app.aktueller_schueler is mara,
       app._detail_aufrufe)

app.liste.selection_set("Ben Jansen")
ereignisse_abarbeiten(app)
pruefe("B1b und zurueck ebenso",
       app._detail_aufrufe == ["Mara Bauer", "Ben Jansen"] and app.aktueller_schueler is ben)

app.liste.selection_set("Ben Jansen")
ereignisse_abarbeiten(app)
pruefe("B2 dieselbe Person nochmal markiert laedt nicht erneut",
       len(app._detail_aufrufe) == 2, app._detail_aufrufe)

# Frisch geladene Datei: vorher niemand ausgewaehlt
app, ben, _ = mach_app()
app.aktueller_schueler = None
app.liste.selection_set("Ben Jansen")
ereignisse_abarbeiten(app)
pruefe("B3 nach dem Laden einer Datei wird die erste Auswahl angezeigt",
       app._detail_aufrufe == ["Ben Jansen"], app._detail_aufrufe)


# ===========================================================================
# C) Quelltext: die wirkungslose Sperre ist weg, der Grund steht dabei
# ===========================================================================
pruefe("C1 keine Sperr-Variable mehr (sie griff wegen der Ereignisschleife nie)",
       "_markierung_sperre" not in quelle)
# Es gibt zwei _auswahl_geaendert im Modul - gemeint ist das der Hauptanwendung.
app_teil = quelle.split("class App(")[1]
handler = app_teil.split("def _auswahl_geaendert")[1].split("def schueler_hinzufuegen")[0]
pruefe("C2 stattdessen der Vergleich mit der aktuellen Person",
       "neuer is self.aktueller_schueler" in handler, handler)
pruefe("C3 und der Grund ist dokumentiert, damit niemand die Sperre zurueckbaut",
       "verzoegert" in handler.lower(), handler)
pruefe("C4 die Entprellung bleibt (gegen das Flackern)",
       "after_cancel(self._liste_timer)" in quelle)
# Die Annahme des Tests absichern: der Neuaufbau stellt die Markierung wirklich wieder her.
neuaufbau = quelle.split("def _liste_aktualisieren")[1].split("def _auswahl_geaendert")[0]
pruefe("C5 _liste_aktualisieren stellt die Markierung wieder her (Annahme des Tests)",
       "self.liste.selection_set(neue_markierung)" in neuaufbau, neuaufbau[-300:])

print("\n%d Pruefungen bestanden." % ok)
