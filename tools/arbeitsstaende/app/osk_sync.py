# -*- coding: utf-8 -*-
"""
Holt die Ergebnisse aus der OSK-Matheherz-App und schreibt sie in die
Arbeitsstände-Excel-Datei.

Ausgelesen wird je Schüler:in, Halbjahr und Fach:
  - Talks gehalten / zugehört
  - Fachbuero-Teilnahmen (FaBü)
  - Kleeblätter aus Talks
  - abgeschlossene Lerntheken-Stationen (fachunabhängig, aktuell nur Mathe)
  - bestandene LZK samt Kleeblättern

Der Zugriff läuft über einen ganz normalen Admin-Login der App (HTTPS), nicht
über die Datenbank. Ein Admin-Konto sieht immer genau SEINE Lerngruppe -- für
mehrere Lerngruppen entsprechend mehrere Konten in der Konfiguration angeben.

Umgekehrt laesst sich aus der Excel-Liste die Kontenliste fuer den Bulk-Import
erzeugen (--bulk-liste). Angelegt werden die Konten in der Weboberflaeche.

Geschrieben wird auf dem Server nur an EINER Stelle: `lzk_setzen()` traegt einen
vereinbarten LZK-Termin ein. Das passiert ausschliesslich, wenn es in der
Oberflaeche ausdruecklich angestossen und die Liste der Aenderungen bestaetigt
wurde -- nie beim Abrufen, nie automatisch. Alles andere ist reines Lesen.

Aufruf:
    python3 osk_sync.py                      # nutzt osk_sync_config.json
    python3 osk_sync.py --config andere.json
    python3 osk_sync.py --dry-run            # nichts schreiben, nur berichten
    python3 osk_sync.py --bulk-liste         # Konten-Liste zum Einfuegen erzeugen

Abhängigkeiten: openpyxl (wie die Arbeitsstände-App selbst). Der Rest ist
Python-Standardbibliothek.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import unicodedata
from datetime import date, datetime
from http.cookiejar import CookieJar
from typing import Dict, List, Optional, Tuple
from urllib import request, parse, error

from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

# Diese Liste ist eine reine MATHE-Liste, deshalb werden nur Mathe-Ergebnisse
# uebernommen. Auf None setzen, um alle Faecher zu holen.
NUR_FACH = "mathe"

# Blattnamen, die dieses Skript anlegt und verwaltet.
BLATT_DATEN = "App-Daten"
BLATT_ZUORDNUNG = "App-Zuordnung"

STANDARD_CONFIG = "osk_sync_config.json"


# ══ Namens-Zuordnung ══════════════════════════════════════════════════════════

def _ohne_umlaute(text: str) -> str:
    """ä->ae, ö->oe, ü->ue, ß->ss, sonstige Akzente entfernen.

    Nötig, weil die Accountnamen in der App aus ASCII bestehen: aus
    "Jürgen Müller" wird sonst "jü.mü" statt des erwarteten "ju.mu".
    """
    ersetzungen = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss",
                   "Ä": "Ae", "Ö": "Oe", "Ü": "Ue"}
    for alt, neu in ersetzungen.items():
        text = text.replace(alt, neu)
    # Verbleibende Akzente (é, à, ...) auf den Grundbuchstaben zurückführen
    zerlegt = unicodedata.normalize("NFKD", text)
    return "".join(z for z in zerlegt if not unicodedata.combining(z))


def accountname(vorname: str, nachname: str, laenge: int = 2) -> str:
    """Leitet den App-Accountnamen ab: erste 2 Buchstaben des Vornamens,
    Punkt, erste 2 Buchstaben des Nachnamens -- z.B. "Anton Berger" -> "an.be".

    Kürzere Namen werden nicht aufgefüllt ("Bo Li" -> "bo.li", "Al Y" -> "al.y").
    """
    v = _ohne_umlaute(vorname).strip().lower()
    n = _ohne_umlaute(nachname).strip().lower()
    v = "".join(c for c in v if c.isalnum())
    n = "".join(c for c in n if c.isalnum())
    if not v or not n:
        return ""
    return f"{v[:laenge]}.{n[:laenge]}"


# ══ Zugriff auf die App ═══════════════════════════════════════════════════════

class AppClient:
    """Minimaler HTTP-Client mit Session-Cookie (die App nutzt Session-Auth)."""

    def __init__(self, base_url: str):
        self.base = base_url.rstrip("/")
        self.opener = request.build_opener(
            request.HTTPCookieProcessor(CookieJar())
        )

    def _post(self, pfad: str, daten: dict) -> dict:
        body = json.dumps(daten).encode("utf-8")
        req = request.Request(self.base + pfad, data=body, method="POST",
                              headers={"Content-Type": "application/json"})
        with self.opener.open(req, timeout=30) as antwort:
            return json.loads(antwort.read().decode("utf-8"))

    def _get(self, pfad: str) -> dict:
        req = request.Request(self.base + pfad, method="GET")
        with self.opener.open(req, timeout=60) as antwort:
            return json.loads(antwort.read().decode("utf-8"))

    def login(self, benutzer: str, passwort: str) -> dict:
        try:
            me = self._post("/api/login", {"username": benutzer, "password": passwort})
        except error.HTTPError as e:
            if e.code == 401:
                raise SystemExit(f"Login fehlgeschlagen für '{benutzer}': "
                                 f"Benutzername oder Passwort falsch.")
            raise
        if me.get("role") != "admin":
            raise SystemExit(f"'{benutzer}' ist kein Admin-Konto -- "
                             f"die Auswertung braucht Admin-Rechte.")
        return me

    def halbjahr_uebersicht(self) -> dict:
        return self._get("/api/admin/halbjahr-uebersicht")

    def studierende(self) -> List[dict]:
        """Aktueller Stand je Schueler:in: aktiv-Kennzeichen, kompletter
        Fortschritt (welche Stationen erledigt sind) und alle LZK-Eintraege.

        Wichtig gegenueber der Halbjahr-Uebersicht: die zaehlt Stationen ueber
        station_events, und die werden erst SEIT Einfuehrung des Loggings
        geschrieben -- fuer laenger bestehende Konten ist das leer. Der hier
        gelieferte Fortschritt ist dagegen der tatsaechliche Gesamtstand.
        """
        return self._get("/api/admin/students")

    def lzk_setzen(self, user_id, lerntheke: str, typ: str, datum,
                   status: str, pokale: int) -> dict:
        """Traegt einen LZK-Termin ein (der einzige Schreibzugriff dieses Werkzeugs).

        `status` und `pokale` MUESSEN mitgegeben werden: die Schnittstelle
        schreibt beide Felder bei jedem Aufruf mit. Wer nur ein Datum schickt,
        setzt damit eine bestandene LZK samt Kleeblaettern zurueck -- deshalb
        werden hier immer die Werte durchgereicht, die schon auf dem Server
        stehen.
        """
        if not user_id or not lerntheke or not typ:
            raise ValueError("user_id, lerntheke und typ sind Pflicht.")
        if isinstance(datum, (date, datetime)):
            datum = datum.strftime("%Y-%m-%d")
        return self._post("/api/admin/lzk", {
            "userId": user_id,
            "lerntheke": lerntheke,
            "typ": typ,
            "datum": datum,
            "status": status or "ausstehend",
            "pokale": int(pokale or 0),
        })

    def lerntheken_meta(self) -> List[dict]:
        """Alle Lerntheken mit key, Titel und Stationszahl."""
        try:
            return self._get("/api/lerntheken-meta") or []
        except Exception:
            return []

    def lerntheken_titel(self) -> Dict[str, str]:
        """{Fortschritts-Key: Titel}, z.B. {"lerntheke_kreise_v11": "Kreise und Zylinder"}.

        LZK-Eintraege und Stations-Ereignisse referenzieren die Lerntheke ueber
        diesen Key; fuer lesbare Bausteinnamen braucht es die Zuordnung zum Titel.
        """
        try:
            meta = self._get("/api/lerntheken-meta")
        except Exception:
            return {}
        titel = {}
        for lt in meta or []:
            if lt.get("key"):
                titel[lt["key"]] = lt.get("title") or lt["key"]
        return titel


# ══ Daten aus der App aufbereiten ═════════════════════════════════════════════

class AppDaten:
    """Ergebnisse aller abgefragten Lerngruppen, nach Accountname sortiert."""

    def __init__(self):
        # account -> {"klasse": str, "byHalbjahr": {hj: bucket}}
        self.nach_account: Dict[str, dict] = {}
        self.halbjahre: List[str] = []
        self.faecher: List[dict] = []   # [{key, name, color}, ...]

    def uebernehmen(self, klasse: str, payload: dict):
        for hj in payload.get("halbjahre", []):
            if hj not in self.halbjahre:
                self.halbjahre.append(hj)
        for fach in payload.get("subjects", []):
            if NUR_FACH and fach.get("key") != NUR_FACH:
                continue
            if not any(f["key"] == fach["key"] for f in self.faecher):
                self.faecher.append(fach)
        for stud in payload.get("students", []):
            account = (stud.get("username") or "").strip().lower()
            if not account:
                continue
            if account in self.nach_account:
                # Gleicher Accountname in zwei Lerngruppen -- das darf nicht
                # passieren (Benutzernamen sind appweit eindeutig), wäre aber
                # eine stille Fehlerquelle. Deshalb laut melden.
                raise SystemExit(
                    f"Account '{account}' kommt in mehreren Lerngruppen vor "
                    f"({self.nach_account[account]['klasse']} und {klasse}). "
                    f"Bitte in der App prüfen.")
            self.nach_account[account] = {
                "klasse": klasse,
                "byHalbjahr": stud.get("byHalbjahr") or {},
            }

    def sortiere(self):
        self.halbjahre.sort()
        # Fächer NICHT sortieren: die App liefert sie bereits in ihrer eigenen
        # Reihenfolge (Mathe, Englisch, Deutsch). Alphabetisch stünde Deutsch
        # vorn, was in dieser Datei niemand erwartet.


def hole_daten(config: dict) -> Tuple[AppDaten, Dict[str, AppClient]]:
    """Liefert die Auswertung und die angemeldeten Sitzungen je Lerngruppe.

    Die Sitzungen werden für das Anlegen von Konten weiterverwendet -- so muss
    man sich nicht zweimal anmelden.
    """
    daten = AppDaten()
    sitzungen: Dict[str, AppClient] = {}
    for konto in config["accounts"]:
        benutzer = konto["username"]
        passwort = konto.get("password")
        if not passwort:
            passwort = os.environ.get(f"OSK_PW_{benutzer.upper()}")
        if not passwort:
            passwort = getpass.getpass(f"Passwort für '{benutzer}': ")
        client = AppClient(config["base_url"])
        me = client.login(benutzer, passwort)
        klasse = me.get("klasse", "?")
        payload = client.halbjahr_uebersicht()
        anzahl = len(payload.get("students", []))
        print(f"  {benutzer}: Lerngruppe {klasse}, {anzahl} Schüler:innen")
        daten.uebernehmen(klasse, payload)
        sitzungen[klasse] = client
    daten.sortiere()
    return daten, sitzungen


# ══ Konten anlegen (Excel -> App) ═════════════════════════════════════════════

def bulk_liste(ohne_konto: List[Tuple[str, str]], passwort: str) -> List[dict]:
    """Baut die Liste der anzulegenden Konten aus den Personen ohne App-Konto.

    Personen, deren Kurzname leer bliebe (z.B. Blattname ohne Nachnamen),
    werden ausgelassen -- sie bekaemen sonst einen unbrauchbaren Benutzernamen.
    """
    konten = []
    for blatt, account in sorted(ohne_konto):
        if not account:
            continue
        teile = blatt.split(" ", 1)
        konten.append({
            "username": account,
            "password": passwort,
            "_name": blatt,
            "_vorname": teile[0],
            "_nachname": teile[1] if len(teile) > 1 else "",
        })
    return konten


def schreibe_bulk_datei(konten: List[dict], pfad: str):
    """Schreibt das Format, das der Bulk-Dialog der App erwartet:
    eine Zeile je Konto, 'benutzername,passwort'.
    """
    with open(pfad, "w", encoding="utf-8") as f:
        for k in konten:
            f.write(f"{k['username']},{k['password']}\n")


# ══ Excel: lesen, zuordnen, schreiben ═════════════════════════════════════════

def lies_personen(wb) -> List[Tuple[str, str, str]]:
    """Alle Personenblätter als (Blattname, Vorname, Nachname).

    Die Namen kommen -- wie in der Arbeitsstände-App selbst -- aus dem
    Blattnamen, nicht aus dem Namen-Blatt.
    """
    personen = []
    for blatt in wb.sheetnames:
        if blatt in ("Namen", BLATT_DATEN, BLATT_ZUORDNUNG):
            continue
        if blatt.lower().startswith("vorlage"):
            continue
        teile = blatt.split(" ", 1)
        if len(teile) < 2:
            continue
        personen.append((blatt, teile[0], teile[1]))
    return personen


def lies_manuelle_zuordnung(wb) -> Dict[str, str]:
    """Blatt "App-Zuordnung": Vorname | Nachname | Accountname.

    Diese Einträge haben Vorrang vor der automatischen Ableitung -- nötig für
    Doppeldeutigkeiten (zwei Personen ergeben denselben Kurznamen) und für
    Konten, die von der Regel abweichen.
    """
    if BLATT_ZUORDNUNG not in wb.sheetnames:
        return {}
    ws = wb[BLATT_ZUORDNUNG]
    zuordnung = {}
    for row in range(2, ws.max_row + 1):
        vn = (ws.cell(row=row, column=1).value or "")
        nn = (ws.cell(row=row, column=2).value or "")
        acc = (ws.cell(row=row, column=3).value or "")
        vn, nn, acc = str(vn).strip(), str(nn).strip(), str(acc).strip().lower()
        if vn and nn and acc:
            zuordnung[f"{vn} {nn}"] = acc
    return zuordnung


def ordne_zu(personen, manuell: Dict[str, str], daten: AppDaten):
    """Liefert (treffer, ohne_konto, doppelte, unbenutzte_konten)."""
    treffer = []          # (blattname, vorname, nachname, account)
    ohne_konto = []       # Personen ohne passenden App-Account
    abgeleitet: Dict[str, List[str]] = {}

    for blatt, vn, nn in personen:
        account = manuell.get(blatt) or accountname(vn, nn)
        abgeleitet.setdefault(account, []).append(blatt)
        if account and account in daten.nach_account:
            treffer.append((blatt, vn, nn, account))
        else:
            ohne_konto.append((blatt, account))

    # Zwei Personen, die denselben Kurznamen ergeben -- ohne manuelle Zuordnung
    # bekämen beide dieselben Zahlen. Das muss auffallen.
    doppelte = {acc: bl for acc, bl in abgeleitet.items() if acc and len(bl) > 1}

    benutzt = {t[3] for t in treffer}
    unbenutzt = sorted(set(daten.nach_account) - benutzt)
    return treffer, ohne_konto, doppelte, unbenutzt


def _bucket_werte(bucket: dict, fach_key: str) -> dict:
    sub = (bucket.get("bySubject") or {}).get(fach_key) or {}
    return {
        "gehalten": sub.get("talksPresented", 0),
        "zugehoert": sub.get("talksListened", 0),
        "input": sub.get("inputParticipated", 0),
        "kleeblaetter": (sub.get("pokalePresented", 0) or 0) + (sub.get("pokaleListened", 0) or 0),
    }


def schreibe_app_daten(wb, treffer, daten: AppDaten):
    """Legt das Blatt "App-Daten" neu an: eine Zeile je Person und Halbjahr,
    je Fach eigene Spalten. Bewusst eine flache Tabelle -- so lässt sie sich in
    Excel filtern und mit Pivot auswerten, ohne die Personenblätter zu stören.
    """
    if BLATT_DATEN in wb.sheetnames:
        del wb[BLATT_DATEN]
    ws = wb.create_sheet(BLATT_DATEN)

    kopf = ["Vorname", "Nachname", "Account", "Lerngruppe", "Halbjahr"]
    for fach in daten.faecher:
        kurz = fach["name"]
        kopf += [f"{kurz}: Talks gehalten", f"{kurz}: Talks zugehört",
                 f"{kurz}: FaBü", f"{kurz}: Kleeblätter"]
    kopf += ["Stationen abgeschlossen", "LZK bestanden", "LZK-Kleeblätter",
             "Stand"]

    for i, text in enumerate(kopf, start=1):
        zelle = ws.cell(row=1, column=i, value=text)
        zelle.font = Font(bold=True)
        zelle.alignment = Alignment(wrap_text=True, vertical="center")
        zelle.fill = PatternFill("solid", fgColor="EFEFEF")

    stand = datetime.now().strftime("%d.%m.%Y %H:%M")
    zeile = 2
    for blatt, vn, nn, account in sorted(treffer, key=lambda t: (t[2], t[1])):
        eintrag = daten.nach_account[account]
        by_hj = eintrag["byHalbjahr"]
        # Auch Halbjahre ohne Aktivität auflisten? Nein -- nur was es gibt,
        # sonst blaeht sich die Tabelle mit Nullzeilen auf.
        for hj in sorted(by_hj.keys()):
            bucket = by_hj[hj] or {}
            werte = [vn, nn, account, eintrag["klasse"], hj]
            for fach in daten.faecher:
                w = _bucket_werte(bucket, fach["key"])
                werte += [w["gehalten"], w["zugehoert"], w["input"], w["kleeblaetter"]]
            lzk_liste = bucket.get("lzk") or []
            lzk_bestanden = [l for l in lzk_liste if l.get("status") == "bestanden"]
            werte += [
                bucket.get("stationsCompleted", 0),
                len(lzk_bestanden),
                sum((l.get("pokale") or 0) for l in lzk_bestanden),
                stand,
            ]
            for i, wert in enumerate(werte, start=1):
                ws.cell(row=zeile, column=i, value=wert)
            zeile += 1

    breiten = [12, 14, 10, 11, 10] + [13] * (4 * len(daten.faecher)) + [12, 12, 13, 16]
    for i, breite in enumerate(breiten, start=1):
        ws.column_dimensions[get_column_letter(i)].width = breite
    ws.freeze_panes = "F2"
    return zeile - 2


def schreibe_zuordnungsblatt(wb, treffer, ohne_konto):
    """Blatt "App-Zuordnung" anlegen/auffrischen: dokumentiert die verwendete
    Zuordnung und ist gleichzeitig die Stelle, an der man sie von Hand
    korrigieren kann (die Einträge werden beim nächsten Lauf gelesen).
    """
    vorhanden = lies_manuelle_zuordnung(wb) if BLATT_ZUORDNUNG in wb.sheetnames else {}
    if BLATT_ZUORDNUNG in wb.sheetnames:
        del wb[BLATT_ZUORDNUNG]
    ws = wb.create_sheet(BLATT_ZUORDNUNG)

    for i, text in enumerate(["Vorname", "Nachname", "Accountname", "Hinweis"], start=1):
        zelle = ws.cell(row=1, column=i, value=text)
        zelle.font = Font(bold=True)
        zelle.fill = PatternFill("solid", fgColor="EFEFEF")
    ws["F1"] = ("Hier eingetragene Accountnamen haben Vorrang vor der "
                "automatischen Ableitung (2 Buchstaben Vorname . 2 Buchstaben Nachname).")
    ws["F1"].font = Font(italic=True)

    zeile = 2
    for blatt, vn, nn, account in sorted(treffer, key=lambda t: (t[2], t[1])):
        ws.cell(row=zeile, column=1, value=vn)
        ws.cell(row=zeile, column=2, value=nn)
        ws.cell(row=zeile, column=3, value=account)
        ws.cell(row=zeile, column=4,
                value="von Hand" if blatt in vorhanden else "abgeleitet")
        zeile += 1
    for blatt, account in sorted(ohne_konto):
        vn, nn = blatt.split(" ", 1)
        ws.cell(row=zeile, column=1, value=vn)
        ws.cell(row=zeile, column=2, value=nn)
        ws.cell(row=zeile, column=3, value=account or "")
        zelle = ws.cell(row=zeile, column=4, value="KEIN KONTO GEFUNDEN")
        zelle.fill = PatternFill("solid", fgColor="FFC7CE")
        zeile += 1

    for i, breite in enumerate([14, 16, 14, 22], start=1):
        ws.column_dimensions[get_column_letter(i)].width = breite
    ws.freeze_panes = "A2"


# ══ Ablauf ════════════════════════════════════════════════════════════════════

def lade_config(pfad: str) -> dict:
    if not os.path.exists(pfad):
        raise SystemExit(
            f"Konfigurationsdatei '{pfad}' fehlt.\n"
            f"Beispiel:\n"
            + json.dumps({
                "base_url": "https://mathe.offene-schule-koeln.online",
                "excel": "2627_Arbeitsstaende.xlsm",
                "accounts": [{"username": "koek"}],
            }, indent=2, ensure_ascii=False))
    with open(pfad, encoding="utf-8") as f:
        config = json.load(f)
    for pflicht in ("base_url", "excel", "accounts"):
        if pflicht not in config:
            raise SystemExit(f"'{pflicht}' fehlt in {pfad}.")
    return config


def main(argv=None):
    p = argparse.ArgumentParser(description="Ergebnisse aus der OSK-App in die Arbeitsstände-Datei schreiben.")
    p.add_argument("--config", default=STANDARD_CONFIG)
    p.add_argument("--dry-run", action="store_true",
                   help="nur auswerten und berichten, nichts speichern")
    p.add_argument("--bulk-liste", nargs="?", const="bulk_konten.txt", metavar="DATEI",
                   help="Konten für fehlende Personen als Textdatei ausgeben "
                        "(Format des Bulk-Dialogs: benutzername,passwort)")
    p.add_argument("--passwort", metavar="PW",
                   help="Start-Passwort für die neuen Konten (sonst Abfrage)")
    args = p.parse_args(argv)

    config = lade_config(args.config)
    excel_pfad = config["excel"]
    if not os.path.exists(excel_pfad):
        raise SystemExit(f"Excel-Datei '{excel_pfad}' nicht gefunden.")

    print("Melde mich an der App an …")
    daten, sitzungen = hole_daten(config)

    print(f"Öffne {excel_pfad} …")
    # keep_vba erhält die Makros der .xlsm-Datei; ohne das wären sie nach dem
    # Speichern weg.
    ist_xlsm = excel_pfad.lower().endswith(".xlsm")
    wb = load_workbook(excel_pfad, keep_vba=ist_xlsm)

    personen = lies_personen(wb)
    manuell = lies_manuelle_zuordnung(wb)
    treffer, ohne_konto, doppelte, unbenutzt = ordne_zu(personen, manuell, daten)

    print()
    print(f"Personenblätter:      {len(personen)}")
    print(f"davon zugeordnet:     {len(treffer)}")
    print(f"ohne App-Konto:       {len(ohne_konto)}")
    print(f"Konten ohne Blatt:    {len(unbenutzt)}")

    if doppelte:
        print()
        print("ACHTUNG -- mehrdeutige Kurznamen (bitte im Blatt "
              f"'{BLATT_ZUORDNUNG}' von Hand auflösen):")
        for acc, blaetter in sorted(doppelte.items()):
            print(f"  {acc}: {', '.join(blaetter)}")
    if ohne_konto:
        print()
        print("Ohne App-Konto (bekommen keine Zahlen):")
        for blatt, acc in sorted(ohne_konto):
            print(f"  {blatt}  ->  erwartet '{acc}'")
    if unbenutzt:
        print()
        print("App-Konten ohne Personenblatt:")
        for acc in unbenutzt:
            print(f"  {acc} (Lerngruppe {daten.nach_account[acc]['klasse']})")

    # ── Kontenliste erzeugen (Excel -> Datei) ────────────────────────────────
    # Dieses Werkzeug schreibt BEWUSST nicht auf dem Server. Es erzeugt nur die
    # Liste; angelegt werden die Konten in der Weboberflaeche unter
    # "Mehrere anlegen" - dort sieht man vor dem Absenden nochmal, was passiert.
    if args.bulk_liste:
        passwort = args.passwort
        if not passwort:
            passwort = getpass.getpass("Start-Passwort für die neuen Konten: ")
        if len(passwort) < 4:
            raise SystemExit("Start-Passwort muss mindestens 4 Zeichen haben.")

        konten = bulk_liste(ohne_konto, passwort)
        print()
        print(f"Anzulegende Konten: {len(konten)}")
        for k in konten[:10]:
            print(f"  {k['username']:<12} {k['_name']}")
        if len(konten) > 10:
            print(f"  … und {len(konten) - 10} weitere")

        if not konten:
            print("Nichts anzulegen -- alle Personen haben bereits ein Konto.")
        else:
            schreibe_bulk_datei(konten, args.bulk_liste)
            print()
            print(f"Liste geschrieben: {args.bulk_liste}")
            print("Inhalt in der App unter 'Mehrere anlegen' einfügen.")
        return 0

    if args.dry_run:
        print()
        print("--dry-run: nichts geschrieben.")
        return 0

    zeilen = schreibe_app_daten(wb, treffer, daten)
    schreibe_zuordnungsblatt(wb, treffer, ohne_konto)
    wb.save(excel_pfad)

    print()
    print(f"Fertig: {zeilen} Zeilen in '{BLATT_DATEN}' geschrieben, "
          f"Zuordnung in '{BLATT_ZUORDNUNG}' dokumentiert.")
    print(f"Gespeichert: {excel_pfad}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
