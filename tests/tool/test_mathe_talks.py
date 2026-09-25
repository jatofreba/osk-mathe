"""Prueft die Mathe-Talks im Tool: Abruf, Drei-Wege-Abgleich, Hochladen, Speichern."""
import copy
import importlib.util
import json
import os
import sys
from datetime import date

from pfade import WERKZEUG  # noqa: E402
import arbeitsstaende_data as d  # noqa: E402

ok = 0


def pruefe(name, bedingung, extra=""):
    global ok
    if not bedingung:
        print(("FAIL: " + name + (("\n      " + str(extra)) if extra else ""))
              .encode("ascii", "replace").decode("ascii"))
        sys.exit(1)
    ok += 1
    print("OK  " + name)


# Antwort von /api/admin/talking-slots?typ=talk&subject=mathe, wie der Server sie
# schickt (DATE als UTC-Zeitstempel der lokalen Mitternacht).
def slots():
    return [
        {"id": 1, "datum": "2026-09-24T22:00:00.000Z", "uhrzeit": "10:00", "halbjahr": "2627_1",
         "typ": "talk", "session_id": 11, "thema": "Pythagoras", "presentedStatus": "ausstehend",
         "pokale": 0, "qualityEmoji": None, "presenter_username": "an.be",
         "coPresenters": [
             {"id": 101, "userId": 5, "username": "ma.ba", "status": "angenommen",
              "attendedStatus": "ausstehend", "pokale": 0, "qualityEmoji": None},
             {"id": 102, "userId": 6, "username": "fi.ko", "status": "eingeladen",
              "attendedStatus": "ausstehend", "pokale": 0, "qualityEmoji": None}],
         "invitees": [
             {"id": 201, "listenerId": 7, "username": "le.no", "status": "angenommen",
              "attendedStatus": "erledigt", "pokale": 2, "qualityEmoji": "🌟"},
             {"id": 202, "listenerId": 8, "username": "jo.mu", "status": "eingeladen",
              "attendedStatus": "ausstehend", "pokale": 0, "qualityEmoji": None},
             {"id": 203, "listenerId": 9, "username": "ka.li", "status": "abgelehnt",
              "attendedStatus": "nicht_erledigt", "pokale": 0, "qualityEmoji": None}]},
        # freier Termin: niemand gebucht
        {"id": 2, "datum": "2026-10-01T22:00:00.000Z", "uhrzeit": "10:00", "halbjahr": "2627_1",
         "typ": "talk", "session_id": None, "invitees": [], "coPresenters": []},
        # Termin ohne Halbjahr: aus dem Datum
        {"id": 3, "datum": "2026-02-10", "uhrzeit": "", "halbjahr": "",
         "typ": "talk", "session_id": 12, "thema": "Brüche", "presentedStatus": "erledigt",
         "pokale": 3, "qualityEmoji": "🤩", "presenter_username": "le.no",
         "coPresenters": [], "invitees": [
             {"id": 204, "listenerId": 1, "username": "an.be", "status": "angenommen",
              "attendedStatus": "ausstehend", "pokale": 0, "qualityEmoji": None}]},
    ]


# ===========================================================================
# A) Serverantwort lesen
# ===========================================================================
je = d.lt_mathe_talks(slots())
pruefe("A1 Datum: UTC-Zeitstempel landet auf dem richtigen Tag",
       je["an.be"][0]["datum"] == date(2026, 9, 25), je["an.be"][0]["datum"])
pruefe("A2 Vortragende Person: gehalten, Kennung = Buchung",
       je["an.be"][0]["rolle"] == "gehalten" and je["an.be"][0]["online_id"] == 11)
pruefe("A3 zugesagter Mit-Vortrag: eigene Zeile mit Einladungs-Kennung",
       [(e["rolle"], e["online_id"]) for e in je["ma.ba"]] == [("mitvortrag", 101)], je.get("ma.ba"))
pruefe("A3b wer mit vortraegt, sieht die anderen", je["ma.ba"][0]["mit"] == "an.be")
pruefe("A3c gehalten nennt die Mit-Vortragenden", je["an.be"][0]["mit"] == "ma.ba")
pruefe("A4 offene Mit-Vortrag-Einladung zaehlt nicht", "fi.ko" not in je)
pruefe("A5 zugesagte Zuhoerende mit Bewertung",
       je["le.no"][0]["rolle"] == "zugehoert" and je["le.no"][0]["online"]["flammen"] == 2
       and je["le.no"][0]["mit"] == "an.be & ma.ba", je["le.no"][0])
pruefe("A6 nur eingeladen: nicht dabei", "jo.mu" not in je)
pruefe("A7 abgesagt, aber schon bewertet: dabei (wie auf dem Server)",
       je["ka.li"][0]["online"]["status"] == "nicht_erledigt")
pruefe("A8 freier Termin wird uebergangen",
       all(e["session_id"] != 2 for liste in je.values() for e in liste))
pruefe("A9 Halbjahr aus dem Datum, wenn der Termin keins hat",
       je["le.no"][1]["halbjahr"] == "2526_2", je["le.no"][1])

# ===========================================================================
# B) Uebernehmen: Drei-Wege-Abgleich
# ===========================================================================
anna = d.Student(vorname="Anna", nachname="Berger", alias="an.be")
b = d.lt_talks_uebernehmen(anna, copy.deepcopy(je["an.be"]))
pruefe("B1 beim ersten Abruf alles neu", b["neu"] == 2 and len(anna.talks) == 2, b)
pruefe("B1b neueste zuerst", anna.talks[0].datum == date(2026, 9, 25))
pruefe("B1c nichts wartet aufs Hochladen", d.lt_talks_hochladen_liste(anna) == [])

talk = anna.talks[0]
talk.status, talk.flammen, talk.emoji = "erledigt", 2, "👍"
talk.bemerkung = "stark erklaert"
b = d.lt_talks_uebernehmen(anna, copy.deepcopy(je["an.be"]))
pruefe("B2 hier bewertet, online unveraendert: bleibt", talk.status == "erledigt" and talk.flammen == 2, talk)
pruefe("B2b und wartet aufs Hochladen", d.talk_wartet(talk))
pruefe("B2c die Bemerkung bleibt nur hier", talk.bemerkung == "stark erklaert")

online = copy.deepcopy(je["an.be"])
online[0]["online"].update(status="erledigt", flammen=3, emoji="🤩")
b = d.lt_talks_uebernehmen(anna, online)
pruefe("B3 beide verschieden geaendert: hier bleibt, wird gemeldet",
       talk.flammen == 2 and len(b["konflikte"]) == 1, b)
auftraege = d.lt_talks_hochladen_liste(anna)
pruefe("B3b beim Hochladen steht, was online inzwischen gilt",
       auftraege and auftraege[0][3]["flammen"] == 3, auftraege)

d.talk_hochgeladen(talk, "bewertung")
pruefe("B4 nach dem Hochladen wartet nichts mehr", not d.talk_wartet(talk))
online[0]["online"].update(status="nicht_erledigt", flammen=0, emoji="")
b = d.lt_talks_uebernehmen(anna, online)
pruefe("B5 hier unveraendert, online geaendert: online kommt herein",
       talk.status == "nicht_erledigt" and talk.flammen == 0 and b["uebernommen"], b)

# Thema: nur am gehaltenen Talk pflegbar
talk.thema = "Satz des Pythagoras"
online = copy.deepcopy(je["an.be"])
online[0]["online"].update(status="nicht_erledigt", flammen=0, emoji="")
d.lt_talks_uebernehmen(anna, online)
pruefe("B6 hier geschaerftes Thema bleibt und wartet",
       talk.thema == "Satz des Pythagoras"
       and any(w == "thema" for _, w, *_ in d.lt_talks_hochladen_liste(anna)))
zuhoeren = next(t for t in anna.talks if t.rolle == "zugehoert")
zuhoeren.thema = "anders"
online[1]["thema"] = online[1]["online"]["thema"] = "Brüche"
d.lt_talks_uebernehmen(anna, online)
pruefe("B7 beim Zuhoeren folgt das Thema immer dem Server", zuhoeren.thema == "Brüche")

# Online verschwunden: markieren, nicht loeschen
b = d.lt_talks_uebernehmen(anna, [online[0]])
pruefe("B8 online weg: markiert, bleibt in der Liste",
       zuhoeren in anna.talks and zuhoeren.online_fehlt and len(b["fehlen"]) == 1, b)
pruefe("B8b und wird nicht hochgeladen",
       all(t is not zuhoeren for t, *_ in d.lt_talks_hochladen_liste(anna)))
b = d.lt_talks_uebernehmen(anna, [online[0]])
pruefe("B8c beim naechsten Abruf nicht noch einmal gemeldet", not b["fehlen"], b)
d.lt_talks_uebernehmen(anna, online)
pruefe("B8d taucht er wieder auf, ist die Markierung weg", not zuhoeren.online_fehlt)

# ===========================================================================
# C) Hochladen: nie Leeres
# ===========================================================================
t = d.MatheTalk(rolle="zugehoert", online_id=5, status="ausstehend", flammen=0,
                online={"status": "erledigt", "flammen": 2, "emoji": "", "thema": "x"})
pruefe("C1 'noch nicht bewertet' geht nie hoch (loescht online nichts)", not d.talk_wartet(t))
t = d.MatheTalk(rolle="gehalten", online_id=5, thema="  ",
                online={"status": "ausstehend", "flammen": 0, "emoji": "", "thema": "x"})
pruefe("C2 leeres Thema geht nie hoch", not d.talk_wartet(t))
pruefe("C3 Zuhoeren hoechstens 2 Flammen, Vortrag 3",
       d.MatheTalk(rolle="zugehoert").max_flammen == 2 and d.MatheTalk(rolle="mitvortrag").max_flammen == 3)

# ===========================================================================
# D) Speichern und Laden (JSON)
# ===========================================================================
az = d.Arbeitsstaende()
az.students = [anna]
daten = json.loads(json.dumps(az.als_dict(), ensure_ascii=False))
pruefe("D1 die Talks stehen in der Datei", len(daten["personen"][0]["mathe_talks"]) == 2)
az2 = d.Arbeitsstaende()
az2.aus_dict(daten)
t1, t2 = anna.talks[0], az2.students[0].talks[0]
pruefe("D2 und kommen unveraendert zurueck",
       d.talk_als_dict(t1) == d.talk_als_dict(t2), (d.talk_als_dict(t1), d.talk_als_dict(t2)))
pruefe("D3 auch der gemeinsame Stand (sonst ginge alles erneut hoch)", t2.online == t1.online)
alt = d.Arbeitsstaende()
alt.aus_dict({"format": d.JSON_FORMAT, "version": 1,
              "personen": [{"vorname": "A", "nachname": "B"}]})
pruefe("D4 aeltere Dateien ohne Talks laden weiter", alt.students[0].talks == [])
gruppen = d.talks_je_halbjahr(anna)
pruefe("D5 je Halbjahr gruppiert, neuestes zuerst", list(gruppen) == ["2627_1", "2526_2"], list(gruppen))

# ===========================================================================
# E) Oberflaeche (nur mit Bildschirm - in der CI ohne Display uebersprungen)
# ===========================================================================
QUELLE = os.path.join(WERKZEUG, "arbeitsstaende_app.py")
quelle = open(QUELLE, encoding="utf-8").read()
pruefe("E1 Menue: abrufen und hochladen",
       'label="Mathe-Talks abrufen"' in quelle and 'label="Mathe-Talk-Bewertungen hochladen…"' in quelle)
pruefe("E2 'Ergebnisse abrufen' holt die Talks gleich mit",
       "self._talks_abgleichen(client)" in quelle[quelle.index("def app_ergebnisse_abrufen"):
                                                 quelle.index("def _lt_serverstand")])
spec = importlib.util.spec_from_file_location("talkapp", QUELLE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
try:
    import tkinter as tk
    probe = tk.Tk()
    probe.destroy()
    bildschirm = True
except Exception:
    bildschirm = False
if bildschirm:
    mod.App._zuletzt_oeffnen = lambda self: None     # keine echte Arbeitsdatei laden
    app = mod.App()
    app.withdraw()
    app.az.students = [anna]
    app.aktueller_schueler = anna
    app._detail_anzeigen()
    wurzeln = app.talk_tabelle.get_children()
    pruefe("E3 je Halbjahr eine Zeile", list(wurzeln) == ["hj:2627_1", "hj:2526_2"], wurzeln)
    pruefe("E4 das laufende Halbjahr ist aufgeklappt, altes zu",
           app.talk_tabelle.item("hj:2526_2", "open") in (0, False)
           and (app.talk_tabelle.item("hj:2627_1", "open") in (1, True)) == (d.halbjahr_fuer_datum() == "2627_1"))
    pruefe("E5 Bewerten ist ohne markierte Zeile aus",
           str(app.btn_talk_bewerten.cget("state")) == "disabled")
    kind = app.talk_tabelle.get_children("hj:2627_1")[0]
    app.talk_tabelle.selection_set(kind)
    app.update()
    pruefe("E6 auf einer Talk-Zeile an", str(app.btn_talk_bewerten.cget("state")) == "normal")
    app.talk_tabelle.selection_set("hj:2627_1")
    app.update()
    pruefe("E7 auf der Halbjahres-Summe aus", str(app.btn_talk_bewerten.cget("state")) == "disabled")
    app.destroy()
else:
    print("--  Oberflaechen-Pruefungen uebersprungen (kein Bildschirm)")

print(f"\n{ok} Prüfungen bestanden.")
