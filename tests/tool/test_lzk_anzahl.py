"""Anzahl der LZK je Baustein (2026-10-31): waehlbar 0 bis 4, Vorgabe je Baustein-Name in
der Vorlage, sonst zwei. Datenmodell (LZK 3 und 4), Speichern/Laden, Fristen, Abgleich
mit OSKlar, Formular, Tabelle und Vorlage - und dass dabei nie etwas verschwindet."""
import copy
import json
import os
import sys
from datetime import date

HIER = os.path.dirname(os.path.abspath(__file__))
from pfade import WERKZEUG  # noqa: E402
for name in ("arbeitsstaende_data", "osk_sync", "arbeitsstaende_app"):
    sys.modules.pop(name, None)
import arbeitsstaende_data as D  # noqa: E402
import arbeitsstaende_app as A   # noqa: E402

ok = 0


def pruefe(name, bedingung, extra=""):
    global ok
    if not bedingung:
        print(("FAIL: " + name + (("\n      " + str(extra)) if extra else "")).encode("ascii", "replace").decode("ascii"))
        sys.exit(1)
    ok += 1
    print("OK  " + name)


HEUTE = date(2026, 10, 31)
VORLAGE = {"Kreise": 1, "Terme": 3}

# ===========================================================================
# A) Wie viele LZK ein Baustein hat
# ===========================================================================
pruefe("A1 ohne Wahl und ohne Vorlage: zwei", D.lzk_anzahl(D.Baustein(name="Prozente")) == 2)
pruefe("A2 sonst die Vorlage (Gross/klein und Leerzeichen egal)",
       D.lzk_anzahl(D.Baustein(name=" kreise "), VORLAGE) == 1
       and D.lzk_anzahl(D.Baustein(name="Terme"), VORLAGE) == 3)
pruefe("A3 eigens gewaehlt geht vor der Vorlage (auch 0)",
       D.lzk_anzahl(D.Baustein(name="Kreise", lzk_anzahl=4), VORLAGE) == 4
       and D.lzk_anzahl(D.Baustein(name="Kreise", lzk_anzahl=0), VORLAGE) == 0)
for feld, wert, erwartet in (("lzk_bem_2", "Teil 2 offen", 2), ("lzk_datum_3", HEUTE, 3),
                             ("lzk_ergebnis_2", "1", 2), ("lzk_punkte_3", "4", 3),
                             ("lzk_online_4", {"id": 9, "datum": None, "ergebnis": ""}, 4)):
    b = D.Baustein(name="Kreise", lzk_anzahl=0, **{feld: wert})
    pruefe(f"A4 ausgefuellt bleibt sichtbar: {feld} -> mindestens {erwartet}",
           D.lzk_anzahl(b, VORLAGE) == erwartet, D.lzk_anzahl(b, VORLAGE))
pruefe("A4b nur Leerzeichen in der Bemerkung zaehlen nicht",
       D.lzk_anzahl(D.Baustein(name="Kreise", lzk_bem_2="  "), VORLAGE) == 1)
app_zeile = D.Baustein(name="Kreise", lzk_anzahl=1, bemerkung=D.LT_MARKER + " 3 von 20")
pruefe("A5 Zeilen aus der App haben immer Basis und Aufbau", D.lzk_anzahl(app_zeile, VORLAGE) == 2)

# ===========================================================================
# J) Speichern und Laden
# ===========================================================================
voll = D.Baustein(name="Terme", status="In Bearbeitung", halbjahr="2627_1", lzk_anzahl=4,
                  lzk_datum_3=date(2026, 11, 20), lzk_bem_3="Teil 3\nmit Zeilenumbruch", lzk_ergebnis_3="2",
                  lzk_punkte_3="18,5", lzk_max_3="22", lzk_note_3="1-",
                  lzk_online_3={"id": 77, "datum": "2026-11-20", "ergebnis": "2"},
                  lzk_datum_4=date(2026, 12, 10), lzk_bem_4="Nachschreiben")
d = D.baustein_als_dict(voll)
pruefe("J1 LZK 3 und 4 stehen als lzk_3/lzk_4 in der Datei, die Anzahl als lzk_anzahl",
       d["lzk_3"]["datum"] == "2026-11-20" and d["lzk_3"]["punkte"] == "18,5" and d["lzk_4"]["bemerkung"] == "Nachschreiben"
       and d["lzk_anzahl"] == 4, d)
zurueck = D.baustein_aus_dict(json.loads(json.dumps(d, ensure_ascii=False)))
pruefe("J2 und kommen beim Laden vollstaendig zurueck", zurueck == voll, zurueck)
pruefe("J3 ohne eigene Wahl steht keine Anzahl in der Datei, 0 dagegen schon",
       "lzk_anzahl" not in D.baustein_als_dict(D.Baustein(name="K"))
       and D.baustein_als_dict(D.Baustein(name="K", lzk_anzahl=0))["lzk_anzahl"] == 0)
for kaputt in (7, -1, "x", True, None, "3"):
    b = D.baustein_aus_dict({"name": "K", "lzk_anzahl": kaputt})
    pruefe(f"J4 Anzahl {kaputt!r} aus der Datei", b.lzk_anzahl == (3 if kaputt == "3" else None), b.lzk_anzahl)
alt_datei = {"format": D.JSON_FORMAT, "version": 1, "vorlage_bausteine": ["Kreise"], "personen": [
    {"vorname": "A", "nachname": "B", "bausteine": [
        {"name": "Kreise", "status": "In Bearbeitung",
         "lzk_1": {"datum": "2026-10-01", "bemerkung": "x"}, "lzk_2": {"datum": "2026-11-01"}}]}]}
az = D.Arbeitsstaende()
warnungen = az.aus_dict(copy.deepcopy(alt_datei))
b = az.students[0].bausteine[0]
pruefe("J5 aeltere Datei: laedt ohne Warnung, LZK 1 und 2 wie bisher, 3/4 leer, keine Anzahl",
       not warnungen and b.lzk_datum_1 == date(2026, 10, 1) and b.lzk_datum_2 == date(2026, 11, 1)
       and not D.lzk_belegt(b, 3) and not D.lzk_belegt(b, 4) and b.lzk_anzahl is None and az.vorlage_lzk == {}, b)
neu = az.als_dict()
pruefe("J6 und wird ohne neue Schluessel wieder gespeichert (nur die Version steigt)",
       neu["version"] == D.JSON_VERSION and "vorlage_lzk_anzahl" not in neu
       and neu["personen"] == [{**alt_datei["personen"][0]}], neu["personen"])
az.vorlage_lzk = {"Kreise": 1, "Terme": 3}
az2 = D.Arbeitsstaende()
az2.aus_dict(json.loads(json.dumps(az.als_dict(), ensure_ascii=False)))
pruefe("J7 die Anzahl je Vorlage-Baustein ueberlebt Speichern und Laden", az2.vorlage_lzk == {"Kreise": 1, "Terme": 3})
az3 = D.Arbeitsstaende()
az3.aus_dict({"format": D.JSON_FORMAT, "version": 2, "vorlage_lzk_anzahl": {"A": 2, "B": 9, "C": "x", "D": 0}})
pruefe("J8 unbrauchbare oder Standard-Werte der Vorlage fallen weg, 0 bleibt", az3.vorlage_lzk == {"D": 0}, az3.vorlage_lzk)
echt, neue_datei = D.JSON_VERSION, az.als_dict()
try:
    D.JSON_VERSION = 1          # so liest eine aeltere Anwendung die neue Datei
    w = D.Arbeitsstaende().aus_dict(neue_datei)
finally:
    D.JSON_VERSION = echt
pruefe("J9 eine aeltere Anwendung warnt beim Oeffnen, dass sie Neues beim Speichern verlieren wuerde",
       any("neueren Version" in x for x in w), w)
az4 = D.Arbeitsstaende()
az4.vorlage_lzk = {"Kreise": 1}
az4.neu(["Kreise"])
pruefe("J10 eine neue Datei beginnt ohne Vorgaben", az4.vorlage_lzk == {})

# ===========================================================================
# N) Notenspiegel und Noten auch fuer LZK 3 und 4
# ===========================================================================
b = D.Baustein(name="Terme", lzk_note_3="best", lzk_punkte_4="11", lzk_max_4="22")
pruefe("N1 eine alte Note bei LZK 3 zieht in deren Bemerkung, LZK 4 rechnet aus den Punkten",
       D.lzk_note_in_bemerkung(b) == 1 and b.lzk_bem_3 == "Note: best" and b.lzk_note_3 == "" and b.lzk_note_4 == "4+", b)
b.lzk_punkte_4 = "17"
pruefe("N2 der Notenspiegel rechnet auch LZK 4 nach",
       D.noten_neu_berechnen([D.Student("A", "B", bausteine=[b])], D.Notenspiegel(), D.Notenspiegel()) == 1
       and b.lzk_note_4 == "2", b.lzk_note_4)

# ===========================================================================
# F) Fristen: nur die LZK, die der Baustein hat
# ===========================================================================
az = D.Arbeitsstaende()
az.vorlage_lzk = {"Kreise": 1}


def frist(*bausteine):
    return az.berechne_status(D.Student("A", "B", bausteine=list(bausteine)), HEUTE)


geschrieben = dict(lzk_datum_1=date(2026, 10, 10), lzk_ergebnis_1="2")
pruefe("F1 eine LZK, geschrieben: keine zweite anmahnen",
       frist(D.Baustein(name="Kreise", status="In Bearbeitung", **geschrieben)) == ("", ""))
pruefe("F1b zwei LZK (Standard), die erste geschrieben: 'Frist vereinbaren!' fuer die zweite",
       frist(D.Baustein(name="Prozente", status="In Bearbeitung", **geschrieben)) == ("Prozente", "Frist vereinbaren!"))
drei = dict(name="Terme", status="In Bearbeitung", lzk_anzahl=3, lzk_datum_1=date(2026, 9, 1), lzk_punkte_1="10",
            lzk_max_1="20", lzk_datum_2=date(2026, 10, 1), lzk_bem_2="Note: 3")
pruefe("F2 drei LZK, zwei geschrieben, die dritte ohne Termin: 'Frist vereinbaren!'",
       frist(D.Baustein(**drei)) == ("Terme", "Frist vereinbaren!"))
pruefe("F2b mit Termin fuer die dritte: dieser Termin",
       frist(D.Baustein(**drei, lzk_datum_3=date(2026, 11, 20))) == ("Terme", date(2026, 11, 20)))
umgezogen = D.Baustein(name="Prozente", status="In Bearbeitung", lzk_datum_1=date(2026, 10, 25),
                       lzk_bem_1="Note: 2", lzk_datum_2=date(2026, 11, 20))
pruefe("F3 eine geschriebene LZK (Note in die Bemerkung umgezogen) ist keine anstehende Frist mehr",
       frist(umgezogen) == ("Prozente", date(2026, 11, 20)), frist(umgezogen))
pruefe("F4 Baustein ohne LZK: keine Frist", frist(D.Baustein(name="Projekt", status="In Bearbeitung", lzk_anzahl=0)) == ("", ""))
pruefe("F5 ohne Termin und ohne Ergebnis: die LZK steht an",
       frist(D.Baustein(name="Kreise", status="In Bearbeitung", lzk_datum_1=date(2026, 11, 3))) == ("Kreise", date(2026, 11, 3)))

# ===========================================================================
# S) Abgleich mit OSKlar: LZK 3 und 4 als freie LZK ohne Typ, ueber die Verknuepfung
# ===========================================================================
terme = D.Baustein(name="Terme", status="In Bearbeitung", lzk_anzahl=3, lzk_datum_3=date(2026, 11, 20))
st = D.Student(vorname="G", nachname="E", alias="ga.em", bausteine=[terme])
auftraege, _, _ = D.lt_freie_lzk_senden(st, {"id": 7, "lzk": []}, HEUTE, {})
pruefe("S1 ein Termin bei LZK 3 wird online als freie LZK ohne Typ angelegt",
       [(x["art"], x["nummer"], x["typ"], x["titel"]) for x in auftraege] == [("anlegen", 3, "LZK", "Terme")], auftraege)
terme.lzk_online_3 = {"id": 77, "datum": "2026-11-20", "ergebnis": ""}
online = {"id": 77, "typ": "LZK", "lerntheke": None, "datum": "2026-11-20", "status": "bestanden", "pokale": 2,
          "thema": "Terme", "anfrage": None, "fach": "mathe"}
konto = {"id": 7, "lzk": [online]}
paare, offen = D.lt_freie_lzk_abgleich(st, konto)
pruefe("S2 die verknuepfte LZK gehoert zu LZK 3 (nicht ueber den Titel zu LZK 1)",
       [(p["nummer"], p["id"]) for p in paare] == [(3, 77)] and not offen, (paare, offen))
pruefe("S3 sie zaehlt als zugeordnet - keine Auswahl beim Synchronisieren",
       77 in D.verknuepfte_lzk_ids([st]) and D.lzk_zuordnungen(st, konto) == [])
uebernommen, _ = D.lt_freie_lzk_uebernehmen(st, konto)
pruefe("S4 online bewertet: das Ergebnis kommt in LZK 3", terme.lzk_ergebnis_3 == "2" and uebernommen, uebernommen)
auftraege, _, _ = D.lt_freie_lzk_senden(st, konto, HEUTE, {})
pruefe("S5 danach ist nichts mehr zu senden", [a for a in auftraege if a["art"] != "verknuepfen"] == [], auftraege)
kreise = D.Baustein(name="Kreise", status="In Bearbeitung", lzk_anzahl=1, lzk_datum_1=date(2026, 10, 1))
st2 = D.Student(vorname="H", nachname="F", alias="ha.fe", bausteine=[kreise])
aufbau = {"id": 88, "typ": "Aufbau", "lerntheke": None, "datum": "2026-11-12", "status": "ausstehend", "pokale": 0,
          "thema": "Kreise", "anfrage": None, "fach": "mathe"}
z = D.lzk_zuordnungen(st2, {"id": 8, "lzk": [aufbau]})[0]
D.lzk_zuordnen(st2, z, z["vorschlag"])
pruefe("S6 eine Aufbau-LZK in einen Baustein mit einer LZK: sie steht bei LZK 2 und ist sichtbar",
       z["vorschlag"][1] is kreise and kreise.lzk_datum_2 == date(2026, 11, 12) and D.lzk_anzahl(kreise) == 2, kreise)

# ===========================================================================
# H) Halbjahres-Zusammenfassung
# ===========================================================================
p = D.Student("A", "B", bausteine=[D.Baustein(name="Terme", halbjahr="2627_1", lzk_anzahl=3,
                                               lzk_datum_3=date(2026, 11, 20), lzk_ergebnis_3="1")])
zf = D.hj_zusammenfassung(p, "2627_1")
pruefe("H1 LZK 3 steht in der Zusammenfassung", [(l["nr"], l["ergebnis"]) for l in zf["lzk"]] == [(3, "1")]
       and "Terme (LZK 3)" in D.hj_zusammenfassung_text(p, zf), zf["lzk"])

# ===========================================================================
# O) Die echten Fenster (nur mit Bildschirm)
# ===========================================================================
try:
    import tkinter as tk
    from tkinter import ttk
    probe = tk.Tk()
    probe.destroy()
    bildschirm = True
except Exception:
    bildschirm = False


def beschriftungen(dlg):
    """Die sichtbaren Beschriftungen im Formular (ausgeblendete fehlen in grid_slaves)."""
    return {w.cget("text") for w in dlg._form.grid_slaves() if isinstance(w, ttk.Label)}


if bildschirm:
    wurzel = tk.Tk()
    wurzel.withdraw()
    meldungen = []
    echt_warn, echt_fehler = A.messagebox.showwarning, A.messagebox.showerror
    A.messagebox.showwarning = lambda titel, text, **k: meldungen.append(text)
    A.messagebox.showerror = lambda titel, text, **k: meldungen.append("FEHLER " + text)
    try:
        dlg = A.BausteinDialog(wurzel, vorlage_namen=["Kreise", "Terme"], vorlage_lzk=VORLAGE)
        wurzel.update()
        sicht = beschriftungen(dlg)
        pruefe("O1 neuer Baustein: Auswahl 'Anzahl LZK' auf 2, LZK 1 und 2 zu sehen, 3 und 4 nicht",
               dlg.vars["lzk_anzahl"].get() == "2" and "Anzahl LZK" in sicht and "LZK-Datum 2 (TT.MM.JJJJ)" in sicht
               and "Bemerkung zur LZK 2" in sicht and "LZK-Datum 3 (TT.MM.JJJJ)" not in sicht
               and "Punkte 4 (erreicht von max.)" not in sicht, sorted(sicht))
        hoehe_2 = dlg._form.winfo_reqheight()
        dlg.vars["name"].set("Kreise")
        wurzel.update()
        pruefe("O2 Name aus der Vorlage gewaehlt: die Anzahl folgt (Kreise: 1), LZK 2 verschwindet",
               dlg.vars["lzk_anzahl"].get() == "1" and "LZK-Datum 2 (TT.MM.JJJJ)" not in beschriftungen(dlg))
        pruefe("O2b das Formular wird kuerzer", dlg._form.winfo_reqheight() < hoehe_2)
        dlg.vars["lzk_anzahl"].set("3")
        wurzel.update()
        pruefe("O3 selbst 3 gewaehlt: LZK 3 erscheint, das Formular waechst mit",
               "LZK-Datum 3 (TT.MM.JJJJ)" in beschriftungen(dlg) and "Bemerkung zur LZK 3" in beschriftungen(dlg)
               and dlg._form.winfo_reqheight() > hoehe_2 and int(dlg._leinwand.cget("height")) > 0)
        dlg.vars["name"].set("Prozente")
        pruefe("O3b danach aendert ein anderer Name die gewaehlte Anzahl nicht mehr", dlg.vars["lzk_anzahl"].get() == "3")
        dlg.vars["name"].set("Kreise")
        dlg.vars["lzk_datum_3"].set("20.11.2026")
        dlg.vars["lzk_anzahl"].set("2")
        wurzel.update()
        pruefe("O4 weniger als ausgefuellt: Hinweis, die Anzahl bleibt, LZK 3 bleibt zu sehen",
               dlg.vars["lzk_anzahl"].get() == "3" and any("LZK 3" in m for m in meldungen)
               and "LZK-Datum 3 (TT.MM.JJJJ)" in beschriftungen(dlg), meldungen)
        dlg._uebernehmen()
        r = dlg.result
        pruefe("O5 uebernommen: Anzahl 3 (weicht von der Vorlage ab), Termin bei LZK 3",
               r is not None and r.lzk_anzahl == 3 and r.lzk_datum_3 == date(2026, 11, 20), r)

        vorh = D.Baustein(name="Kreise", status="In Bearbeitung", lzk_datum_1=date(2026, 10, 1))
        dlg2 = A.BausteinDialog(wurzel, vorh, vorlage_lzk=VORLAGE)
        wurzel.update()
        pruefe("O6 vorhandener Baustein ohne eigene Wahl: Anzahl laut Vorlage", dlg2.vars["lzk_anzahl"].get() == "1")
        dlg2._uebernehmen()
        pruefe("O6b gleich der Vorlage: nichts eigens gespeichert (folgt ihr weiter)",
               dlg2.result.lzk_anzahl is None and dlg2.result.lzk_datum_1 == date(2026, 10, 1), dlg2.result)

        verkn = D.Baustein(name="Terme", lzk_online_3={"id": 5, "datum": None, "ergebnis": ""})
        dlg3 = A.BausteinDialog(wurzel, verkn, vorlage_lzk={})
        wurzel.update()
        meldungen.clear()
        dlg3.vars["lzk_anzahl"].set("2")
        pruefe("O7 nur eine Verknuepfung bei LZK 3 (sonst leer): auch dann nicht verkleinern",
               dlg3.vars["lzk_anzahl"].get() == "3" and meldungen, meldungen)
        dlg3._uebernehmen()
        pruefe("O7b die Verknuepfung ueberlebt das Bearbeiten", dlg3.result.lzk_online_3 == {"id": 5, "datum": None, "ergebnis": ""})

        app_b = D.Baustein(name="Baustein Kreise", bemerkung=D.LT_MARKER + " 3 von 20")
        dlg4 = A.BausteinDialog(wurzel, app_b, vorlage_lzk={"Baustein Kreise": 1})
        wurzel.update()
        box = next(w for w in dlg4._form.grid_slaves() if isinstance(w, ttk.Combobox)
                   and str(w.cget("textvariable")) == str(dlg4.vars["lzk_anzahl"]))
        pruefe("O8 Zeile aus der App: Anzahl fest 2, die Auswahl ist gesperrt",
               dlg4.vars["lzk_anzahl"].get() == "2" and str(box.cget("state")) == "disabled")
        dlg4._uebernehmen()
        pruefe("O8b und bleibt ohne eigene Wahl", dlg4.result.lzk_anzahl is None)

        # Vorlage: Anzahl je Baustein
        vd = A.VorlageDialog(wurzel, ["Kreise", "Terme", "Prozente"], {"Kreise": 1})
        wurzel.update()
        werte = [(vd.baum.item(i, "text"), str(vd.baum.item(i, "values")[0])) for i in vd.baum.get_children()]
        pruefe("V1 die Vorlage zeigt je Baustein die Anzahl LZK",
               werte == [("Kreise", "1"), ("Terme", "2"), ("Prozente", "2")], werte)
        pruefe("V1b ohne Markierung ist die Auswahl gesperrt", str(vd.anzahl_box.cget("state")) == "disabled")
        terme_iid = vd.baum.get_children()[1]
        vd.baum.selection_set(terme_iid)
        wurzel.update()
        vd.anzahl_var.set("3")
        vd._anzahl_gewaehlt()
        vd.neu_var.set("Projekt")
        vd.neu_anzahl.set("0")
        vd._hinzufuegen()
        vd.baum.selection_set(terme_iid)
        vd._verschieben(-1)
        vd._speichern()
        pruefe("V2 gewaehlt, hinzugefuegt, verschoben: Namen in neuer Reihenfolge, Anzahl nur wo nicht 2",
               vd.result == ["Terme", "Kreise", "Prozente", "Projekt"]
               and vd.anzahl == {"Terme": 3, "Kreise": 1, "Projekt": 0}, (vd.result, vd.anzahl))

        # Tabelle der Person: LZK-Spalten nach der groessten Anzahl, "–" wo ein Baustein keine hat
        A.App._zuletzt_oeffnen = lambda self: None
        app = A.App()
        app.withdraw()
        app.az.vorlage_lzk = {"Kreise": 1}
        person = D.Student("A", "B", bausteine=[
            D.Baustein(name="Kreise", status="In Bearbeitung", lzk_datum_1=date(2026, 11, 3)),
            D.Baustein(name="Terme", lzk_anzahl=3, lzk_datum_3=date(2026, 11, 20))])
        app.az.students = [person]
        app.aktueller_schueler = person
        app._detail_anzeigen()
        spalten = list(app.tabelle.cget("displaycolumns"))
        pruefe("T1 LZK 3 als Spalte, weil ein Baustein drei hat - LZK 4 nicht",
               "lzk3" in spalten and "note3" in spalten and "lzk4" not in spalten, spalten)
        kreise_zeile = app.tabelle.item("0", "values")
        terme_zeile = app.tabelle.item("1", "values")
        pruefe("T2 Kreise (eine LZK): bei LZK 2 und 3 ein Strich, Terme: Termin bei LZK 3",
               kreise_zeile[3] == "–" and kreise_zeile[5] == "–" and terme_zeile[5] == "20.11.2026",
               (kreise_zeile, terme_zeile))
        person.bausteine.pop()
        app._detail_anzeigen()
        pruefe("T3 ohne Baustein mit mehr LZK: wieder nur LZK 1 und 2",
               list(app.tabelle.cget("displaycolumns")) == ["status", "lzk1", "note1", "lzk2", "note2", "halbjahr", "bemerkung"])
        app._bausteine_sortieren("lzk3")
        pruefe("T4 nach LZK 3 sortieren geht", app._bausteine_sortierung == "lzk3")
        app.destroy()
    finally:
        A.messagebox.showwarning, A.messagebox.showerror = echt_warn, echt_fehler
    wurzel.destroy()
else:
    print("--  Fenster-Pruefungen uebersprungen (kein Bildschirm)")

print(f"\n{ok} Prüfungen bestanden.")
