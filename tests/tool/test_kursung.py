"""Prueft den Kursungs-Abgleich zwischen Liste und Lerntheken-App."""
import importlib.util
import os
import sys

from pfade import WERKZEUG  # noqa: E402
QUELLE = os.path.join(WERKZEUG, "arbeitsstaende_app.py")
spec = importlib.util.spec_from_file_location("kuapp", QUELLE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
quelle = open(QUELLE, encoding="utf-8").read()
sync = open(os.path.join(WERKZEUG, "osk_sync.py"), encoding="utf-8").read()

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
# A) Unterschiede finden - die Logik aus kursungen_abgleichen nachstellen
# ===========================================================================
def unterschiede_von(students, konten):
    """Genau der Block aus kursungen_abgleichen(), hier isoliert nachgestellt."""
    je_konto = {(k.get("username") or "").lower(): k
                for k in konten if k.get("aktiv", True)}
    unterschiede, ohne_alias = [], []
    for s in students:
        alias = s.alias.strip().lower()
        konto = je_konto.get(alias) if alias else None
        if not konto:
            ohne_alias.append(f"{s.voller_name} ({alias or 'kein Alias'})")
            continue
        hier = (s.kursung or "").strip().upper()
        dort = (konto.get("kurs") or "").strip().upper()
        if hier != dort:
            unterschiede.append((s, konto, hier, dort))
    return unterschiede, ohne_alias


def person(vn, alias, kursung=""):
    return mod.Student(vorname=vn, nachname="T", alias=alias, kursung=kursung)


def konto(alias, kurs, aktiv=True, kid=1):
    return {"id": kid, "username": alias, "kurs": kurs, "aktiv": aktiv}


ben, mara, finn = person("Ben", "be.ja", "E"), person("Mara", "ma.ba", "G"), person("Finn", "fi.ko")
u, o = unterschiede_von([ben, mara, finn],
                        [konto("be.ja", "E", kid=1), konto("ma.ba", "E", kid=2), konto("fi.ko", "G", kid=3)])
pruefe("A1 gleiche Kursung ist kein Unterschied",
       all(s is not ben for s, *_ in u), [s.voller_name for s, *_ in u])
pruefe("A2 abweichende Kursung wird gefunden",
       any(s is mara and h == "G" and d == "E" for s, _k, h, d in u), u)
pruefe("A3 leer hier vs. gesetzt online zaehlt auch als Unterschied",
       any(s is finn and h == "" and d == "G" for s, _k, h, d in u), u)
pruefe("A4 wer kein Konto hat, bleibt aussen vor", o == [])

u2, o2 = unterschiede_von([person("Ohne", "", "E"), person("Fremd", "xx.yy", "E")], [konto("be.ja", "E")])
pruefe("A5 ohne Alias und ohne passendes Konto -> gemeldet, nicht abgeglichen",
       u2 == [] and len(o2) == 2 and "kein Alias" in o2[0], o2)

u3, _ = unterschiede_von([ben], [konto("be.ja", "G", aktiv=False)])
pruefe("A6 passive Konten werden uebersprungen", u3 == [], u3)

u4, _ = unterschiede_von([person("Klein", "kl.ein", "e")], [konto("kl.ein", "E")])
pruefe("A7 Gross-/Kleinschreibung erzeugt keinen Schein-Unterschied", u4 == [], u4)


# ===========================================================================
# B) Der Dialog: Richtung waehlen
# ===========================================================================
class Attrappe:
    def __init__(self):
        self.eintraege = []
        self.state = ""
    def insert(self, _pos, text):
        self.eintraege.append(text)
    def config(self, **kw):
        if "state" in kw:
            self.state = kw["state"]
    def pack(self, **kw):
        pass


def mach_dialog(unterschiede, ohne=()):
    d = mod.KursungAbgleichDialog.__new__(mod.KursungAbgleichDialog)
    d.result = None
    d.destroy = lambda: None
    d.liste = Attrappe()
    d.btn_holen, d.btn_senden = Attrappe(), Attrappe()
    return d


d = mach_dialog([])
d._waehlen("server_zu_liste")
pruefe("B1 Richtung Server -> Liste wird gemerkt", d.result == "server_zu_liste")
d = mach_dialog([])
d._waehlen("liste_zu_server")
pruefe("B2 Richtung Liste -> Server ebenso", d.result == "liste_zu_server")
pruefe("B3 ohne Auswahl bleibt es bei None", mach_dialog([]).result is None)

dlg_quelle = quelle.split("class KursungAbgleichDialog")[1].split("\nclass ")[0]
pruefe("B4 beide Richtungen stehen zur Wahl",
       "server_zu_liste" in dlg_quelle and "liste_zu_server" in dlg_quelle)
pruefe("B5 ohne Unterschiede sind beide Knoepfe aus",
       'self.btn_holen.config(state="disabled")' in dlg_quelle, dlg_quelle[-400:])
pruefe("B6 der Dialog warnt vor dem Ueberschreiben",
       "überschreibt die andere Seite" in dlg_quelle, "")
pruefe("B7 und sagt, dass es nur um Mathe geht",
       "nur die Mathe-Kursung" in dlg_quelle, "")
pruefe("B8 der Unterschied steht mit beiden Werten da",
       "hier {hier or '–'}" in dlg_quelle and "online {dort or '–'}" in dlg_quelle, "")


# ===========================================================================
# C) Der Ablauf
# ===========================================================================
ablauf = quelle.split("def kursungen_abgleichen")[1].split("\n    def alias_umbenennen")[0]
pruefe("C1 Richtung Server->Liste schreibt in Student.kursung",
       "s.kursung = dort" in ablauf, "")
pruefe("C1b und meldet die Datei als ungespeichert",
       "self._markiere_ungespeichert()" in ablauf)
pruefe("C1c die Liste und das Detailfeld werden nachgezogen",
       "self._liste_aktualisieren()" in ablauf and "self.f_kursung.set(" in ablauf)
pruefe("C2 Richtung Liste->Server nutzt kurs_setzen",
       "client.kurs_setzen(konto[\"id\"], hier)" in ablauf, "")
pruefe("C3 ein leeres Feld hier loescht online NICHTS",
       'if hier not in ("E", "G"):' in ablauf and "leer.append" in ablauf, "")
pruefe("C4 ein Fehler bricht die uebrigen nicht ab",
       "fehler.append" in ablauf and "continue" in ablauf)
pruefe("C5 Fehler bleiben modal, der Rest geht in den Bericht",
       "messagebox.showwarning" in ablauf and "self._bericht(" in ablauf)
pruefe("C6 der Menuepunkt ist verdrahtet",
       'label="Kursungen abgleichen…"' in quelle and "command=self.kursungen_abgleichen" in quelle)

# Client
pruefe("D1 kurs_setzen spricht den Kurs-Endpunkt an",
       '"/api/admin/set-kurs"' in sync and '"userId": user_id' in sync, "")
pruefe("D2 und laesst nur E/G zu",
       'if kurs not in ("E", "G")' in sync, "")
pruefe("D3 ohne subjectId trifft es Mathe - das ist dokumentiert",
       "Ohne subjectId nimmt der Endpunkt Mathe" in sync, "")

print("\n%d Pruefungen bestanden." % ok)
