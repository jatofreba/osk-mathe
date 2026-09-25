"""Python-Tool und Wunschtermine: eine Anfrage ist noch kein Termin. Der Abruf schreibt
sie nicht in die Datumsspalten, und weder Termin- noch Ergebnis-Abgleich fassen sie an."""
import os
import sys
from datetime import date

HIER = os.path.dirname(os.path.abspath(__file__))
from pfade import WERKZEUG  # noqa: E402
NEU = WERKZEUG
sys.modules.pop("arbeitsstaende_data", None)
import arbeitsstaende_data as D  # noqa: E402

ok = 0


def pruefe(name, bedingung, extra=""):
    global ok
    if not bedingung:
        print(("FAIL: " + name + (("\n      " + str(extra)) if extra else "")).encode("ascii", "replace").decode("ascii"))
        sys.exit(1)
    ok += 1
    print("OK  " + name)


LT = [{"key": "kreise", "title": "Kreise und Zylinder", "total": 20}]
TITEL = {"kreise": "Kreise und Zylinder"}

# 1) Abruf: eine Anfrage steht im Text, nicht in der Datumsspalte
zeilen = D.lt_lerntheke_zeilen({}, [
    {"lerntheke": "kreise", "typ": "Basis", "datum": "2026-10-01", "status": "ausstehend", "pokale": 0, "anfrage": "offen"},
    {"lerntheke": "kreise", "typ": "Aufbau", "datum": "2026-10-20", "status": "ausstehend", "pokale": 0, "anfrage": None},
], LT, "2627_1")
z = zeilen[0]
pruefe("A1 ein Wunschtermin kommt NICHT in die Datumsspalte", z["lzk_datum_1"] is None, z)
pruefe("A1b ein bestaetigter schon", z["lzk_datum_2"] == date(2026, 10, 20), z)
pruefe("A2 im Text steht, dass angefragt ist", "Basis-LZK angefragt" in z["bemerkung"], z["bemerkung"])
abgelehnt = D.lt_lerntheke_zeilen({}, [
    {"lerntheke": "kreise", "typ": "Basis", "datum": "2026-10-01", "status": "ausstehend", "pokale": 0, "anfrage": "abgelehnt"},
], LT, "2627_1")[0]
pruefe("A3 eine abgelehnte Anfrage ebenso nur im Text", abgelehnt["lzk_datum_1"] is None and "Anfrage abgelehnt" in abgelehnt["bemerkung"], abgelehnt)

# 2) Ein bestaetigter Termin hier bleibt, wenn online ein neuer Wunsch dazukommt
b = D.Baustein(name="Kreise und Zylinder", halbjahr="2627_1", bemerkung=D.LT_MARKER + " alt",
               lzk_datum_1=date(2026, 10, 1))
s = D.Student(vorname="Merle", nachname="T", alias="me.te", bausteine=[b])
D.lt_zeilen_aktualisieren(s, {}, {}, [
    {"lerntheke": "kreise", "typ": "Basis", "datum": "2026-10-08", "status": "ausstehend", "pokale": 0, "anfrage": "offen"},
], LT, "25.09.2026")
pruefe("A4 der bestaetigte Termin hier wird vom Wunsch nicht ueberschrieben", b.lzk_datum_1 == date(2026, 10, 1), b)

# 3) Termin-Abgleich (Tool -> Server): eine Anfrage wird nicht ueberschrieben
konto = {"id": 5, "lzk": [
    {"lerntheke": "kreise", "typ": "Basis", "datum": "2026-10-08", "status": "ausstehend", "pokale": 0, "anfrage": "offen"},
]}
aend, ueber = D.lt_lzk_aenderungen(s, konto, TITEL)
pruefe("T1 das Tool schickt seinen alten Termin NICHT ueber den Wunsch", not any(a["typ"] == "Basis" for a in aend), aend)
pruefe("T1b und sagt warum", any("angefragt" in u["grund"] for u in ueber), ueber)
konto2 = {"id": 5, "lzk": [
    {"lerntheke": "kreise", "typ": "Basis", "datum": "2026-10-08", "status": "ausstehend", "pokale": 0, "anfrage": None},
]}
aend2, _ = D.lt_lzk_aenderungen(s, konto2, TITEL)
pruefe("T2 ein bestaetigter Termin wird wie bisher abgeglichen", any(a["typ"] == "Basis" for a in aend2), aend2)

# 4) Ergebnis-Abgleich: eine Anfrage hat kein Ergebnis
b.lzk_ergebnis_1 = "2"
u = D.lt_lzk_ergebnis_unterschiede(s, konto, TITEL)
pruefe("E1 eine Anfrage taucht im Ergebnis-Abgleich nicht auf", u == [], u)
u2 = D.lt_lzk_ergebnis_unterschiede(s, konto2, TITEL)
pruefe("E2 ein bestaetigter Termin schon", len(u2) == 1, u2)

print("\n%d Pruefungen bestanden." % ok)
