"""LZK-Termine eigener Bausteine gehen als freie Mathe-LZK an OSKlar: anlegen, was online
fehlt; nachziehen, was HIER geaendert wurde; nie ueberschreiben, was online geaendert wurde."""
import io
import json
import os
import sys
from datetime import date, timedelta

HIER = os.path.dirname(os.path.abspath(__file__))
from pfade import WERKZEUG  # noqa: E402
NEU = WERKZEUG
for name in ("arbeitsstaende_data", "osk_sync", "arbeitsstaende_app"):
    sys.modules.pop(name, None)
import arbeitsstaende_data as D  # noqa: E402
import osk_sync as O             # noqa: E402
import arbeitsstaende_app as A   # noqa: E402

ok = 0


def pruefe(name, bedingung, extra=""):
    global ok
    if not bedingung:
        print(("FAIL: " + name + (("\n      " + str(extra)) if extra else "")).encode("ascii", "replace").decode("ascii"))
        sys.exit(1)
    ok += 1
    print("OK  " + name)


def eintrag(i, thema, typ="Basis", datum="2026-09-30", fach="mathe", status="ausstehend", pokale=0,
            lerntheke=None, anfrage=None):
    return {"id": i, "typ": typ, "lerntheke": lerntheke, "datum": datum, "status": status,
            "pokale": pokale, "thema": thema, "anfrage": anfrage, "fach": fach}


HEUTE = date(2026, 9, 25)
D30 = date(2026, 9, 30)


def person(*bausteine):
    return D.Student(vorname="Gabriel", nachname="E", alias="ga.em", bausteine=list(bausteine))


def plan(st, lzk, titel=None):
    return D.lt_freie_lzk_senden(st, {"id": 7, "lzk": lzk}, HEUTE, titel or {})


def arten(auftraege):
    return [(a["art"], a["titel"], a["nummer"]) for a in auftraege]


def gruende(ueber):
    return " | ".join(u["grund"] for u in ueber)


# ===========================================================================
# 1) Speichern: die Verknuepfung steht im LZK-Block und ueberlebt Laden/Speichern
# ===========================================================================
b = D.Baustein(name="Kreise", lzk_datum_1=D30, lzk_online_1={"id": 12, "datum": "2026-09-30", "ergebnis": ""})
d = D.baustein_als_dict(b)
pruefe("J1 die Verknuepfung steht im LZK-Block", d["lzk_1"]["online"] == {"id": 12, "datum": "2026-09-30", "ergebnis": ""}, d)
pruefe("J1b Platz 2 ohne Verknuepfung bleibt leer", "lzk_2" not in d, d)
b2 = D.baustein_aus_dict(json.loads(json.dumps(d)))
pruefe("J2 und kommt beim Laden zurueck", b2.lzk_online_1 == {"id": 12, "datum": "2026-09-30", "ergebnis": ""}
       and b2.lzk_online_2 is None, b2)
alt = D.baustein_aus_dict({"name": "Kreise", "lzk_1": {"datum": "2026-09-30"}})
pruefe("J3 aeltere Dateien: keine Verknuepfung", alt.lzk_online_1 is None and alt.lzk_datum_1 == D30, alt)
for kaputt in ({"id": "abc"}, {"id": 0}, "12", [12], {"datum": "2026-09-30"}):
    x = D.baustein_aus_dict({"name": "K", "lzk_1": {"online": kaputt}})
    pruefe(f"J4 unbrauchbare Verknuepfung {kaputt!r} wird verworfen", x.lzk_online_1 is None, x)
x = D.baustein_aus_dict({"name": "K", "lzk_1": {"online": {"id": "12", "datum": None, "ergebnis": "7"}}})
pruefe("J5 ID als Text wird Zahl, unbekanntes Ergebnis wird leer", x.lzk_online_1 == {"id": 12, "datum": None, "ergebnis": ""}, x)
nur_link = D.baustein_als_dict(D.Baustein(name="K", lzk_online_2={"id": 3, "datum": "2026-09-30", "ergebnis": "2"}))
pruefe("J6 auch ohne Datum hier bleibt die Verknuepfung gespeichert", nur_link.get("lzk_2", {}).get("online", {}).get("id") == 3, nur_link)

# ===========================================================================
# 2) Anlegen, was online fehlt
# ===========================================================================
kreise = D.Baustein(name="Kreise", status="In Bearbeitung", lzk_datum_1=D30)
a, u, v = plan(person(kreise), [])
pruefe("A1 anstehender Termin eines eigenen Bausteins wird angelegt", arten(a) == [("anlegen", "Kreise", 1)], a)
pruefe("A1b als Basis-LZK, Titel = Baustein-Name, mit Person und Datum",
       a[0]["typ"] == "Basis" and a[0]["user_id"] == 7 and a[0]["neu"] == D30 and a[0]["baustein"] is kreise, a[0])
auf = D.Baustein(name="Satz des Pythagoras", lzk_datum_2=date(2026, 10, 12))
a, _, _ = plan(person(auf), [])
pruefe("A2 LZK 2 wird eine Aufbau-LZK", arten(a) == [("anlegen", "Satz des Pythagoras", 2)] and a[0]["typ"] == "Aufbau", a)
a, _, _ = plan(person(D.Baustein(name="Terme 1", lzk_datum_1=HEUTE)), [])
pruefe("A3 heute zaehlt noch als anstehend", arten(a) == [("anlegen", "Terme 1", 1)], a)
a, u, v = plan(person(D.Baustein(name="Geometrie", lzk_datum_1=date(2026, 9, 10)),
                      D.Baustein(name="Lineare Funktionen", lzk_datum_1=date(2026, 2, 1))), [])
pruefe("A4 vergangene Termine ohne Ergebnis werden NICHT angelegt", a == [], a)
pruefe("A4b gezaehlt wird nur das laufende Halbjahr", v == 1, v)
a, _, _ = plan(person(D.Baustein(name="Geometrie", lzk_datum_1=date(2026, 9, 10), lzk_ergebnis_1="2")), [])
pruefe("A5 ein vergangener Termin MIT Ergebnis wird angelegt, samt Ergebnis",
       arten(a) == [("anlegen", "Geometrie", 1)] and a[0]["neu_erg"] == "2", a)
app_zeile = D.Baustein(name="Baustein Lineare Funktionen", lzk_datum_1=D30, bemerkung=D.LT_MARKER + " Stand")
a, u, _ = plan(person(app_zeile, D.Baustein(name="  ", lzk_datum_1=D30)), [])
pruefe("A6 App-Zeilen und namenlose Zeilen bleiben aussen vor", a == [] and u == [], (a, u))
a, u, _ = plan(person(D.Baustein(name="Kreise", lzk_ergebnis_1="1")), [])
pruefe("A7 Ergebnis ohne Datum: nichts anlegen, aber melden", a == [] and "ohne LZK-Datum" in gruende(u), (a, u))

# Schutz vor Dubletten
a, u, _ = plan(person(D.Baustein(name="Kreise", lzk_datum_1=D30)),
               [eintrag(50, "kreise", datum="2026-10-02", anfrage="offen")])
pruefe("D1 online zum selben Baustein angefragt: erst dort entscheiden", a == [] and "angefragt" in gruende(u), (a, u))
a, _, _ = plan(person(D.Baustein(name="Kreise", lzk_datum_1=D30)),
               [eintrag(51, "Kreise", typ="Aufbau", datum="2026-10-20", anfrage="offen")])
pruefe("D1b eine Anfrage fuer den ANDEREN Platz haelt nicht auf", arten(a) == [("anlegen", "Kreise", 1)], a)
a, u, _ = plan(person(D.Baustein(name="Kreise", lzk_datum_1=D30)),
               [eintrag(52, "", lerntheke="lerntheke_kreise_v11")], {"lerntheke_kreise_v11": "Kreise und Zylinder"})
pruefe("D2 am selben Tag steht schon die Lerntheken-LZK: nicht doppelt",
       a == [] and "Kreise und Zylinder" in gruende(u) and "nicht doppelt" in gruende(u), (a, u))
a, u, _ = plan(person(D.Baustein(name="Kreise", lzk_datum_1=D30)),
               [eintrag(53, "Kreise und Zylinder", typ="Basis", datum="2026-09-30")])
pruefe("D3 am selben Tag eine freie LZK anderen Titels: nicht doppelt", a == [] and "nicht doppelt" in gruende(u), (a, u))
a, _, _ = plan(person(D.Baustein(name="Kreise", lzk_datum_1=D30)),
               [eintrag(54, "Erörterung", fach="deutsch"), eintrag(55, "Kreise", datum="2026-09-30", anfrage="abgelehnt")])
pruefe("D4 andere Faecher und abgelehnte Anfragen halten nicht auf", arten(a) == [("anlegen", "Kreise", 1)], a)
terme = D.Baustein(name="Terme 1", lzk_datum_1=D30, lzk_online_1={"id": 56, "datum": "2026-09-30", "ergebnis": ""})
a, _, _ = plan(person(terme, D.Baustein(name="Kreise", lzk_datum_1=D30)), [eintrag(56, "Terme 1")])
pruefe("D5 zwei eigene LZK am selben Tag gehen (die andere ist ja verknuepft)", arten(a) == [("anlegen", "Kreise", 1)], a)

# ===========================================================================
# 3) Online gibt es die LZK schon (ueber den Titel gefunden, noch nicht verknuepft)
# ===========================================================================
k = D.Baustein(name="Kreise", lzk_datum_1=D30)
a, u, _ = plan(person(k), [eintrag(60, "Kreise")])
pruefe("T1 gleicher Tag: nur verknuepfen, nichts anlegen",
       arten(a) == [("verknuepfen", "Kreise", 1)] and a[0]["link"] == {"id": 60, "datum": "2026-09-30", "ergebnis": ""}, a)
k = D.Baustein(name="Kreise", lzk_datum_1=D30, lzk_ergebnis_1="2")
a, _, _ = plan(person(k), [eintrag(61, "Kreise")])
pruefe("T2 hier bewertet, online nicht: das Ergebnis geht hinaus",
       arten(a) == [("aendern", "Kreise", 1)] and a[0]["felder"] == {"status": "bestanden", "pokale": 2}
       and a[0]["link"]["ergebnis"] == "2", a)
k = D.Baustein(name="Kreise", lzk_datum_1=D30)
a, u, _ = plan(person(k), [eintrag(62, "Kreise", datum="2026-10-02")])
pruefe("T3 verschiedene Tage ohne Verknuepfung: nicht raten, sondern melden",
       a == [] and "klären" in gruende(u) and "02.10.2026" in gruende(u), (a, u))
a, u, _ = plan(person(D.Baustein(name="Kreise")), [eintrag(63, "Kreise")])
pruefe("T4 hier kein Termin: nichts senden (Uebernehmen geht ueber 'zuordnen')", a == [] and u == [], (a, u))

# ===========================================================================
# 4) Verknuepft: wer hat seit dem letzten Abgleich was geaendert?
# ===========================================================================
def verkn(d="2026-09-30", e=""):
    return {"id": 70, "datum": d, "ergebnis": e}


k = D.Baustein(name="Kreise", lzk_datum_1=D30, lzk_online_1=verkn())
a, u, _ = plan(person(k), [eintrag(70, "Kreise")])
pruefe("V1 nichts geaendert: nichts zu tun", a == [] and u == [], (a, u))
k = D.Baustein(name="Kreise", lzk_datum_1=date(2026, 10, 2), lzk_online_1=verkn())
a, u, _ = plan(person(k), [eintrag(70, "Kreise")])
pruefe("V2 HIER verschoben: das neue Datum geht hinaus",
       arten(a) == [("aendern", "Kreise", 1)] and a[0]["felder"] == {"datum": date(2026, 10, 2)}
       and a[0]["id"] == 70 and a[0]["link"]["datum"] == "2026-10-02" and a[0]["alt"] == D30, a)
k = D.Baustein(name="Kreise", lzk_datum_1=D30, lzk_online_1=verkn())
a, u, _ = plan(person(k), [eintrag(70, "Kreise", datum="2026-10-05")])
pruefe("V3 ONLINE verschoben: wird NICHT ueberschrieben, nur gemeldet",
       a == [] and "online auf 05.10.2026 verschoben" in gruende(u), (a, u))
k = D.Baustein(name="Kreise", lzk_datum_1=date(2026, 10, 5), lzk_online_1=verkn())
a, u, _ = plan(person(k), [eintrag(70, "Kreise", datum="2026-10-05")])
pruefe("V4 beide auf denselben Tag: nur die Verknuepfung nachziehen",
       arten(a) == [("verknuepfen", "Kreise", 1)] and a[0]["link"]["datum"] == "2026-10-05" and u == [], (a, u))
k = D.Baustein(name="Kreise", lzk_datum_1=date(2026, 10, 2), lzk_online_1=verkn())
a, u, _ = plan(person(k), [eintrag(70, "Kreise", datum="2026-10-05")])
pruefe("V5 beide verschieden verschoben: nichts senden, melden", a == [] and "beide geändert" in gruende(u), (a, u))
k = D.Baustein(name="Kreise", lzk_datum_1=D30, lzk_ergebnis_1="nicht_bestanden", lzk_online_1=verkn())
a, _, _ = plan(person(k), [eintrag(70, "Kreise")])
pruefe("V6 hier bewertet: das Ergebnis geht hinaus",
       arten(a) == [("aendern", "Kreise", 1)] and a[0]["felder"] == {"status": "nicht_bestanden", "pokale": 0}, a)
k = D.Baustein(name="Kreise", lzk_datum_1=D30, lzk_online_1=verkn())
a, u, _ = plan(person(k), [eintrag(70, "Kreise", status="bestanden", pokale=3)])
pruefe("V7 online bewertet: bleibt, gemeldet", a == [] and "online bewertet" in gruende(u), (a, u))
k = D.Baustein(name="Kreise", lzk_datum_1=D30, lzk_online_1=verkn(e="2"))
a, u, _ = plan(person(k), [eintrag(70, "Kreise", status="bestanden", pokale=2)])
pruefe("V8 hier die Bewertung entfernt: online bleibt sie", a == [] and "nicht mehr bewertet" in gruende(u), (a, u))
k = D.Baustein(name="Kreise", lzk_online_1=verkn())
a, u, _ = plan(person(k), [eintrag(70, "Kreise")])
pruefe("V9 hier das Datum entfernt: online wird nichts geloescht", a == [] and "streichen nur in OSKlar" in gruende(u), (a, u))
k = D.Baustein(name="Kreise", lzk_datum_1=date(2026, 10, 2), lzk_ergebnis_1="1", lzk_online_1=verkn())
a, _, _ = plan(person(k), [eintrag(70, "Kreise")])
pruefe("V10 Datum und Ergebnis zugleich", a and a[0]["felder"] == {"datum": date(2026, 10, 2), "status": "bestanden", "pokale": 1}, a)
k = D.Baustein(name="Kreise (Nachschreiben)", lzk_datum_1=date(2026, 10, 2), lzk_online_1=verkn())
a, _, _ = plan(person(k), [eintrag(70, "Kreise")])
pruefe("V11 die Verknuepfung gilt auch nach Umbenennen hier", arten(a) == [("aendern", "Kreise (Nachschreiben)", 1)]
       and a[0]["id"] == 70, a)

# Online geloescht
k = D.Baustein(name="Kreise", lzk_datum_1=D30, lzk_online_1=verkn())
a, u, _ = plan(person(k), [])
pruefe("G1 online geloescht, hier unveraendert: NICHT neu anlegen, melden", a == [] and "online gelöscht" in gruende(u), (a, u))
k = D.Baustein(name="Kreise", lzk_datum_1=date(2026, 10, 7), lzk_online_1=verkn())
a, _, _ = plan(person(k), [])
pruefe("G2 online geloescht, hier neu terminiert: neu anlegen", arten(a) == [("anlegen", "Kreise", 1)], a)
k = D.Baustein(name="Kreise", lzk_online_1=verkn())
a, u, _ = plan(person(k), [])
pruefe("G3 online weg und hier kein Termin: Verknuepfung loesen", arten(a) == [("verknuepfen", "Kreise", 1)]
       and a[0]["link"] is None and u == [], (a, u))

# ===========================================================================
# 5) Zuordnung (Menue "Freie Mathe-LZK zuordnen…") kennt die Verknuepfung
# ===========================================================================
k = D.Baustein(name="Kreise", lzk_datum_1=D30, lzk_online_1=verkn())
paare, offen = D.lt_freie_lzk_abgleich(person(k), {"lzk": [eintrag(70, "Kreise Zylinder", datum="2026-10-05")]})
pruefe("Z1 verknuepft: gefunden, obwohl online das Thema anders lautet", len(paare) == 1 and paare[0]["baustein"] is k, (paare, offen))
pruefe("Z1b und benennt die Seite, die geaendert hat", paare[0]["seite"] == "online" and paare[0]["link"] == verkn(), paare[0])
k2 = D.Baustein(name="Kreise", lzk_datum_1=D30, lzk_online_1=verkn())
paare, offen = D.lt_freie_lzk_abgleich(person(k, k2), {"lzk": [eintrag(70, "Kreise")]})
pruefe("Z2 dieselbe ID an zwei Plaetzen: nicht raten", paare == [] and "mehreren Bausteinen" in " ".join(offen), (paare, offen))
paare, offen = D.lt_freie_lzk_abgleich(person(k), {"lzk": [eintrag(70, "Kreise"), eintrag(71, "Kreise", datum="2026-11-01")]})
pruefe("Z3 eine zweite LZK gleichen Titels drängt die verknuepfte nicht weg",
       [x["id"] for x in paare] == [70] and "schon zu einer anderen LZK" in " ".join(offen), (paare, offen))
paare, _ = D.lt_freie_lzk_abgleich(person(D.Baustein(name="Kreise", lzk_datum_1=D30)), {"lzk": [eintrag(72, "Kreise")]})
pruefe("Z4 ohne Verknuepfung: Seite unbekannt", paare[0]["seite"] is None and paare[0]["link"] is None, paare)

# ===========================================================================
# 6) Der Client
# ===========================================================================
class Antwort:
    def __init__(self, daten):
        self.daten = daten
    def read(self):
        return self.daten
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False


gesendet = []


class Oeffner:
    def __init__(self, antworten):
        self.antworten = list(antworten)
    def open(self, req, timeout=None):
        daten = json.loads(req.data.decode("utf-8")) if req.data else None
        gesendet.append((req.get_method(), req.full_url, daten))
        antwort = self.antworten.pop(0)
        if isinstance(antwort, Exception):
            raise antwort
        return Antwort(json.dumps(antwort).encode("utf-8"))


c = O.AppClient("https://osk.example")
c.opener = Oeffner([[{"id": 3, "key": "englisch"}, {"id": 1, "key": "mathe"}], {"ok": True, "id": 99, "ids": [99]}])
pruefe("C1 die Fach-ID kommt aus /api/subjects", c.fach_id("mathe") == 1 and gesendet[-1][:2] == ("GET", "https://osk.example/api/subjects"), gesendet)
neu_id = c.lzk_anlegen(7, D30, "  Kreise ", "Basis", 1)
pruefe("C2 anlegen: POST /api/admin/lzk/eintrag, eine Person, getrimmter Titel",
       gesendet[-1] == ("POST", "https://osk.example/api/admin/lzk/eintrag",
                        {"userIds": [7], "subjectId": 1, "datum": "2026-09-30", "thema": "Kreise", "typ": "Basis"}), gesendet[-1])
pruefe("C2b die ID der neuen LZK kommt zurueck", neu_id == 99, neu_id)
import urllib.error  # noqa: E402
fehler_antwort = urllib.error.HTTPError("u", 404, "x", {}, io.BytesIO(
    json.dumps({"error": "Mindestens eine Person gehört nicht zu dieser Lerngruppe – nichts angelegt."}).encode("utf-8")))
c.opener = Oeffner([fehler_antwort])
try:
    c.lzk_anlegen(7, D30, "Kreise", "Basis", 1)
    pruefe("C3 ein Serverfehler kommt lesbar an", False)
except ValueError as e:
    pruefe("C3 ein Serverfehler kommt lesbar an", "Lerngruppe" in str(e), str(e))
for kaputt in ((None, D30, "Kreise"), (7, None, "Kreise"), (7, D30, "   ")):
    try:
        c.lzk_anlegen(kaputt[0], kaputt[1], kaputt[2], "Basis", 1)
        pruefe(f"C4 ohne Pflichtangabe {kaputt!r} wird nichts geschickt", False)
    except ValueError:
        pruefe(f"C4 ohne Pflichtangabe {kaputt!r} wird nichts geschickt", True)
c.opener = Oeffner([urllib.error.HTTPError("u", 409, "x", {}, io.BytesIO(b'{"error": "Hier ist keine Anfrage offen."}'))])
try:
    c.lzk_aendern(5, datum=D30)
    pruefe("C5 auch beim Aendern kommt der Grund an", False)
except ValueError as e:
    pruefe("C5 auch beim Aendern kommt der Grund an", "keine Anfrage offen" in str(e), str(e))

# ===========================================================================
# 7) Ausfuehren in der App
# ===========================================================================
class Client:
    def __init__(self, konten=None, scheitern=()):
        self.aufrufe = []
        self.naechste_id = 500
        self.konten = konten
        self.scheitern = set(scheitern)
    def fach_id(self, key):
        self.aufrufe.append(("fach_id", key))
        return 1
    def lzk_anlegen(self, user_id, datum, thema, typ, fach_id):
        self.aufrufe.append(("anlegen", user_id, datum, thema, typ, fach_id))
        if "anlegen" in self.scheitern:
            raise ValueError("Server weg")
        self.naechste_id += 1
        return self.naechste_id
    def lzk_aendern(self, lzk_id, **felder):
        self.aufrufe.append(("aendern", lzk_id, felder))
        if "aendern" in self.scheitern:
            raise ValueError("409 Konflikt")
        return {"ok": True}
    def lzk_setzen(self, *a):
        self.aufrufe.append(("setzen",) + a)
        return {"ok": True}
    def studierende(self):
        self.aufrufe.append(("studierende",))
        return self.konten


def app_mit(studenten, konten, client):
    app_ = A.App.__new__(A.App)
    app_.az = type("AZ", (), {"students": studenten})()
    app_._lt_konten = konten
    merk = {"ungespeichert": 0, "bericht": None, "dialog": None, "status": None, "info": None}
    app_._markiere_ungespeichert = lambda: merk.__setitem__("ungespeichert", merk["ungespeichert"] + 1)
    app_._detail_anzeigen = lambda: None
    app_._bericht = lambda t, x: merk.__setitem__("bericht", x)
    app_.wait_window = lambda d: None
    app_._dubletten_melden = lambda t: False
    app_._lt_paare = lambda: True
    app_._lt_anmelden = lambda still=False: (client, "M3M4")
    app_._ist_offline = lambda: False
    app_._lt_login_abgelehnt = False
    app_._lt_einstellungen_speichern = lambda w: merk.__setitem__("einstellung", w)
    app_.lzk_auto_var = type("V", (), {"wert": True, "get": lambda s: s.wert, "set": lambda s, w: setattr(s, "wert", w)})()
    app_.status_leiste = type("S", (), {"config": lambda s, text="": merk.__setitem__("status", text)})()
    return app_, merk


class DlgAttrappe:
    antwort = True
    zeilen = None
    def __init__(self, parent, aenderungen, uebersprungen, klasse, vergangen_text=""):
        DlgAttrappe.zeilen = list(aenderungen)
        DlgAttrappe.ueber = list(uebersprungen)
        DlgAttrappe.vergangen_text = vergangen_text
        self.result = DlgAttrappe.antwort


A.LzkSendenDialog = DlgAttrappe
A.messagebox.showinfo = lambda t, x, **k: MELDUNG.__setitem__("text", x)
A.messagebox.showwarning = lambda t, x, **k: MELDUNG.__setitem__("text", "WARNUNG " + x)
MELDUNG = {}

# Genau der gemeldete Fall: "Kreise", LZK 1 am 30.09., online noch nichts
kurz = date.today() + timedelta(days=5)
kreise = D.Baustein(name="Kreise", status="In Bearbeitung", lzk_datum_1=kurz)
gezeigt = D.Baustein(name="Glück & Zufall", lzk_datum_1=kurz + timedelta(days=1), lzk_ergebnis_1="3")
st = D.Student(vorname="Gabriel", nachname="E", alias="ga.em", bausteine=[kreise, gezeigt])
konten = [{"id": 7, "username": "ga.em", "aktiv": True, "lzk": []}]
client = Client(konten)
app_, merk = app_mit([st], konten, client)
app_._lt_serverstand = lambda c, neu_laden=False: (konten, {})
DlgAttrappe.antwort = True
app_.app_lzk_senden()
pruefe("E1 die Liste zeigt beide Termine vor dem Senden", [z["titel"] for z in DlgAttrappe.zeilen] == ["Kreise", "Glück & Zufall"],
       DlgAttrappe.zeilen)
angelegt = [x for x in client.aufrufe if x[0] == "anlegen"]
pruefe("E2 beide werden als freie Mathe-LZK angelegt",
       angelegt == [("anlegen", 7, kurz, "Kreise", "Basis", 1), ("anlegen", 7, kurz + timedelta(days=1), "Glück & Zufall", "Basis", 1)],
       client.aufrufe)
pruefe("E2b die Fach-ID wird nur einmal geholt", sum(1 for x in client.aufrufe if x[0] == "fach_id") == 1, client.aufrufe)
pruefe("E3 das Ergebnis geht direkt hinterher", ("aendern", 502, {"status": "bestanden", "pokale": 3}) in client.aufrufe, client.aufrufe)
pruefe("E4 beide Plaetze sind jetzt verknuepft",
       kreise.lzk_online_1 == {"id": 501, "datum": kurz.isoformat(), "ergebnis": ""}
       and gezeigt.lzk_online_1 == {"id": 502, "datum": (kurz + timedelta(days=1)).isoformat(), "ergebnis": "3"},
       (kreise.lzk_online_1, gezeigt.lzk_online_1))
pruefe("E4b und die Datei gilt als ungespeichert", merk["ungespeichert"] == 1, merk)
pruefe("E5 der gemerkte Serverstand kennt die neuen LZK", [(e["id"], e["thema"], e["status"], e["pokale"]) for e in konten[0]["lzk"]]
       == [(501, "Kreise", "ausstehend", 0), (502, "Glück & Zufall", "bestanden", 3)], konten[0]["lzk"])
pruefe("E6 die Meldung nennt die neu angelegten", "2 als freie Mathe-LZK neu angelegt" in MELDUNG.get("text", ""), MELDUNG)

# Zweiter Durchgang: nichts doppelt
client.aufrufe.clear()
app_.app_lzk_senden()
pruefe("E7 ein zweites Senden legt nichts doppelt an", not any(x[0] in ("anlegen", "aendern") for x in client.aufrufe), client.aufrufe)
pruefe("E7b und sagt, dass alles stimmt", "stimmen bereits" in (merk["bericht"] or ""), merk["bericht"])

# Hier verschoben -> nachziehen
kreise.lzk_datum_1 = kurz + timedelta(days=7)
client.aufrufe.clear()
app_.app_lzk_senden()
pruefe("E8 hier verschoben: das neue Datum geht per ID hinaus",
       [x for x in client.aufrufe if x[0] == "aendern"] == [("aendern", 501, {"datum": kurz + timedelta(days=7)})], client.aufrufe)
pruefe("E8b die Verknuepfung merkt sich das neue Datum", kreise.lzk_online_1["datum"] == (kurz + timedelta(days=7)).isoformat(), kreise.lzk_online_1)

# Abbrechen: nichts geht hinaus, nichts wird verknuepft
neu = D.Baustein(name="Volumen", lzk_datum_1=kurz)
st.bausteine.append(neu)
DlgAttrappe.antwort = None
client.aufrufe.clear()
app_.app_lzk_senden()
pruefe("E9 abgebrochen: nichts angelegt, nichts verknuepft",
       not any(x[0] in ("anlegen", "aendern") for x in client.aufrufe) and neu.lzk_online_1 is None, client.aufrufe)
DlgAttrappe.antwort = True

# Scheitert das Anlegen, bleibt hier alles, wie es war
client.scheitern = {"anlegen"}
client.aufrufe.clear()
app_.app_lzk_senden()
pruefe("E10 Anlegen scheitert: keine Verknuepfung, Fehler gemeldet",
       neu.lzk_online_1 is None and "Volumen" in MELDUNG.get("text", "") and MELDUNG["text"].startswith("WARNUNG"), MELDUNG)
client.scheitern = set()

# Scheitert nur das Ergebnis, ist die LZK trotzdem verknuepft - das Ergebnis geht beim naechsten Mal
neu.lzk_ergebnis_1 = "2"
client.scheitern = {"aendern"}
app_.app_lzk_senden()
pruefe("E11 Ergebnis scheitert: LZK verknuepft, Ergebnis noch offen",
       neu.lzk_online_1 and neu.lzk_online_1["ergebnis"] == "" and "das Ergebnis aber nicht" in MELDUNG.get("text", ""),
       (neu.lzk_online_1, MELDUNG))
client.scheitern = set()
client.aufrufe.clear()
app_.app_lzk_senden()
pruefe("E11b beim naechsten Senden geht das Ergebnis hinterher",
       [x for x in client.aufrufe if x[0] == "aendern"] == [("aendern", neu.lzk_online_1["id"], {"status": "bestanden", "pokale": 2})]
       and neu.lzk_online_1["ergebnis"] == "2", client.aufrufe)

# ===========================================================================
# 8) Automatisches Senden
# ===========================================================================
kurz2 = date.today() + timedelta(days=3)
b_auto = D.Baustein(name="Terme 1", lzk_datum_1=kurz2)
st2 = D.Student(vorname="Liam", nachname="P", alias="li.po", bausteine=[b_auto])
cache = [{"id": 8, "username": "li.po", "aktiv": True, "lzk": []}]
frisch = [{"id": 8, "username": "li.po", "aktiv": True, "lzk": []}]
client2 = Client(frisch)
app2, merk2 = app_mit([st2], cache, client2)
app2._lt_serverstand = lambda c, neu_laden=False: (cache, {})
DlgAttrappe.zeilen = None
app2._lzk_auto_senden()
pruefe("U1 vor dem Anlegen wird der frische Stand geholt", client2.aufrufe[0] == ("studierende",), client2.aufrufe)
pruefe("U2 wenige Termine gehen ohne Rueckfrage hinaus", DlgAttrappe.zeilen is None
       and ("anlegen", 8, kurz2, "Terme 1", "Basis", 1) in client2.aufrufe, client2.aufrufe)
pruefe("U3 die Statuszeile nennt das Anlegen", "neu angelegt" in (merk2["status"] or ""), merk2["status"])
pruefe("U3b verknuepft und ungespeichert", b_auto.lzk_online_1 is not None and merk2["ungespeichert"] == 1, merk2)
client2.aufrufe.clear()
app2._lzk_auto_senden()
pruefe("U4 danach ist nichts mehr zu tun - und es wird nicht einmal frisch geholt", client2.aufrufe == [], client2.aufrufe)

# Inzwischen hat jemand anders dieselbe LZK angelegt: frischer Stand verhindert die Dublette
b_x = D.Baustein(name="Kreise", lzk_datum_1=kurz2)
st3 = D.Student(vorname="Ida", nachname="J", alias="id.ja", bausteine=[b_x])
cache3 = [{"id": 9, "username": "id.ja", "aktiv": True, "lzk": []}]
frisch3 = [{"id": 9, "username": "id.ja", "aktiv": True, "lzk": [eintrag(900, "Kreise", datum=kurz2.isoformat())]}]
client3 = Client(frisch3)
app3, merk3 = app_mit([st3], cache3, client3)
app3._lt_serverstand = lambda c, neu_laden=False: (cache3, {})
app3._lzk_auto_senden()
pruefe("U5 auf frischem Stand: nicht doppelt anlegen, sondern verknuepfen",
       not any(x[0] == "anlegen" for x in client3.aufrufe) and b_x.lzk_online_1 and b_x.lzk_online_1["id"] == 900, client3.aufrufe)
pruefe("U5b der gemerkte Stand kennt die LZK jetzt", [e["id"] for e in cache3[0]["lzk"]] == [900], cache3)

# Viele auf einmal: erst fragen
viele = [D.Baustein(name=f"Baustein {i}", lzk_datum_1=kurz2) for i in range(6)]
st4 = D.Student(vorname="Merle", nachname="V", alias="me.vo", bausteine=viele)
cache4 = [{"id": 10, "username": "me.vo", "aktiv": True, "lzk": []}]
client4 = Client([{"id": 10, "username": "me.vo", "aktiv": True, "lzk": []}])
app4, merk4 = app_mit([st4], cache4, client4)
app4._lt_serverstand = lambda c, neu_laden=False: (cache4, {})
DlgAttrappe.antwort = None
app4._lzk_auto_senden()
pruefe("U6 mehr als 5 Termine: erst die Liste zeigen", DlgAttrappe.zeilen is not None and len(DlgAttrappe.zeilen) == 6, DlgAttrappe.zeilen)
pruefe("U6b abgelehnt: nichts gesendet, Automatik aus", not any(x[0] == "anlegen" for x in client4.aufrufe)
       and app4.lzk_auto_var.get() is False, client4.aufrufe)
DlgAttrappe.antwort = True

# Online verschoben, hier unveraendert: die Automatik laesst es stehen
b_o = D.Baustein(name="Kreise", lzk_datum_1=kurz2, lzk_online_1={"id": 950, "datum": kurz2.isoformat(), "ergebnis": ""})
st5 = D.Student(vorname="Finn", nachname="K", alias="fi.kl", bausteine=[b_o])
cache5 = [{"id": 11, "username": "fi.kl", "aktiv": True, "lzk": [eintrag(950, "Kreise", datum=(kurz2 + timedelta(days=2)).isoformat())]}]
client5 = Client(cache5)
app5, _ = app_mit([st5], cache5, client5)
app5._lt_serverstand = lambda c, neu_laden=False: (cache5, {})
app5._lzk_auto_senden()
pruefe("U7 online verschoben: die Automatik schickt NICHT das alte Datum", client5.aufrufe == [] and b_o.lzk_datum_1 == kurz2, client5.aufrufe)

# ===========================================================================
# 9) Baustein-Formular: die Verknuepfung geht beim Bearbeiten nicht verloren
# ===========================================================================
class Var:
    def __init__(self, w):
        self.w = w
    def get(self):
        return self.w


dlg = A.BausteinDialog.__new__(A.BausteinDialog)
dlg.vars = {"name": Var("Kreise"), "status": Var("In Bearbeitung"), "bausteinarbeit": Var(""),
            "lzk_datum_1": Var("02.10.2026"), "lzk_note_1": Var(""), "lzk_ergebnis_1": Var(D.LZK_ERGEBNIS_TEXT[""]),
            "lzk_bem_1": Var(""), "lzk_datum_2": Var(""), "lzk_note_2": Var(""),
            "lzk_ergebnis_2": Var(D.LZK_ERGEBNIS_TEXT[""]), "lzk_bem_2": Var(""), "halbjahr": Var("2627_1"),
            "bemerkung": Var("")}
dlg._verknuepfung = ({"id": 70, "datum": "2026-09-30", "ergebnis": ""}, None)
dlg.destroy = lambda: None
dlg._uebernehmen()
pruefe("F1 nach dem Bearbeiten ist die Verknuepfung noch da (und das Datum neu)",
       dlg.result.lzk_online_1 == {"id": 70, "datum": "2026-09-30", "ergebnis": ""} and dlg.result.lzk_datum_1 == date(2026, 10, 2),
       dlg.result)
quelle = io.open(os.path.join(NEU, "arbeitsstaende_app.py"), encoding="utf-8").read()
pruefe("F2 das Formular liest die Verknuepfung aus dem Baustein",
       "self._verknuepfung = (b.lzk_online_1, b.lzk_online_2)" in quelle)
a, _, _ = plan(person(dlg.result), [eintrag(70, "Kreise")])
pruefe("F3 und das Senden erkennt die Aenderung als hier gemacht",
       arten(a) == [("aendern", "Kreise", 1)] and a[0]["felder"] == {"datum": date(2026, 10, 2)}, a)

print("\n%d Pruefungen bestanden." % ok)
