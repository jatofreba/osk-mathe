"""Zwei Absicherungen (2026-11-04):
E) Die gebaute App (PyInstaller, .app am Mac) findet ihre Einstellungen - nicht im
   Paket, das jeder Neubau ersetzt, sondern in der osk_einstellungen.json oberhalb
   (Organisation/), sonst im Einstellungsordner des Benutzers.
T) "Mathe-Talk-Bewertungen hochladen…" ruft vorher ab: wurde online die buchende
   Person getauscht, geht die Bewertung nicht an die falsche Person."""
import copy
import json
import os
import shutil
import sys
import tempfile

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


# ===========================================================================
# E) Einstellungsdatei
# ===========================================================================
pruefe("E1 als Skript: neben der Anwendung (wie bisher)",
       A.einstellungen_pfad() == os.path.join(os.path.dirname(os.path.abspath(A.__file__)), "osk_einstellungen.json"))

tmp = tempfile.mkdtemp(prefix="osk_einst_")
echt = {"frozen": getattr(sys, "frozen", None), "executable": sys.executable, "platform": sys.platform,
        "expanduser": os.path.expanduser}
try:
    org = os.path.join(tmp, "Organisation")
    macos = os.path.join(org, "dist", "Arbeitsstaende.app", "Contents", "MacOS")
    os.makedirs(macos)
    open(os.path.join(macos, "Arbeitsstaende"), "w").close()
    with open(os.path.join(org, "osk_einstellungen.json"), "w", encoding="utf-8") as f:
        json.dump({"base_url": "https://beispiel.invalid", "username": "lb"}, f)
    sys.frozen, sys.executable = True, os.path.join(macos, "Arbeitsstaende")
    pruefe("E2 gebaute App in Organisation/dist: nimmt die Datei in Organisation",
           A.einstellungen_pfad() == os.path.join(org, "osk_einstellungen.json"), A.einstellungen_pfad())
    app = A.App.__new__(A.App)
    pruefe("E3 und liest daraus Adresse und Benutzer",
           app._lt_einstellungen_laden() == {"base_url": "https://beispiel.invalid", "username": "lb"})
    app._lt_einstellungen_speichern({"zuletzt_geoeffnet": "/x/arbeit.json"})
    gespeichert = json.load(open(os.path.join(org, "osk_einstellungen.json"), encoding="utf-8"))
    im_paket = [os.path.join(w, f) for w, _, fs in os.walk(os.path.join(org, "dist")) for f in fs
                if f == "osk_einstellungen.json"]
    pruefe("E4 speichert dorthin (ergaenzt, nichts geht verloren) - nichts im Paket",
           gespeichert == {"base_url": "https://beispiel.invalid", "username": "lb",
                           "zuletzt_geoeffnet": "/x/arbeit.json"} and not im_paket, (gespeichert, im_paket))

    # App woanders (z.B. Programme), keine Datei darueber: Einstellungsordner des Benutzers
    weit = os.path.join(tmp, "a", "b", "c", "Programme", "Arbeitsstaende.app", "Contents", "MacOS")
    os.makedirs(weit)
    sys.executable = os.path.join(weit, "Arbeitsstaende")
    heim = os.path.join(tmp, "heim")
    sys.platform = "darwin"
    os.path.expanduser = lambda p: p.replace("~", heim, 1) if p.startswith("~") else p
    ziel = os.path.join(heim, "Library", "Application Support", "OSK-Arbeitsstaende", "osk_einstellungen.json")
    pruefe("E5 ohne Datei oberhalb: ~/Library/Application Support/OSK-Arbeitsstaende",
           A.einstellungen_pfad() == ziel, A.einstellungen_pfad())
    pruefe("E5b dort zunaechst leer (kein Absturz)", app._lt_einstellungen_laden() == {})
    app._lt_einstellungen_speichern({"base_url": "https://b.invalid"})
    pruefe("E6 erstes Speichern legt den Ordner an und bleibt erhalten",
           json.load(open(ziel, encoding="utf-8")) == {"base_url": "https://b.invalid"}
           and app._lt_einstellungen_laden() == {"base_url": "https://b.invalid"})
finally:
    if echt["frozen"] is None:
        del sys.frozen
    else:
        sys.frozen = echt["frozen"]
    sys.executable, sys.platform, os.path.expanduser = echt["executable"], echt["platform"], echt["expanduser"]
    shutil.rmtree(tmp, ignore_errors=True)
pruefe("E7 danach wieder Skript-Verhalten", A.einstellungen_pfad().startswith(os.path.dirname(os.path.abspath(A.__file__))))

# ===========================================================================
# T) Talk-Bewertungen hochladen: erst abrufen
# ===========================================================================


def slot(vortrag="an.be"):
    return {"id": 1, "datum": "2026-09-24T22:00:00.000Z", "uhrzeit": "10:00", "halbjahr": "2627_1",
            "typ": "talk", "session_id": 11, "thema": "Pythagoras", "presentedStatus": "ausstehend",
            "pokale": 0, "qualityEmoji": None, "presenter_username": vortrag, "coPresenters": [], "invitees": []}


class Client:
    def __init__(self, slots, kaputt=False):
        self.slots, self.kaputt, self.hoch = slots, kaputt, []
    def mathe_talks(self):
        if self.kaputt:
            raise OSError("Server nicht erreichbar")
        return copy.deepcopy(self.slots)
    def talk_bewerten(self, rolle, online_id, status, flammen, emoji):
        self.hoch.append(("bewertung", rolle, online_id, status, flammen))
    def talk_thema(self, session_id, thema):
        self.hoch.append(("thema", session_id, thema))


class HochladenAttrappe:
    gesehen = []
    def __init__(self, parent, auftraege, klasse):
        HochladenAttrappe.gesehen.append(auftraege)
        self.result = True


def aufbau(client):
    anna = D.Student("Anna", "Berger", alias="an.be")
    mara = D.Student("Mara", "Bauer", alias="ma.ba")
    D.lt_talks_uebernehmen(anna, D.lt_mathe_talks([slot()])["an.be"])
    t = anna.talks[0]
    t.status, t.flammen = "erledigt", 3          # hier bewertet, noch nicht hochgeladen
    app = A.App.__new__(A.App)
    app.az = D.Arbeitsstaende()
    app.az.students = [anna, mara]
    app.merk = {"bericht": "", "melde": "", "angemeldet": 0, "fehler": ""}
    app._dubletten_melden = lambda titel: False

    def anmelden(still=False):
        app.merk["angemeldet"] += 1
        return client, "M3M4"
    app._lt_anmelden = anmelden
    app.wait_window = lambda d: None
    app._markiere_ungespeichert = app._talks_anzeigen = lambda *a: None
    app._bericht = lambda titel, text: app.merk.__setitem__("bericht", text)
    app._melde = lambda text: app.merk.__setitem__("melde", text)
    return app, anna, mara, t


echt_dlg, echt_fehler = A.TalkHochladenDialog, A.messagebox.showerror
A.TalkHochladenDialog = HochladenAttrappe
A.messagebox.showerror = lambda titel, text, **k: fehler_texte.append(text)
fehler_texte = []
try:
    # Normalfall: online unveraendert -> nach dem Abruf hochladen wie bisher
    client = Client([slot()])
    app, anna, mara, t = aufbau(client)
    app.talks_hochladen()
    pruefe("T1 Normalfall: Bewertung geht an die Buchung (nach dem Abruf)",
           client.hoch == [("bewertung", "gehalten", 11, "erledigt", 3)] and len(HochladenAttrappe.gesehen) == 1
           and "Vorher abgerufen" in app.merk["bericht"], (client.hoch, app.merk["bericht"]))

    # Online wurde die buchende Person getauscht (an.be -> ma.ba)
    HochladenAttrappe.gesehen.clear()
    client = Client([slot("ma.ba")])
    app, anna, mara, t = aufbau(client)
    app.talks_hochladen()
    pruefe("T2 getauscht: NICHTS geht hoch - die Bewertung landet nicht bei der neuen Person",
           client.hoch == [] and HochladenAttrappe.gesehen == [], client.hoch)
    pruefe("T2b Annas Bewertung bleibt hier erhalten, der Eintrag ist 'online nicht mehr da'",
           t.online_fehlt and (t.status, t.flammen) == ("erledigt", 3), t)
    pruefe("T2c die neue Person hat den Talk mit dem Stand von online (unbewertet)",
           [(x.rolle, x.online_id, x.status) for x in mara.talks] == [("gehalten", 11, "ausstehend")], mara.talks)
    pruefe("T2d der Bericht sagt, was nicht hochging und warum",
           "Anna Berger" in app.merk["bericht"] and "gehört online nicht mehr zu dieser Person" in app.merk["bericht"],
           app.merk["bericht"])

    # Abruf schlaegt fehl: nichts hochladen
    client = Client([slot()], kaputt=True)
    app, anna, mara, t = aufbau(client)
    app.talks_hochladen()
    pruefe("T3 Abruf klappt nicht: Fehlermeldung, nichts hochgeladen, Bewertung bleibt wartend",
           client.hoch == [] and fehler_texte and "nichts hochgeladen" in fehler_texte[-1] and D.talk_wartet(t),
           fehler_texte)

    # Nichts geaendert: gar keine Anmeldung
    client = Client([slot()])
    app, anna, mara, t = aufbau(client)
    t.status, t.flammen = "ausstehend", 0
    app.talks_hochladen()
    pruefe("T4 hier nichts geaendert: kurze Meldung, keine Anmeldung", app.merk["angemeldet"] == 0
           and "nichts geändert" in app.merk["melde"], app.merk)
finally:
    A.TalkHochladenDialog, A.messagebox.showerror = echt_dlg, echt_fehler

print(f"\n{ok} Prüfungen bestanden.")
