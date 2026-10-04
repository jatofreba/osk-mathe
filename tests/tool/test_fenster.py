"""Prueft das Baustein-Formular (ohne "Bausteinarbeit", immer im Bild), das Startfenster,
die Teilung Liste/Details und die Standardsortierung nach der naechsten Frist."""
import importlib.util
import json
import os
import sys
from datetime import date, timedelta

from pfade import WERKZEUG  # noqa: E402
import arbeitsstaende_data as D  # noqa: E402

QUELLE = os.path.join(WERKZEUG, "arbeitsstaende_app.py")
spec = importlib.util.spec_from_file_location("fensterapp", QUELLE)
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)
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


# ===========================================================================
# A) "Bausteinarbeit" geht verlustfrei in der Bemerkung auf
# ===========================================================================
b = D.Baustein(name="Kreise", bausteinarbeit="Hat unwillig begonnen", bemerkung="Teil 2 ueben")
pruefe("A1 eigener Baustein: angehaengt, Feld leer",
       D.bausteinarbeit_in_bemerkung(b) and b.bemerkung == "Teil 2 ueben\nBausteinarbeit: Hat unwillig begonnen"
       and b.bausteinarbeit == "", b)
pruefe("A2 ein zweites Mal aendert nichts", not D.bausteinarbeit_in_bemerkung(b)
       and b.bemerkung.count("Bausteinarbeit") == 1)
leer = D.Baustein(name="Terme", bausteinarbeit="KT1")
D.bausteinarbeit_in_bemerkung(leer)
pruefe("A3 ohne Bemerkung: nur die neue Zeile", leer.bemerkung == "Bausteinarbeit: KT1", leer)
app_zeile = D.Baustein(name="Baustein Kreise", bausteinarbeit="x", bemerkung=D.LT_MARKER + " 13 von 27")
pruefe("A4 App-Zeilen bleiben unberuehrt (ihre Bemerkung schreibt jeder Abruf neu)",
       not D.bausteinarbeit_in_bemerkung(app_zeile) and app_zeile.bausteinarbeit == "x")
az = D.Arbeitsstaende()
az.aus_dict({"format": D.JSON_FORMAT, "version": 1, "personen": [
    {"vorname": "A", "nachname": "B", "bausteine": [
        {"name": "Kreise", "bausteinarbeit": "Selten im FB", "bemerkung": "Basis sicher"}]}]})
b2 = az.students[0].bausteine[0]
pruefe("A5 beim Laden umgezogen", b2.bemerkung == "Basis sicher\nBausteinarbeit: Selten im FB" and not b2.bausteinarbeit, b2)
az2 = D.Arbeitsstaende()
az2.aus_dict(json.loads(json.dumps(az.als_dict(), ensure_ascii=False)))
pruefe("A6 und beim naechsten Laden nicht doppelt", az2.students[0].bausteine[0].bemerkung == b2.bemerkung)

# ===========================================================================
# B) Formular-Aufbau (Quelltext)
# ===========================================================================
dialog = quelle.split("class BausteinDialog")[1].split("\nclass ")[0]
felder = dialog.split("felder = [")[1].split("\n        ]")[0]
namen = [z.split('"')[3] for z in felder.splitlines() if z.strip().startswith('("')]
pruefe("B1 keine Zeile 'Bausteinarbeit' mehr", "bausteinarbeit" not in namen, namen)
pruefe("B2 die Bemerkung steht oben (wo frueher 'Bausteinarbeit' stand), Halbjahr unter dem Status",
       namen[:4] == ["name", "status", "halbjahr", "bemerkung"], namen)
pruefe("B3 die Bemerkungen zur LZK bleiben", "lzk_bem_1" in namen and "lzk_bem_2" in namen, namen)
pruefe("B4 die Knoepfe stehen ausserhalb des scrollenden Formulars",
       'leiste.pack(side="bottom", fill="x")' in dialog and "self._leinwand.create_window" in dialog)

# ===========================================================================
# C) Standardsortierung: die naechste Frist zuerst
# ===========================================================================
heute = date.today()


class AZ:
    def __init__(self, fristen):
        self.fristen = fristen

    def deadline_info(self, st, h=None):
        return self.fristen[st.nachname], "LZK"


fristen = {"a": heute + timedelta(days=10), "b": heute - timedelta(days=1), "c": heute + timedelta(days=1),
           "d": heute, "e": "", "f": "Frist vereinbaren!", "g": heute - timedelta(days=30)}
app = A.App.__new__(A.App)
app.az = AZ(fristen)
leute = [D.Student(vorname="X", nachname=n) for n in fristen]
reihe = [s.nachname for s in sorted(leute, key=lambda s: app._spalten_key(s, "aktuell"))]
pruefe("C1 heute zuerst, dann nach Abstand (Kommendes vor Ueberfaelligem), Hinweis, ohne Frist zuletzt",
       reihe == ["d", "c", "b", "a", "g", "f", "e"], reihe)
pruefe("C2 das ist der Standard beim Start", "self._liste_sortierung = self.STANDARD_SORTIERUNG" in quelle
       and A.App.STANDARD_SORTIERUNG == "aktuell")
app._liste_aktualisieren = lambda: None
app._liste_sortierung, app._liste_umgekehrt = "aktuell", False
for spalte in ("deadline", "deadline", "deadline"):
    app._liste_sortieren(spalte)
pruefe("C3 der dritte Klick auf einen Spaltenkopf fuehrt zurueck zum Standard",
       app._liste_sortierung == "aktuell" and not app._liste_umgekehrt, app._liste_sortierung)

# ===========================================================================
# D) Ins Bild setzen (Rechnung, ohne Bildschirm)
# ===========================================================================
class Attrappe:
    def __init__(self, w, h, sw=1440, sh=900, x=0, y=0, sichtbar=True):
        self.w, self.h, self.sw, self.sh, self.x, self.y, self.sichtbar = w, h, sw, sh, x, y, sichtbar
        self.geo = None
    def update_idletasks(self): pass
    def winfo_reqwidth(self): return self.w
    def winfo_reqheight(self): return self.h
    def winfo_width(self): return self.w
    def winfo_height(self): return self.h
    def winfo_screenwidth(self): return self.sw
    def winfo_screenheight(self): return self.sh
    def winfo_rootx(self): return self.x
    def winfo_rooty(self): return self.y
    def winfo_ismapped(self): return self.sichtbar
    def geometry(self, g): self.geo = g


dlg, eltern = Attrappe(600, 700), Attrappe(1400, 800, y=300)
x, y = A.fenster_ins_bild(dlg, eltern)
pruefe("D1 ein hoher Dialog bleibt ueber dem Dock (Unterkante im Bild)",
       y + 700 <= 900 - A.FENSTER_RAND_UNTEN or y == A.FENSTER_RAND_OBEN, (x, y))
x, y = A.fenster_ins_bild(Attrappe(400, 300), Attrappe(1400, 800, y=60))
pruefe("D2 ein kleiner Dialog sitzt mittig ueber dem Hauptfenster", x == 500 and 60 <= y <= 400, (x, y))
x, y = A.fenster_ins_bild(Attrappe(600, 2000), Attrappe(1400, 800))
pruefe("D3 zu hoch fuer jeden Bildschirm: oben anliegend, nie darueber hinaus", y == A.FENSTER_RAND_OBEN, (x, y))

# ===========================================================================
# E) Die echten Fenster (nur mit Bildschirm - in der CI ohne Display uebersprungen)
# ===========================================================================
try:
    import tkinter as tk
    probe = tk.Tk()
    probe.destroy()
    bildschirm = True
except Exception:
    bildschirm = False
if bildschirm:
    A.App._zuletzt_oeffnen = lambda self: None
    fenster = A.App()
    fenster.update_idletasks()
    sw, sh = fenster.winfo_screenwidth(), fenster.winfo_screenheight()
    breite, hoehe = (int(v) for v in fenster.geometry().split("+")[0].split("x"))
    pruefe("E1 das Startfenster passt auf den Bildschirm",
           breite <= sw and hoehe <= sh - A.FENSTER_RAND_OBEN - A.FENSTER_RAND_UNTEN + 1, (breite, hoehe, sw, sh))
    # Wie auf einem kleineren Mac-Bildschirm: das Fenster muss trotzdem ganz hineinpassen
    # (das alte feste 1450x700 ragte dort hinaus - auf diesem Rechner faellt das nicht auf).
    # Ein nie gezeigtes Fenster meldet "1x1" - deshalb die Groesse mitschreiben, die der
    # Start anfordert.
    echt_b, echt_h, echt_geo = A.App.winfo_screenwidth, A.App.winfo_screenheight, A.App.geometry
    angefordert = []

    def geo(self, g=None):
        if g:
            angefordert.append(g)
        return echt_geo(self, g)
    A.App.winfo_screenwidth, A.App.winfo_screenheight, A.App.geometry = (lambda self: 1280), (lambda self: 800), geo
    try:
        mac = A.App()
        mac.withdraw()
        mac.destroy()
    finally:
        A.App.winfo_screenwidth, A.App.winfo_screenheight, A.App.geometry = echt_b, echt_h, echt_geo
    groesse, mx, my = angefordert[0].split("+")[0], 0, 0
    if "+" in angefordert[0]:
        mx, my = (int(v) for v in angefordert[0].split("+")[1:3])
    mb, mh = (int(v) for v in groesse.split("x"))
    pruefe("E1b auch auf 1280x800 ganz im Bild (unter Menueleiste, ueber dem Dock)",
           mx + mb <= 1280 and my + mh <= 800 - A.FENSTER_RAND_UNTEN + 30 and my >= 0, (mb, mh, mx, my))
    fenster.update()
    fenster._paned.sashpos(0, int(fenster._paned.winfo_width() * 0.1))   # erst irgendwohin
    fenster.update()
    fenster._teilung_setzen()
    fenster.update()
    teil = fenster._paned.sashpos(0) / max(1, fenster._paned.winfo_width())
    pruefe("E2 die Teilung setzt die Liste auf rund 40 % der Breite", 0.35 <= teil <= 0.45, teil)
    pruefe("E2b und das geschieht beim Start von selbst", "self.after(150, self._teilung_setzen)" in quelle)
    fenster.withdraw()

    alt = D.Baustein(name="Kreise", status="In Bearbeitung", halbjahr="2627_1",
                     bausteinarbeit="Sehr selten im FB", bemerkung="Basis sicher",
                     lzk_bem_1="nur Teil 1")
    bdlg = A.BausteinDialog(fenster, alt)
    fenster.update()
    beschriftungen = [w.cget("text") for w in bdlg._form.winfo_children() if isinstance(w, tk.ttk.Label)]
    pruefe("E3 im Formular keine Zeile 'Bausteinarbeit', die LZK-Bemerkungen sind da",
           "Bausteinarbeit" not in beschriftungen and "Bemerkung zur LZK 1" in beschriftungen, beschriftungen)
    pruefe("E4 die Bemerkung zeigt den Text der Bausteinarbeit mit",
           bdlg.vars["bemerkung"].get("1.0", "end").strip() == "Basis sicher\nBausteinarbeit: Sehr selten im FB")
    pruefe("E5 die Knoepfe haengen am Dialog, nicht am scrollenden Formular",
           bdlg._leiste.master is bdlg and bdlg._leiste.winfo_manager() == "pack")
    unterkante = bdlg.winfo_y() + bdlg.winfo_reqheight()
    pruefe("E6 der Dialog ragt nicht unten aus dem Bildschirm", unterkante <= sh, (unterkante, sh))
    bdlg._uebernehmen()
    pruefe("E7 gespeichert: Bemerkung mit Bausteinarbeit, Feld leer, LZK-Bemerkung erhalten",
           bdlg.result.bemerkung == "Basis sicher\nBausteinarbeit: Sehr selten im FB"
           and bdlg.result.bausteinarbeit == "" and bdlg.result.lzk_bem_1 == "nur Teil 1", bdlg.result)

    # Kleiner Bildschirm: das Formular scrollt, die Knoepfe bleiben sichtbar
    klein = A.BausteinDialog(fenster, D.Baustein(name="Terme"))
    klein.winfo_screenheight = lambda: 520
    klein._groesse_anpassen(fenster)
    klein.update_idletasks()
    sicht = int(klein._leinwand.cget("height"))
    pruefe("E8 kleiner Bildschirm: sichtbarer Teil passt, Rollbalken da",
           sicht <= 520 - A.FENSTER_RAND_OBEN - A.FENSTER_RAND_UNTEN and klein._rollbalken.winfo_manager() == "pack",
           (sicht, klein._rollbalken.winfo_manager()))
    klein.destroy()

    app_b = D.Baustein(name="Baustein Kreise", bausteinarbeit="aus der App", bemerkung=D.LT_MARKER + " 13 von 27")
    adlg = A.BausteinDialog(fenster, app_b)
    adlg._uebernehmen()
    pruefe("E9 App-Zeile: Bausteinarbeit bleibt unveraendert erhalten", adlg.result.bausteinarbeit == "aus der App"
           and "Bausteinarbeit" not in adlg.result.bemerkung, adlg.result)
    fenster.destroy()
else:
    print("--  Fenster-Pruefungen uebersprungen (kein Bildschirm)")

print(f"\n{ok} Prüfungen bestanden.")
