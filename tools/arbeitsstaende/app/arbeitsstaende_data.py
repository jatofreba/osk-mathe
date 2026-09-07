# -*- coding: utf-8 -*-
"""
Datenschicht der Arbeitsstände-Anwendung.

Enthält ausschließlich Lade-/Speicherlogik und das Datenmodell -- keine
GUI-Abhängigkeit. Dadurch lässt sich diese Datei vollständig ohne Fenster
testen (siehe test_arbeitsstaende_data.py).
"""
from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import List, Optional

from openpyxl import Workbook, load_workbook
from openpyxl.worksheet.worksheet import Worksheet
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

STATUS_OPTIONEN = ["Ausstehend", "In Bearbeitung", "Abgeschlossen", "Nicht bestanden", "Sonstiges"]
KURSUNG_OPTIONEN = ["", "E", "G"]

BAUSTEIN_SPALTEN = [
    "name", "status", "bausteinarbeit",
    "lzk_datum_1", "lzk_note_1", "lzk_datum_2", "lzk_note_2",
    "halbjahr", "bemerkung", "lzk_bem_1", "lzk_bem_2",
]

STATUS_FARBEN = {
    "Abgeschlossen": "C6EFCE",
    "In Bearbeitung": "FFEB9C",
    "Nicht bestanden": "FFC7CE",
    "Ausstehend": "F2F2F2",
    "Sonstiges": "D9D2E9",
}


def _to_date(value):
    """Excel/openpyxl liefert Daten manchmal als datetime, manchmal als Text."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%m/%d/%y", "%m/%d/%Y"):
            try:
                return datetime.strptime(value.strip(), fmt).date()
            except ValueError:
                continue
    return None


# Halbjahre werden genauso gebildet wie in der Lerntheken-App (server.js,
# halbjahrForDate): Schuljahr laeuft ab August, Format "<StartJJ><EndJJ>_<1|2>".
# Der Januar zaehlt noch zum ERSTEN Halbjahr des im August gestarteten Jahres.
def halbjahr_fuer_datum(d: Optional[date] = None) -> str:
    d = d or date.today()
    m, y = d.month, d.year
    if m >= 8:
        start, sem = y, 1
    elif m == 1:
        start, sem = y - 1, 1
    else:
        start, sem = y - 1, 2
    return f"{str(start)[-2:]}{str(start + 1)[-2:]}_{sem}"


def halbjahr_optionen(zusaetzlich=(), jahre_zurueck: int = 3, jahre_vor: int = 1):
    """Auswahlliste fuer das Halbjahr-Feld, neueste zuerst.

    `zusaetzlich` nimmt Werte auf, die schon in der Datei stehen -- sonst waere
    ein alter oder von Hand gesetzter Wert im Dropdown nicht enthalten und beim
    Bearbeiten still verloren.
    """
    heute = date.today()
    startjahr = heute.year if heute.month >= 8 else heute.year - 1
    optionen = []
    for jahr in range(startjahr - jahre_zurueck, startjahr + jahre_vor + 1):
        for sem in (1, 2):
            optionen.append(f"{str(jahr)[-2:]}{str(jahr + 1)[-2:]}_{sem}")
    for wert in zusaetzlich:
        wert = (wert or "").strip()
        if wert and wert not in optionen:
            optionen.append(wert)
    return sorted(set(optionen), reverse=True)


# Erste Zeile der Bemerkung bei Zeilen, die aus der Lerntheken-App stammen.
# Nur solche Zeilen werden bei einem erneuten Abruf angefasst -- von Hand
# gepflegte Bausteine bleiben dadurch garantiert unberuehrt, selbst wenn sie
# zufaellig genauso heissen.
LT_MARKER = "[Lerntheken-App]"

# Name der Talk-Zeile; das Halbjahr wird angehaengt (z.B. "Mathe-Talks 2627_1").
LT_TALK_NAME = "Mathe-Talks"


def _ist_app_zeile(baustein) -> bool:
    return (baustein.bemerkung or "").lstrip().startswith(LT_MARKER)


def _fmt_kurz(datum) -> str:
    d = _to_date(datum)
    return d.strftime("%d.%m.%Y") if d else ""


def _erledigte_stationen(progress: dict, key: str) -> int:
    """Anzahl erledigter Stationen aus dem Fortschritt einer Lerntheke.

    Der Wert ist ein JSON-Array mit den IDs der erledigten Stationen; Abgabe-
    und Zwischenspeicher-Schluessel gehoeren nicht dazu.
    """
    roh = (progress or {}).get(key)
    if not roh:
        return 0
    if isinstance(roh, str):
        try:
            roh = json.loads(roh)
        except ValueError:
            return 0
    return len(roh) if isinstance(roh, list) else 0


def lt_lerntheke_zeilen(progress: dict, lzk_liste, lerntheken, aktuelles_hj: str):
    """Eine Zeile je Lerntheke, an der tatsaechlich gearbeitet wurde.

    Grundlage ist der GESAMTSTAND (erledigte Stationen aus dem Fortschritt) plus
    die LZK-Eintraege -- nicht das Stations-Ereignislog, das erst seit seiner
    Einfuehrung Daten hat.

    Halbjahr-Zuordnung: das Halbjahr der (frueheren) LZK, sonst das laufende --
    fuer den reinen Stationsfortschritt gibt es kein Datum.
    """
    lzk_je_lerntheke = {}
    for l in lzk_liste or []:
        lzk_je_lerntheke.setdefault(l.get("lerntheke"), []).append(l)

    zeilen = []
    for lt in lerntheken:
        key = lt.get("key")
        if not key:
            continue
        erledigt = _erledigte_stationen(progress, key)
        lzks = lzk_je_lerntheke.get(key, [])
        if not erledigt and not lzks:
            continue                      # nie angefasst -> keine Zeile

        basis = next((l for l in lzks if l.get("typ") == "Basis"), None)
        aufbau = next((l for l in lzks if l.get("typ") == "Aufbau"), None)

        teile = []
        if erledigt:
            gesamt = lt.get("total") or 0
            teile.append(f"{erledigt} von {gesamt} Stationen erledigt" if gesamt
                         else f"{erledigt} Stationen erledigt")
        for l in (basis, aufbau):
            if not l:
                continue
            stand = {"bestanden": "bestanden",
                     "nicht_bestanden": "nicht bestanden"}.get(l.get("status"), "geplant")
            pk = l.get("pokale") or 0
            teile.append(f"{l.get('typ')}-LZK {stand}"
                         + (f", {pk} Kleeblaetter" if pk else "")
                         + (f" ({_fmt_kurz(l.get('datum'))})" if l.get("datum") else ""))

        if aufbau and aufbau.get("status") == "bestanden":
            status = "Abgeschlossen"
        elif any(l.get("status") == "nicht_bestanden" for l in lzks):
            status = "Nicht bestanden"
        else:
            status = "In Bearbeitung"

        # Halbjahr aus dem juengsten LZK-Datum, sonst das laufende Halbjahr.
        daten = [_to_date(l.get("datum")) for l in lzks if l.get("datum")]
        halbjahr = halbjahr_fuer_datum(max(d for d in daten if d)) if any(daten) else aktuelles_hj

        zeilen.append({
            "name": lt.get("title") or key,
            "halbjahr": halbjahr,
            "lzk_datum_1": _to_date(basis.get("datum")) if basis else None,
            "lzk_datum_2": _to_date(aufbau.get("datum")) if aufbau else None,
            "status": status,
            "bemerkung": " · ".join(teile),
        })
    zeilen.sort(key=lambda z: (z["halbjahr"], z["name"]))
    return zeilen


def lt_talk_zeile(bucket: dict, fach_key: str = "mathe") -> Optional[str]:
    """Bemerkungstext fuer die Talk-/Input-Zeile eines Halbjahres, oder None."""
    sub = (bucket.get("bySubject") or {}).get(fach_key) or {}
    geh = sub.get("talksPresented", 0) or 0
    zug = sub.get("talksListened", 0) or 0
    inp = sub.get("inputParticipated", 0) or 0
    klee = (sub.get("pokalePresented", 0) or 0) + (sub.get("pokaleListened", 0) or 0)
    if not (geh or zug or inp or klee):
        return None
    teile = []
    if geh:
        teile.append(f"{geh}x gehalten")
    if zug:
        teile.append(f"{zug}x zugehoert")
    if inp:
        teile.append(f"{inp}x Input")
    if klee:
        teile.append(f"{klee} Kleeblaetter")
    return ", ".join(teile)


def lt_zeilen_aktualisieren(student, by_halbjahr: dict, progress: dict,
                            lzk_liste, lerntheken, stand: str = ""):
    """Traegt die App-Ergebnisse als Bausteinzeilen ein.

    Je bearbeiteter Lerntheke eine Zeile (Gesamtstand + LZK) und je Halbjahr
    eine fuer Talks/Input.

    Angefasst werden ausschliesslich Zeilen mit LT_MARKER in der Bemerkung.
    Von Hand gepflegte Bausteine bleiben unberuehrt -- auch namensgleiche.
    Noten und ein manuell geaenderter Status werden nie ueberschrieben: Noten
    traegt die Lernbegleitung ein, die App kennt keine.
    """
    neu = aktualisiert = 0

    def _setze(name, halbjahr, bemerkung, status=None, lzk1=None, lzk2=None):
        nonlocal neu, aktualisiert
        text = f"{LT_MARKER} {bemerkung}" + (f" (Stand {stand})" if stand else "")
        vorhanden = next((b for b in student.bausteine
                          if b.name == name and b.halbjahr == halbjahr
                          and _ist_app_zeile(b)), None)
        if vorhanden:
            vorhanden.bemerkung = text
            if lzk1 is not None:
                vorhanden.lzk_datum_1 = lzk1
            if lzk2 is not None:
                vorhanden.lzk_datum_2 = lzk2
            aktualisiert += 1
        else:
            student.bausteine.append(Baustein(
                name=name, status=status or "Sonstiges", halbjahr=halbjahr,
                lzk_datum_1=lzk1, lzk_datum_2=lzk2, bemerkung=text))
            neu += 1

    aktuelles_hj = halbjahr_fuer_datum()
    for z in lt_lerntheke_zeilen(progress, lzk_liste, lerntheken, aktuelles_hj):
        _setze(z["name"], z["halbjahr"], z["bemerkung"], z["status"],
               z["lzk_datum_1"], z["lzk_datum_2"])

    for hj in sorted((by_halbjahr or {}).keys()):
        talk = lt_talk_zeile(by_halbjahr[hj] or {})
        if talk:
            _setze(f"{LT_TALK_NAME} {hj}", hj, talk, "Sonstiges")

    return neu, aktualisiert


def alias_vorschlag(vorname: str, nachname: str) -> str:
    """Vorschlag fuer den Lerntheken-Alias: erste 2 Buchstaben des Vornamens,
    Punkt, erste 2 Buchstaben des Nachnamens -- "Anton Berger" -> "an.be".

    Nur ein VORSCHLAG: bei Namensgleichheit muss von Hand nachgebessert werden.
    """
    ersetzungen = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss",
                   "Ä": "Ae", "Ö": "Oe", "Ü": "Ue"}
    def norm(t):
        for a, b in ersetzungen.items():
            t = t.replace(a, b)
        t = unicodedata.normalize("NFKD", t)
        t = "".join(z for z in t if not unicodedata.combining(z))
        return "".join(c for c in t.strip().lower() if c.isalnum())
    v, n = norm(vorname), norm(nachname)
    if not v or not n:
        return ""
    return f"{v[:2]}.{n[:2]}"


def _clean(value):
    if value is None:
        return ""
    return str(value).strip()


@dataclass
class Baustein:
    name: str = ""
    status: str = "Ausstehend"
    bausteinarbeit: str = ""
    lzk_datum_1: Optional[date] = None
    lzk_note_1: str = ""
    lzk_datum_2: Optional[date] = None
    lzk_note_2: str = ""
    halbjahr: str = ""
    bemerkung: str = ""
    # Notiz zur jeweiligen LZK (z.B. "nur Teil 1 geschrieben", "Nachschreibtermin")
    lzk_bem_1: str = ""
    lzk_bem_2: str = ""


@dataclass
class Student:
    vorname: str
    nachname: str
    # Benutzername in der Lerntheken-App ("Lerntheken-Alias"). Wird im
    # Namen-Blatt gepflegt und ist die verbindliche Zuordnung zwischen dieser
    # Liste und der App -- bewusst NICHT jedes Mal aus dem Namen abgeleitet,
    # weil zwei Personen denselben Kurznamen ergeben koennen (Anton Berger /
    # Anna Bergmann -> beide "an.be") und Namen sich aendern.
    alias: str = ""
    kursung: str = ""
    jahrgangsstufe: Optional[int] = None
    letzter_besuch_fb: Optional[date] = None
    hj_note: str = ""
    # Frei setzbare Frist neben den LZK-Terminen (Referat abgeben, Material
    # drucken, ...). Die Bemerkung ist zugleich der Anlass, der in der Uebersicht
    # neben dem Datum steht.
    sonstige_deadline: Optional[date] = None
    sonstige_deadline_bemerkung: str = ""
    bausteine: List[Baustein] = field(default_factory=list)
    # Name des Original-Arbeitsblatts, falls aus einer Datei geladen.
    # Wird für gezieltes Aktualisieren beim Speichern gebraucht.
    _quellblatt: Optional[str] = None
    # Volle FB-Besuchshistorie (ein Eintrag pro Tag). Wird aus dem
    # Anwesenheits-Raster im Namen-Blatt gelesen/geschrieben und ist die
    # Grundlage für "letzter_besuch_fb" sowie für den Schnell-Eintrag
    # ("War heute im FB" / "Nachtragen") in der Oberfläche.
    fb_besuche: List[date] = field(default_factory=list)

    def fb_besuch_eintragen(self, tag: date):
        if tag not in self.fb_besuche:
            self.fb_besuche.append(tag)
            self.fb_besuche.sort()
        if self.letzter_besuch_fb is None or tag > self.letzter_besuch_fb:
            self.letzter_besuch_fb = tag

    @property
    def voller_name(self) -> str:
        return f"{self.vorname} {self.nachname}".strip()


class Arbeitsstaende:
    """Hält den kompletten Datenbestand und kapselt Laden/Speichern."""

    def __init__(self):
        self.students: List[Student] = []
        self.vorlage_bausteine: List[str] = []
        self.dateipfad: Optional[str] = None
        self._wb: Optional[Workbook] = None  # zuletzt geladene/erzeugte Mappe

    # ------------------------------------------------------------------
    # Laden
    # ------------------------------------------------------------------
    def laden(self, pfad: str) -> List[str]:
        """Lädt eine bestehende Arbeitsstände-Datei. Gibt eine Liste von
        Warnungen zurück (z.B. übersprungene Blätter)."""
        warnungen: List[str] = []
        wb = load_workbook(pfad, data_only=False)
        self._wb = wb
        self.dateipfad = pfad

        vorlage_name = next(
            (n for n in wb.sheetnames if n.lower().startswith("vorlage")), None
        )
        namen_sheet = "Namen" if "Namen" in wb.sheetnames else None

        schueler_bloetter = [
            n for n in wb.sheetnames
            if n != namen_sheet and n != vorlage_name
        ]

        self.vorlage_bausteine = []
        if vorlage_name:
            self.vorlage_bausteine = self._lies_baustein_namen(wb[vorlage_name])
        else:
            warnungen.append("Kein Vorlage-Blatt gefunden -- Standard-Bausteinliste ist leer.")

        self.students = []
        besuche_by_row = {}
        alias_by_name = {}
        if namen_sheet:
            ws_namen = wb[namen_sheet]
            letzte_spalte = ws_namen.max_column
            # Altes Layout: Raster ab Spalte H. Neues Layout: H = "Anlass",
            # Raster ab Spalte I. Unterscheidbar am Inhalt von H1.
            raster_start = 8 if _to_date(ws_namen.cell(row=1, column=8).value) else 9
            if letzte_spalte >= raster_start:
                spalten_daten = [_to_date(ws_namen.cell(row=1, column=c).value)
                                  for c in range(raster_start, letzte_spalte + 1)]
                for row in range(2, ws_namen.max_row + 1):
                    vn = _clean(ws_namen.cell(row=row, column=1).value)
                    nn = _clean(ws_namen.cell(row=row, column=2).value)
                    if not vn and not nn:
                        continue
                    besuche = []
                    for j, spaltendatum in enumerate(spalten_daten):
                        if spaltendatum is None:
                            continue
                        wert = ws_namen.cell(row=row, column=raster_start + j).value
                        if wert in (1, "1", True):
                            besuche.append(spaltendatum)
                    besuche_by_row[row] = sorted(besuche)

            # Lerntheken-Alias (Spalte C) namensgebunden einlesen -- bewusst in
            # einer EIGENEN Schleife: das Anwesenheitsraster oben laeuft nur,
            # wenn es ueberhaupt Besuchsspalten gibt (max_column >= 8). Haengte
            # der Alias dort mit drin, ginge er in einer Datei ohne Besuche
            # still verloren. Spalte C war bisher ungenutzt, das Raster ab
            # Spalte H verschiebt sich also nicht.
            for row in range(2, ws_namen.max_row + 1):
                vn = _clean(ws_namen.cell(row=row, column=1).value)
                nn = _clean(ws_namen.cell(row=row, column=2).value)
                alias = _clean(ws_namen.cell(row=row, column=3).value)
                if alias and (vn or nn):
                    alias_by_name[f"{vn} {nn}".strip()] = alias

        for idx, sheetname in enumerate(schueler_bloetter):
            ws = wb[sheetname]
            student = self._lies_schueler(ws, sheetname)
            if student is None:
                warnungen.append(f"Blatt '{sheetname}' sieht nicht wie ein Schülerblatt aus -- übersprungen.")
                continue
            # Besuchshistorie anhand der Zeilenposition beim Einlesen
            # übernehmen (Blattreihenfolge == Ausgangszustand in "Namen");
            # ab sofort ist die Zuordnung namensgebunden (siehe Student),
            # eine geänderte Reihenfolge kann diese Werte also nicht mehr
            # der falschen Person zuschlagen.
            student.fb_besuche = besuche_by_row.get(idx + 2, [])
            student.alias = alias_by_name.get(student.voller_name, "")
            # Ein manuell eingetragenes "Letzter Besuch"-Datum, das nicht im
            # Raster auftaucht, nicht verwerfen.
            if student.letzter_besuch_fb and student.letzter_besuch_fb not in student.fb_besuche:
                student.fb_besuche.append(student.letzter_besuch_fb)
                student.fb_besuche.sort()
            if student.fb_besuche:
                student.letzter_besuch_fb = student.fb_besuche[-1]
            self.students.append(student)

        return warnungen

    def _lies_baustein_namen(self, ws: Worksheet) -> List[str]:
        namen = []
        for row in range(4, ws.max_row + 1):
            name = _clean(ws.cell(row=row, column=1).value)
            if name:
                namen.append(name)
        return namen

    def _lies_schueler(self, ws: Worksheet, sheetname: str) -> Optional[Student]:
        # Name: zuverlässig aus dem Blattnamen ableiten (Vorname zuerst,
        # so wie es die Personenblätter selbst auch tun) -- nicht aus der
        # "Namen"-Übersicht, die in anonymisierten/älteren Dateien nicht
        # zuverlässig mit den Blättern übereinstimmt.
        teile = sheetname.split(" ", 1)
        if len(teile) < 2:
            return None
        vorname, nachname = teile[0], teile[1]

        kursung = _clean(ws.cell(row=1, column=4).value)
        jahrgang_raw = ws.cell(row=1, column=6).value
        try:
            jahrgang = int(jahrgang_raw) if jahrgang_raw not in (None, "") else None
        except (ValueError, TypeError):
            jahrgang = None
        letzter_besuch = _to_date(ws.cell(row=2, column=2).value)
        hj_note = _clean(ws.cell(row=2, column=4).value)
        sonstige_deadline = _to_date(ws.cell(row=2, column=6).value)
        sonstige_bem = _clean(ws.cell(row=2, column=8).value)

        bausteine = []
        for row in range(4, ws.max_row + 1):
            werte = [ws.cell(row=row, column=c).value for c in range(1, 12)]
            name = _clean(werte[0])
            if not name:
                # Leere "Ausstehend"-Platzzeilen aus der Vorlage (Name leer,
                # aber Status vorbelegt) sind keine echten Bausteine.
                continue
            b = Baustein(
                name=name,
                status=_clean(werte[1]) or "Ausstehend",
                bausteinarbeit=_clean(werte[2]),
                lzk_datum_1=_to_date(werte[3]),
                lzk_note_1=_clean(werte[4]),
                lzk_datum_2=_to_date(werte[5]),
                lzk_note_2=_clean(werte[6]),
                halbjahr=_clean(werte[7]),
                bemerkung=_clean(werte[8]),
                lzk_bem_1=_clean(werte[9]),
                lzk_bem_2=_clean(werte[10]),
            )
            bausteine.append(b)

        return Student(
            vorname=vorname, nachname=nachname, kursung=kursung,
            jahrgangsstufe=jahrgang, letzter_besuch_fb=letzter_besuch,
            hj_note=hj_note, sonstige_deadline=sonstige_deadline,
            sonstige_deadline_bemerkung=sonstige_bem,
            bausteine=bausteine, _quellblatt=sheetname,
        )

    # ------------------------------------------------------------------
    # Neu anlegen (falls keine Datei existiert)
    # ------------------------------------------------------------------
    def neu(self, standard_bausteine: List[str]):
        self._wb = None
        self.dateipfad = None
        self.students = []
        self.vorlage_bausteine = list(standard_bausteine)

    # ------------------------------------------------------------------
    # Fristen-Logik (portiert aus dem ursprünglichen VBA-Makro
    # "NaechstesDatumZuNamenblatt")
    # ------------------------------------------------------------------
    @staticmethod
    def berechne_status(student: Student, heute: Optional[date] = None):
        """Liefert (aktueller_baustein, naechste_deadline_oder_hinweis)."""
        heute = heute or date.today()
        beste_diff = None
        ziel_datum = None
        ziel_baustein = None
        frist_noetig = False
        frist_baustein = None

        for b in student.bausteine:
            if b.status != "In Bearbeitung":
                continue
            frist_fehlt = (
                (not b.lzk_datum_1 and not b.lzk_datum_2)
                or (b.lzk_datum_1 and b.lzk_note_1 and not b.lzk_datum_2)
            )
            if frist_fehlt and frist_baustein is None:
                frist_noetig = True
                frist_baustein = b.name

            for datum, note in ((b.lzk_datum_1, b.lzk_note_1), (b.lzk_datum_2, b.lzk_note_2)):
                if datum and not note:
                    diff = abs((datum - heute).days)
                    if beste_diff is None or diff < beste_diff:
                        beste_diff = diff
                        ziel_datum = datum
                        ziel_baustein = b.name

        if ziel_datum:
            return ziel_baustein, ziel_datum
        if frist_noetig:
            return frist_baustein, "Frist vereinbaren!"
        return "", ""

    def deadline_info(self, student: Student, heute: Optional[date] = None):
        """Naechste Frist samt Anlass: (termin, anlass).

        Beruecksichtigt die LZK-Termine aus den Bausteinen UND die frei gesetzte
        Deadline der Person. Es gewinnt der fruehere Termin; ein reiner Hinweis
        ("Frist vereinbaren!") tritt hinter jeden echten Termin zurueck.

        `termin` ist ein date oder ein Hinweistext, `anlass` das, was daneben
        stehen soll -- "LZK" oder die eigene Bemerkung.
        """
        heute = heute or date.today()
        baustein, lzk_termin = self.berechne_status(student, heute)

        frei_termin = student.sonstige_deadline
        frei_anlass = (student.sonstige_deadline_bemerkung or "").strip() or "Termin"

        kandidaten = []
        if isinstance(lzk_termin, date):
            kandidaten.append((0, lzk_termin, lzk_termin, "LZK"))
        if frei_termin:
            kandidaten.append((0, frei_termin, frei_termin, frei_anlass))
        if not kandidaten and isinstance(lzk_termin, str) and lzk_termin:
            return lzk_termin, baustein or "LZK"
        if not kandidaten:
            return "", ""
        kandidaten.sort(key=lambda k: k[1])
        _, _, termin, anlass = kandidaten[0]
        return termin, anlass

    # ------------------------------------------------------------------
    # Speichern
    # ------------------------------------------------------------------
    def speichern(self, pfad: str):
        if self._wb is None:
            wb = self._neue_mappe()
        else:
            wb = self._wb

        vorlage_name = next((n for n in wb.sheetnames if n.lower().startswith("vorlage")), None)
        if vorlage_name is None:
            vorlage_name = "Vorlage"
            self._baustein_blatt_erstellen(wb, vorlage_name, ist_vorlage=True)
        if vorlage_name != "Vorlage":
            wb[vorlage_name].title = "Vorlage"
            vorlage_name = "Vorlage"
        self._schreibe_vorlage(wb[vorlage_name])

        aktuelle_namen = {s.voller_name for s in self.students}

        # Blätter entfernen, die zu gelöschten Personen gehören
        for sheetname in list(wb.sheetnames):
            # "App-*"-Blaetter stammen aus dem Abgleich mit der Lerntheken-App
            # (osk_sync.py) und duerfen hier nicht wegoptimiert werden.
            if sheetname in ("Namen", "Vorlage") or sheetname.startswith("App-"):
                continue
            if sheetname not in aktuelle_namen:
                del wb[sheetname]

        # Personenblätter anlegen/aktualisieren
        for student in self.students:
            if student.voller_name not in wb.sheetnames:
                self._baustein_blatt_erstellen(wb, student.voller_name, ist_vorlage=False)
            ws = wb[student.voller_name]
            self._schreibe_schueler(ws, student)

        self._schreibe_namen_blatt(wb, self.students)

        wb.save(pfad)
        self._wb = wb
        self.dateipfad = pfad

    def _neue_mappe(self) -> Workbook:
        wb = Workbook()
        wb.remove(wb.active)
        wb.create_sheet("Namen")
        self._baustein_blatt_erstellen(wb, "Vorlage", ist_vorlage=True)
        return wb

    def _baustein_blatt_erstellen(self, wb: Workbook, name: str, ist_vorlage: bool):
        ws = wb.create_sheet(name)
        headers = ["Name:", None, "Aktuelle Kursung:", None, "Jahrgangsstufe:", None]
        ws["A1"] = "Name:"
        ws["C1"] = "Aktuelle Kursung:"
        ws["E1"] = "Jahrgangsstufe:"
        ws["A2"] = "Letzter Besuch im FB:"
        ws["C2"] = "HJ-Note:"
        kopf_labels = ["Baustein", "Status", "Bausteinarbeit", "LZK-Datum-1", "LZK-Note-1",
                       "LZK-Datum-2", "LZK-Note-2", "Halbjahr:", "Bemerkung",
                       "LZK-Bemerkung-1", "LZK-Bemerkung-2"]
        for i, label in enumerate(kopf_labels, start=1):
            ws.cell(row=3, column=i, value=label)
        for col, width in zip("ABCDEFGHIJK", [24, 16, 20, 13, 13, 13, 13, 11, 40, 26, 26]):
            ws.column_dimensions[col].width = width
        for c in range(1, 12):
            ws.cell(row=1, column=c).font = Font(bold=True)
            ws.cell(row=3, column=c).font = Font(bold=True)
        ws.freeze_panes = "A4"

    def _schreibe_vorlage(self, ws: Worksheet):
        # Bestehende Bausteinzeilen leeren, dann neu schreiben
        for row in range(4, ws.max_row + 2):
            for col in range(1, 12):
                # openpyxl ignoriert value=None beim cell()-Aufruf -- die Zelle
                # muss ueber .value geleert werden, sonst bleibt der alte Inhalt.
                ws.cell(row=row, column=col).value = None
        for i, name in enumerate(self.vorlage_bausteine):
            row = 4 + i
            ws.cell(row=row, column=1, value=name)
            ws.cell(row=row, column=2, value="Ausstehend")
        self._setze_baustein_formatierung(ws, len(self.vorlage_bausteine))

    def _schreibe_schueler(self, ws: Worksheet, student: Student):
        ws["B1"] = student.voller_name
        ws["D1"] = student.kursung
        ws["F1"] = student.jahrgangsstufe
        ws["B2"] = student.letzter_besuch_fb
        ws["D2"] = student.hj_note
        ws["E2"] = "Sonstige Deadline:"
        ws["F2"] = student.sonstige_deadline
        if student.sonstige_deadline:
            ws["F2"].number_format = "DD.MM.YYYY"
        ws["G2"] = "Anlass:"
        ws["H2"] = student.sonstige_deadline_bemerkung

        for row in range(4, ws.max_row + 2):
            for col in range(1, 12):
                # openpyxl ignoriert value=None beim cell()-Aufruf -- die Zelle
                # muss ueber .value geleert werden, sonst bleibt der alte Inhalt.
                ws.cell(row=row, column=col).value = None

        for i, b in enumerate(student.bausteine):
            row = 4 + i
            werte = [b.name, b.status, b.bausteinarbeit, b.lzk_datum_1, b.lzk_note_1,
                     b.lzk_datum_2, b.lzk_note_2, b.halbjahr, b.bemerkung,
                     b.lzk_bem_1, b.lzk_bem_2]
            for col, wert in enumerate(werte, start=1):
                ws.cell(row=row, column=col, value=wert)
            for col in (4, 6):
                if werte[col - 1] is not None:
                    ws.cell(row=row, column=col).number_format = "DD.MM.YYYY"

        self._setze_baustein_formatierung(ws, len(student.bausteine))

    def _setze_baustein_formatierung(self, ws: Worksheet, anzahl_zeilen: int):
        letzte_zeile = max(4 + anzahl_zeilen, 5)
        # Alte Validierungen/Regeln entfernen, damit sie sich nicht häufen
        ws.data_validations.dataValidation = []
        ws.conditional_formatting._cf_rules.clear()

        dv = DataValidation(type="list", formula1='"{}"'.format(",".join(STATUS_OPTIONEN)),
                             allow_blank=True)
        ws.add_data_validation(dv)
        dv.add(f"B4:B{letzte_zeile}")

        for status, farbe in STATUS_FARBEN.items():
            ws.conditional_formatting.add(
                f"A4:K{letzte_zeile}",
                FormulaRule(formula=[f'$B4="{status}"'],
                            fill=PatternFill("solid", fgColor=farbe)),
            )

    def _schreibe_namen_blatt(self, wb: Workbook, students: List[Student]):
        ws = wb["Namen"]
        # Ganze bisherige Tabelle leeren -- sie wird gleich komplett aus
        # fb_besuche neu aufgebaut. WICHTIG: auch Zeile 1 ab der ersten
        # Datumsspalte. Frueher blieben dort alte Spaltenkoepfe stehen, wenn das
        # neue Raster schmaler war als das alte; beim naechsten Laden wurden sie
        # als zusaetzliche Besuchstage gelesen und die Historie bekam Dubletten.
        letzte_spalte = max(ws.max_column, 8)
        letzte_zeile = ws.max_row + 1
        for row in range(1, letzte_zeile + 1):
            erste_spalte = 1 if row > 1 else 9   # Zeile 1: Beschriftungen behalten
            for col in range(erste_spalte, letzte_spalte + 1):
                # openpyxl ignoriert value=None beim cell()-Aufruf -- die Zelle
                # muss ueber .value geleert werden, sonst bleibt der alte Inhalt.
                ws.cell(row=row, column=col).value = None

        ws["A1"] = "Vorname"
        ws["B1"] = "Name"
        ws["C1"] = "Lerntheken-Alias"
        ws["D1"] = "Aktueller Baustein"
        ws["E1"] = "Nächste Deadline"
        ws["F1"] = "Letzter Besuch im FB"
        ws["G1"] = "Kursung"
        ws["H1"] = "Anlass"
        for c in range(1, 9):
            ws.cell(row=1, column=c).font = Font(bold=True)

        # Spaltenköpfe: alle Tage, an denen irgendeine Person im FB war,
        # aufsteigend sortiert -- neue Besuchstage werden dadurch beim
        # Speichern automatisch zu neuen Spalten.
        alle_tage = sorted({d for s in students for d in s.fb_besuche})
        for j, tag in enumerate(alle_tage):
            zelle = ws.cell(row=1, column=9 + j, value=tag)
            zelle.number_format = "DD.MM.YYYY"

        for i, student in enumerate(students):
            row = 2 + i
            aktueller_baustein, _ = self.berechne_status(student)
            deadline, anlass = self.deadline_info(student)
            ws.cell(row=row, column=1, value=student.vorname)
            ws.cell(row=row, column=2, value=student.nachname)
            ws.cell(row=row, column=3, value=student.alias)
            ws.cell(row=row, column=4, value=aktueller_baustein)
            zelle = ws.cell(row=row, column=5, value=deadline if deadline != "" else None)
            if isinstance(deadline, date):
                zelle.number_format = "DD.MM.YYYY"
            ws.cell(row=row, column=8, value=anlass)
            letzter = student.fb_besuche[-1] if student.fb_besuche else student.letzter_besuch_fb
            ws.cell(row=row, column=6, value=letzter)
            ws.cell(row=row, column=7, value=student.kursung)
            # Besuchstage namensgebunden eintragen (also korrekt, auch nach
            # Sortieren/Hinzufügen/Entfernen von Personen).
            besuchte_tage = set(student.fb_besuche)
            for j, tag in enumerate(alle_tage):
                ws.cell(row=row, column=9 + j, value=1 if tag in besuchte_tage else 0)
        ws.freeze_panes = "I1"
        for col, width in zip("ABCDEFGH", [11, 11, 16, 22, 17, 16, 9, 20]):
            ws.column_dimensions[col].width = width
