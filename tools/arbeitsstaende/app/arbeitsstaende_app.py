# -*- coding: utf-8 -*-
"""
Arbeitsstände -- Desktop-Anwendung zur Bausteinarbeit.

Start: python3 arbeitsstaende_app.py
Voraussetzung: pip install openpyxl
"""
import json
import os
import sys
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog
from datetime import date, datetime

from typing import List

from arbeitsstaende_data import (
    Arbeitsstaende, Student, Baustein, alias_vorschlag,
    halbjahr_fuer_datum, halbjahr_optionen, lt_zeilen_aktualisieren, ist_json_pfad,
    STATUS_OPTIONEN, KURSUNG_OPTIONEN, STATUS_FARBEN,
)
# Zugriff auf die Lerntheken-App (Anmeldung und Auswertung -- NUR lesend).
# Liegt bewusst im selben Ordner, damit die Anwendung ohne Installation läuft.
import osk_sync

APP_TITEL = "Arbeitsstände"
AUTOSAVE_INTERVALL_MS = 5 * 60 * 1000  # alle 5 Minuten


def fmt_datum(d):
    if d is None:
        return ""
    if isinstance(d, str):
        return d
    return d.strftime("%d.%m.%Y")


def _mit_bemerkung(text, bemerkung):
    """Datum und zugehoerige Bemerkung in einer Zelle -- spart eine Spalte
    in der ohnehin breiten Baustein-Tabelle."""
    bemerkung = (bemerkung or "").strip()
    if not bemerkung:
        return text
    return f"{text} · {bemerkung}" if text else bemerkung


def parse_datum(text):
    text = (text or "").strip()
    if not text:
        return None
    for fmt in ("%d.%m.%Y", "%d.%m.%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Datum '{text}' nicht erkannt (erwartet TT.MM.JJJJ)")


class BausteinDialog(tk.Toplevel):
    """Formular zum Anlegen/Bearbeiten eines einzelnen Bausteins."""

    def __init__(self, parent, baustein: Baustein = None, vorlage_namen=None):
        super().__init__(parent)
        self.title("Baustein bearbeiten" if baustein else "Baustein hinzufügen")
        self.resizable(False, False)
        self.result = None
        self.transient(parent)
        self.grab_set()

        b = baustein or Baustein(halbjahr=halbjahr_fuer_datum())
        felder = [
            ("Baustein", "name", "entry_or_combo", vorlage_namen),
            ("Status", "status", "combo", STATUS_OPTIONEN),
            ("Bausteinarbeit", "bausteinarbeit", "entry", None),
            ("LZK-Datum 1 (TT.MM.JJJJ)", "lzk_datum_1", "entry", None),
            ("LZK-Note 1", "lzk_note_1", "entry", None),
            ("Bemerkung zur LZK 1", "lzk_bem_1", "entry", None),
            ("LZK-Datum 2 (TT.MM.JJJJ)", "lzk_datum_2", "entry", None),
            ("LZK-Note 2", "lzk_note_2", "entry", None),
            ("Bemerkung zur LZK 2", "lzk_bem_2", "entry", None),
            ("Halbjahr", "halbjahr", "entry_or_combo", halbjahr_optionen([b.halbjahr])),
            ("Bemerkung", "bemerkung", "text", None),
        ]

        self.vars = {}
        row = 0
        for label, feld, art, optionen in felder:
            ttk.Label(self, text=label).grid(row=row, column=0, sticky="ne", padx=8, pady=4)
            wert = getattr(b, feld)
            if feld in ("lzk_datum_1", "lzk_datum_2"):
                wert = fmt_datum(wert)

            if art == "combo":
                var = tk.StringVar(value=wert)
                w = ttk.Combobox(self, textvariable=var, values=optionen, width=28, state="readonly")
                w.grid(row=row, column=1, sticky="w", padx=8, pady=4)
            elif art == "entry_or_combo":
                var = tk.StringVar(value=wert)
                w = ttk.Combobox(self, textvariable=var, values=optionen or [], width=28)
                w.grid(row=row, column=1, sticky="w", padx=8, pady=4)
            elif art == "text":
                text_rahmen = ttk.Frame(self)
                text_rahmen.grid(row=row, column=1, sticky="w", padx=8, pady=4)
                w = tk.Text(text_rahmen, width=45, height=10, wrap="word")
                w.pack(side="left", fill="both", expand=True)
                sb = ttk.Scrollbar(text_rahmen, command=w.yview)
                sb.pack(side="right", fill="y")
                w.config(yscrollcommand=sb.set)
                w.insert("1.0", wert)
                var = w  # Text-Widget selbst als "var" merken
            else:
                var = tk.StringVar(value=wert)
                w = ttk.Entry(self, textvariable=var, width=30)
                w.grid(row=row, column=1, sticky="w", padx=8, pady=4)
            self.vars[feld] = var
            row += 1

        btns = ttk.Frame(self)
        btns.grid(row=row, column=0, columnspan=2, pady=10)
        ttk.Button(btns, text="Übernehmen", command=self._uebernehmen).pack(side="left", padx=4)
        ttk.Button(btns, text="Abbrechen", command=self.destroy).pack(side="left", padx=4)

        self.bind("<Return>", lambda e: self._uebernehmen())
        self.bind("<Escape>", lambda e: self.destroy())

    def _uebernehmen(self):
        try:
            werte = {}
            for feld, var in self.vars.items():
                if isinstance(var, tk.Text):
                    werte[feld] = var.get("1.0", "end").strip()
                else:
                    werte[feld] = var.get().strip()

            if not werte["name"]:
                messagebox.showwarning("Fehlt", "Bitte einen Baustein-Namen angeben.", parent=self)
                return

            werte["lzk_datum_1"] = parse_datum(werte["lzk_datum_1"])
            werte["lzk_datum_2"] = parse_datum(werte["lzk_datum_2"])
            if not werte["status"]:
                werte["status"] = "Ausstehend"

            self.result = Baustein(**werte)
            self.destroy()
        except ValueError as e:
            messagebox.showerror("Ungültige Eingabe", str(e), parent=self)


class SchuelerDialog(tk.Toplevel):
    """Formular zum Anlegen einer neuen Schülerin / eines neuen Schülers."""

    def __init__(self, parent, vorhandene_namen):
        super().__init__(parent)
        self.title("Schüler:in hinzufügen")
        self.resizable(False, False)
        self.result = None
        self.vorhandene_namen = vorhandene_namen
        self.transient(parent)
        self.grab_set()

        self.vorname = tk.StringVar()
        self.nachname = tk.StringVar()
        self.kursung = tk.StringVar(value="")
        self.jahrgang = tk.StringVar()

        ttk.Label(self, text="Vorname").grid(row=0, column=0, sticky="e", padx=8, pady=4)
        e1 = ttk.Entry(self, textvariable=self.vorname, width=24)
        e1.grid(row=0, column=1, padx=8, pady=4)
        ttk.Label(self, text="Nachname").grid(row=1, column=0, sticky="e", padx=8, pady=4)
        ttk.Entry(self, textvariable=self.nachname, width=24).grid(row=1, column=1, padx=8, pady=4)
        ttk.Label(self, text="Kursung").grid(row=2, column=0, sticky="e", padx=8, pady=4)
        ttk.Combobox(self, textvariable=self.kursung, values=KURSUNG_OPTIONEN,
                     width=21, state="readonly").grid(row=2, column=1, padx=8, pady=4, sticky="w")
        ttk.Label(self, text="Jahrgangsstufe").grid(row=3, column=0, sticky="e", padx=8, pady=4)
        ttk.Entry(self, textvariable=self.jahrgang, width=24).grid(row=3, column=1, padx=8, pady=4)

        btns = ttk.Frame(self)
        btns.grid(row=4, column=0, columnspan=2, pady=10)
        ttk.Button(btns, text="Anlegen", command=self._anlegen).pack(side="left", padx=4)
        ttk.Button(btns, text="Abbrechen", command=self.destroy).pack(side="left", padx=4)

        e1.focus_set()
        self.bind("<Return>", lambda e: self._anlegen())
        self.bind("<Escape>", lambda e: self.destroy())

    def _anlegen(self):
        vn = self.vorname.get().strip()
        nn = self.nachname.get().strip()
        if not vn or not nn:
            messagebox.showwarning("Fehlt", "Bitte Vor- und Nachnamen angeben.", parent=self)
            return
        voller_name = f"{vn} {nn}"
        if voller_name in self.vorhandene_namen:
            messagebox.showwarning("Schon vorhanden", f"„{voller_name}“ steht schon in der Liste.", parent=self)
            return
        jahrgang = None
        if self.jahrgang.get().strip():
            try:
                jahrgang = int(self.jahrgang.get().strip())
            except ValueError:
                messagebox.showwarning("Ungültig", "Jahrgangsstufe muss eine Zahl sein.", parent=self)
                return
        self.result = Student(vorname=vn, nachname=nn, kursung=self.kursung.get(), jahrgangsstufe=jahrgang)
        self.destroy()


class VorlageDialog(tk.Toplevel):
    """Bearbeiten der Standard-Bausteinliste, die neue Schüler:innen erhalten."""

    def __init__(self, parent, bausteine: list):
        super().__init__(parent)
        self.title("Standard-Bausteine bearbeiten")
        self.geometry("360x420")
        self.result = None
        self.transient(parent)
        self.grab_set()

        ttk.Label(self, text="Diese Liste erhält jede neu angelegte Person automatisch.\n"
                              "Bestehende Personen sind davon nicht betroffen.",
                  justify="left", wraplength=330).pack(padx=10, pady=(10, 6), anchor="w")

        rahmen = ttk.Frame(self)
        rahmen.pack(fill="both", expand=True, padx=10)
        self.box = tk.Listbox(rahmen, height=14, activestyle="dotbox")
        self.box.pack(side="left", fill="both", expand=True)
        sb = ttk.Scrollbar(rahmen, command=self.box.yview)
        sb.pack(side="right", fill="y")
        self.box.config(yscrollcommand=sb.set)
        for b in bausteine:
            self.box.insert("end", b)

        eingabe_zeile = ttk.Frame(self)
        eingabe_zeile.pack(fill="x", padx=10, pady=6)
        self.neu_var = tk.StringVar()
        ttk.Entry(eingabe_zeile, textvariable=self.neu_var).pack(side="left", fill="x", expand=True)
        ttk.Button(eingabe_zeile, text="+ Hinzufügen", command=self._hinzufuegen).pack(side="left", padx=(6, 0))

        btn_zeile = ttk.Frame(self)
        btn_zeile.pack(fill="x", padx=10)
        ttk.Button(btn_zeile, text="↑", width=3, command=lambda: self._verschieben(-1)).pack(side="left")
        ttk.Button(btn_zeile, text="↓", width=3, command=lambda: self._verschieben(1)).pack(side="left", padx=4)
        ttk.Button(btn_zeile, text="− Entfernen", command=self._entfernen).pack(side="left")

        abschluss = ttk.Frame(self)
        abschluss.pack(fill="x", padx=10, pady=10)
        ttk.Button(abschluss, text="Speichern", command=self._speichern).pack(side="left")
        ttk.Button(abschluss, text="Abbrechen", command=self.destroy).pack(side="left", padx=6)

        self.bind("<Return>", lambda e: self._hinzufuegen())

    def _hinzufuegen(self):
        text = self.neu_var.get().strip()
        if not text:
            return
        self.box.insert("end", text)
        self.neu_var.set("")

    def _entfernen(self):
        auswahl = self.box.curselection()
        if auswahl:
            self.box.delete(auswahl[0])

    def _verschieben(self, richtung):
        auswahl = self.box.curselection()
        if not auswahl:
            return
        i = auswahl[0]
        j = i + richtung
        if j < 0 or j >= self.box.size():
            return
        text = self.box.get(i)
        self.box.delete(i)
        self.box.insert(j, text)
        self.box.selection_set(j)

    def _speichern(self):
        self.result = list(self.box.get(0, "end"))
        self.destroy()


class LerntheckenEinstellungenDialog(tk.Toplevel):
    """Adresse und Admin-Benutzername der Lerntheken-App.

    Bewusst ohne Passwortfeld: das Passwort wird bei jeder Aktion abgefragt und
    nirgends gespeichert.
    """

    def __init__(self, parent, cfg: dict):
        super().__init__(parent)
        self.title("Lerntheken-App -- Einstellungen")
        self.resizable(False, False)
        self.result = None
        self.transient(parent)
        self.grab_set()

        self.url = tk.StringVar(value=cfg.get("base_url", "https://mathe.offene-schule-koeln.online"))
        self.user = tk.StringVar(value=cfg.get("username", ""))

        ttk.Label(self, text="Adresse der App").grid(row=0, column=0, sticky="e", padx=8, pady=6)
        ttk.Entry(self, textvariable=self.url, width=42).grid(row=0, column=1, padx=8, pady=6)
        ttk.Label(self, text="Admin-Benutzername").grid(row=1, column=0, sticky="e", padx=8, pady=6)
        e = ttk.Entry(self, textvariable=self.user, width=42)
        e.grid(row=1, column=1, padx=8, pady=6)

        ttk.Label(self, foreground="#666", justify="left",
                  text=("Das Passwort wird nicht gespeichert, sondern bei jeder\n"
                        "Aktion abgefragt.\n\n"
                        "Das Konto muss Admin-Rechte haben. Es sieht immer genau\n"
                        "seine eigene Lerngruppe -- neue Konten entstehen dort.")
                  ).grid(row=2, column=0, columnspan=2, sticky="w", padx=8, pady=(0, 6))

        btns = ttk.Frame(self)
        btns.grid(row=3, column=0, columnspan=2, pady=10)
        ttk.Button(btns, text="Speichern", command=self._ok).pack(side="left", padx=4)
        ttk.Button(btns, text="Abbrechen", command=self.destroy).pack(side="left", padx=4)

        e.focus_set()
        self.bind("<Return>", lambda ev: self._ok())
        self.bind("<Escape>", lambda ev: self.destroy())

    def _ok(self):
        url = self.url.get().strip()
        user = self.user.get().strip()
        if not url or not user:
            messagebox.showwarning("Fehlt", "Bitte Adresse und Benutzernamen angeben.", parent=self)
            return
        if not url.startswith("http"):
            messagebox.showwarning("Adresse", "Die Adresse sollte mit https:// beginnen.", parent=self)
            return
        self.result = {"base_url": url, "username": user}
        self.destroy()


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(APP_TITEL)
        self.geometry("1450x700")
        self.minsize(950, 480)

        self.az = Arbeitsstaende()
        self.aktueller_schueler: Student = None
        self.ungespeichert = False

        self._menu_aufbauen()
        self._layout_aufbauen()
        self._aktualisiere_titel()
        self._autosave_job = self.after(AUTOSAVE_INTERVALL_MS, self._autosave_tick)

    # ------------------------------------------------------------------
    def _menu_aufbauen(self):
        menu = tk.Menu(self)
        dateimenu = tk.Menu(menu, tearoff=0)
        dateimenu.add_command(label="Neu", command=self.neu, accelerator="Cmd+N")
        dateimenu.add_command(label="Öffnen…", command=self.oeffnen, accelerator="Cmd+O")
        dateimenu.add_separator()
        dateimenu.add_command(label="Speichern", command=self.speichern, accelerator="Cmd+S")
        dateimenu.add_command(label="Speichern unter…", command=self.speichern_unter)
        dateimenu.add_separator()
        dateimenu.add_command(label="Aus Excel importieren…", command=self.excel_importieren)
        dateimenu.add_command(label="Als Excel exportieren…", command=self.excel_exportieren)
        dateimenu.add_separator()
        dateimenu.add_command(label="Beenden", command=self._beenden)
        menu.add_cascade(label="Datei", menu=dateimenu)

        bearbeiten_menu = tk.Menu(menu, tearoff=0)
        bearbeiten_menu.add_command(label="Standard-Bausteine bearbeiten…", command=self.vorlage_bearbeiten)
        bearbeiten_menu.add_separator()
        bearbeiten_menu.add_command(label="Fehlende Lerntheken-Aliasse ergänzen…",
                                    command=self.aliasse_ergaenzen)
        menu.add_cascade(label="Bearbeiten", menu=bearbeiten_menu)

        lerntheke_menu = tk.Menu(menu, tearoff=0)
        lerntheke_menu.add_command(label="Ergebnisse abrufen…", command=self.app_ergebnisse_abrufen)
        lerntheke_menu.add_separator()
        lerntheke_menu.add_command(label="Aliasse exportieren…", command=self.aliasse_exportieren)
        lerntheke_menu.add_separator()
        lerntheke_menu.add_command(label="Einstellungen…", command=self.app_einstellungen)
        menu.add_cascade(label="Lerntheken-App", menu=lerntheke_menu)

        self.config(menu=menu)

        self.bind_all("<Command-s>", lambda e: self.speichern())
        self.bind_all("<Control-s>", lambda e: self.speichern())
        self.bind_all("<Command-o>", lambda e: self.oeffnen())
        self.bind_all("<Control-o>", lambda e: self.oeffnen())

        self.protocol("WM_DELETE_WINDOW", self._beenden)

    def _layout_aufbauen(self):
        paned = ttk.PanedWindow(self, orient="horizontal")
        paned.pack(fill="both", expand=True)

        # ---------------- linke Seite: Schülerliste ----------------
        links = ttk.Frame(paned, padding=8)
        paned.add(links, weight=2)

        suchzeile = ttk.Frame(links)
        suchzeile.pack(fill="x", pady=(0, 6))
        ttk.Label(suchzeile, text="Suche:").pack(side="left")
        self.suche_var = tk.StringVar()
        self.suche_var.trace_add("write", lambda *a: self._liste_aktualisieren())
        ttk.Entry(suchzeile, textvariable=self.suche_var).pack(side="left", fill="x", expand=True, padx=6)

        ttk.Label(links, text="Sortiert nach Jahrgangsstufe, innerhalb der Stufe alphabetisch.",
                  font=("", 10, "italic")).pack(fill="x", pady=(0, 4))

        self.liste = ttk.Treeview(links, columns=("jahrgang", "deadline", "anlass", "baustein", "kursung", "fb"),
                                   show="tree headings", height=20)
        # Klick auf einen Spaltenkopf sortiert die Liste danach, erneuter Klick
        # kehrt die Richtung um. Standard bleibt Jahrgangsstufe + Nachname.
        self._liste_sortierung = None       # None = Standardsortierung
        self._liste_umgekehrt = False
        for spalte, titel in (("#0", "Name"), ("jahrgang", "Jgst."),
                              ("deadline", "Deadline"), ("anlass", "Anlass"),
                              ("baustein", "Baustein"),
                              ("kursung", "Kurs"), ("fb", "FB zuletzt")):
            self.liste.heading(spalte, text=titel,
                               command=lambda sp=spalte: self._liste_sortieren(sp))
        self.liste.column("#0", width=125)
        self.liste.column("jahrgang", width=40, anchor="center")
        self.liste.column("deadline", width=95, anchor="center")
        self.liste.column("anlass", width=110)
        self.liste.column("baustein", width=100)
        self.liste.column("kursung", width=35, anchor="center")
        self.liste.column("fb", width=115, anchor="center")
        self.liste.pack(fill="both", expand=True)
        self.liste.bind("<<TreeviewSelect>>", self._auswahl_geaendert)
        self.liste.tag_configure("dringend", background="#FFC7CE")
        self.liste.tag_configure("bevorstehend", background="#FFEB9C")

        listen_btns = ttk.Frame(links)
        listen_btns.pack(fill="x", pady=(6, 0))
        ttk.Button(listen_btns, text="+ Hinzufügen", command=self.schueler_hinzufuegen).pack(side="left")
        ttk.Button(listen_btns, text="− Entfernen", command=self.schueler_entfernen).pack(side="left", padx=6)

        fb_btns = ttk.Frame(links)
        fb_btns.pack(fill="x", pady=(6, 0))
        ttk.Button(fb_btns, text="War heute im FB", command=self.fb_heute_eintragen).pack(side="left")
        ttk.Button(fb_btns, text="FB-Besuch nachtragen…", command=self.fb_nachtragen).pack(side="left", padx=6)

        # ---------------- rechte Seite: Detailansicht ----------------
        rechts = ttk.Frame(paned, padding=8)
        paned.add(rechts, weight=3)

        kopf = ttk.LabelFrame(rechts, text="Person", padding=8)
        kopf.pack(fill="x")

        self.f_kursung = tk.StringVar()
        self.f_jahrgang = tk.StringVar()
        self.f_hjnote = tk.StringVar()
        self.f_alias = tk.StringVar()
        self.f_letzter_besuch = tk.StringVar()
        self.f_deadline = tk.StringVar()
        self.f_deadline_bem = tk.StringVar()

        self.name_label = ttk.Label(kopf, text="–", font=("", 14, "bold"))
        self.name_label.grid(row=0, column=0, columnspan=4, sticky="w", pady=(0, 6))

        ttk.Label(kopf, text="Kursung").grid(row=1, column=0, sticky="e", padx=4)
        ttk.Combobox(kopf, textvariable=self.f_kursung, values=KURSUNG_OPTIONEN,
                     width=6, state="readonly").grid(row=1, column=1, sticky="w")
        ttk.Label(kopf, text="Jahrgangsstufe").grid(row=1, column=2, sticky="e", padx=4)
        ttk.Entry(kopf, textvariable=self.f_jahrgang, width=6).grid(row=1, column=3, sticky="w")

        ttk.Label(kopf, text="HJ-Note").grid(row=2, column=0, sticky="e", padx=4, pady=(4, 0))
        ttk.Entry(kopf, textvariable=self.f_hjnote, width=6).grid(row=2, column=1, sticky="w", pady=(4, 0))
        ttk.Label(kopf, text="Letzter Besuch FB").grid(row=2, column=2, sticky="e", padx=4, pady=(4, 0))
        ttk.Label(kopf, textvariable=self.f_letzter_besuch).grid(row=2, column=3, sticky="w", pady=(4, 0))

        # Benutzername in der Lerntheken-App. Wird beim Export der Konten und
        # beim Abgleich der Ergebnisse als Zuordnung benutzt.
        ttk.Label(kopf, text="Lerntheken-Alias").grid(row=3, column=0, sticky="e", padx=4, pady=(4, 0))
        ttk.Entry(kopf, textvariable=self.f_alias, width=14).grid(row=3, column=1, sticky="w", pady=(4, 0))
        ttk.Label(kopf, text="(Benutzername in der Lerntheken-App)",
                  foreground="#666").grid(row=3, column=2, columnspan=2, sticky="w", pady=(4, 0))

        # Frei setzbare Frist neben den LZK-Terminen -- z.B. eine Abgabe oder
        # etwas, das mitgebracht werden muss. Der Anlass steht in der Liste
        # direkt neben dem Datum, damit im Gespraech sofort klar ist, worum es geht.
        ttk.Label(kopf, text="Sonstige Deadline").grid(row=4, column=0, sticky="e", padx=4, pady=(4, 0))
        ttk.Entry(kopf, textvariable=self.f_deadline, width=14).grid(row=4, column=1, sticky="w", pady=(4, 0))
        ttk.Label(kopf, text="Anlass").grid(row=4, column=2, sticky="e", padx=4, pady=(4, 0))
        ttk.Entry(kopf, textvariable=self.f_deadline_bem, width=24).grid(row=4, column=3, sticky="w", pady=(4, 0))
        self.deadline_hinweis = ttk.Label(kopf, text="", foreground="#a00")
        self.deadline_hinweis.grid(row=5, column=1, columnspan=3, sticky="w")

        for var in (self.f_kursung, self.f_jahrgang, self.f_hjnote, self.f_alias,
                    self.f_deadline, self.f_deadline_bem):
            var.trace_add("write", lambda *a: self._kopf_uebernehmen())

        baustein_rahmen = ttk.LabelFrame(rechts, text="Bausteine", padding=8)
        baustein_rahmen.pack(fill="both", expand=True, pady=(8, 0))

        spalten = ("status", "bausteinarbeit", "lzk1", "note1", "lzk2", "note2", "halbjahr", "bemerkung")
        self.tabelle = ttk.Treeview(baustein_rahmen, columns=spalten, show="tree headings", height=12)
        self.tabelle.heading("#0", text="Baustein",
                             command=lambda: self._bausteine_sortieren("#0"))
        self._bausteine_sortierung = None      # None = Reihenfolge wie in der Datei
        self._bausteine_umgekehrt = False
        for key, text, width in [
            ("status", "Status", 110), ("bausteinarbeit", "Bausteinarbeit", 140),
            ("lzk1", "LZK 1", 90), ("note1", "Note", 55),
            ("lzk2", "LZK 2", 90), ("note2", "Note", 55),
            ("halbjahr", "HJ", 65), ("bemerkung", "Bemerkung", 260),
        ]:
            self.tabelle.heading(key, text=text,
                                 command=lambda sp=key: self._bausteine_sortieren(sp))
            self.tabelle.column(key, width=width)
        self.tabelle.column("#0", width=170)
        self.tabelle.pack(fill="both", expand=True)
        self.tabelle.bind("<Double-1>", lambda e: self.baustein_bearbeiten())

        for status, farbe in STATUS_FARBEN.items():
            self.tabelle.tag_configure(status, background=f"#{farbe}")
        # Der gerade bearbeitete Baustein (naechster LZK-Termin bzw. offene Frist)
        # wird zusaetzlich hervorgehoben -- er ist beim Gespraech der Einstieg.
        self.tabelle.tag_configure("aktuell", font=("", 10, "bold"))

        baustein_btns = ttk.Frame(baustein_rahmen)
        baustein_btns.pack(fill="x", pady=(6, 0))
        ttk.Button(baustein_btns, text="+ Baustein", command=self.baustein_hinzufuegen).pack(side="left")
        ttk.Button(baustein_btns, text="Bearbeiten", command=self.baustein_bearbeiten).pack(side="left", padx=6)
        ttk.Button(baustein_btns, text="− Entfernen", command=self.baustein_entfernen).pack(side="left")

        self.status_leiste = ttk.Label(self, text="Keine Datei geladen.", anchor="w", padding=4)
        self.status_leiste.pack(fill="x", side="bottom")

        self._letzte_quelle = None
        # Weiterarbeiten, wo zuletzt aufgehoert wurde.
        self._zuletzt_oeffnen()

    # ------------------------------------------------------------------
    # Datei-Aktionen
    # ------------------------------------------------------------------
    @staticmethod
    def _als_json_pfad(pfad: str) -> str:
        """Arbeitsdateien sind immer `.json`. Eine andere Endung wird ersetzt,
        damit niemand versehentlich wieder in einer Excel-Mappe landet -- die
        wird ausschliesslich auf Nachfrage geschrieben (Als Excel exportieren)."""
        return pfad if ist_json_pfad(pfad) else os.path.splitext(pfad)[0] + ".json"

    def _arbeitsdatei_merken(self):
        """Merkt sich, woran gerade gearbeitet wird -- beim naechsten Start
        wird genau diese Datei wieder geoeffnet. Excel muss also nur ein
        einziges Mal importiert werden."""
        if not self.az.dateipfad:
            return
        try:
            self._lt_einstellungen_speichern({"zuletzt_geoeffnet": self.az.dateipfad})
        except OSError:
            pass          # Nicht schreiben zu koennen darf die Arbeit nicht stoeren.

    def _zuletzt_oeffnen(self):
        """Beim Start die zuletzt benutzte Datei wieder laden. Fehlt sie oder
        laesst sie sich nicht lesen, startet die Anwendung wie bisher leer --
        ohne Dialog, der den Start blockiert."""
        pfad = (self._lt_einstellungen_laden() or {}).get("zuletzt_geoeffnet")
        if not pfad or not os.path.exists(pfad):
            return
        try:
            warnungen = self.az.laden(pfad)
        except Exception as e:
            self.status_leiste.config(
                text=f"⚠ Zuletzt benutzte Datei {os.path.basename(pfad)} "
                     f"konnte nicht geladen werden: {e}")
            self.az.dateipfad = None
            return
        self._liste_aktualisieren()
        self._detail_leeren()
        self.ungespeichert = False
        hinweis = f" -- {len(warnungen)} Hinweis(e) beim Laden" if warnungen else ""
        if not ist_json_pfad(pfad):
            # Aus einer aelteren Sitzung stammt hier noch eine Excel-Mappe.
            # Sie wird gelesen, aber nicht weiterbeschrieben: beim ersten
            # Speichern legt die Anwendung die Arbeitsdatei an.
            self.az.dateipfad = None
            self._letzte_quelle = pfad
            hinweis += " -- beim Speichern wird eine Arbeitsdatei (.json) angelegt"
        self._aktualisiere_titel()
        self.status_leiste.config(
            text=f"Geladen: {pfad} ({len(self.az.students)} Personen){hinweis}")

    def _frage_ungespeichert(self) -> bool:
        """True = weitermachen, False = Aktion abbrechen."""
        if not self.ungespeichert:
            return True
        antwort = messagebox.askyesnocancel(
            "Ungespeicherte Änderungen",
            "Es gibt ungespeicherte Änderungen. Vorher speichern?")
        if antwort is None:
            return False
        if antwort:
            return self.speichern()
        return True

    def neu(self):
        if not self._frage_ungespeichert():
            return
        self.az.neu(standard_bausteine=[
            "Baustein 1", "Baustein 2", "Baustein 3",
        ])
        self.aktueller_schueler = None
        self.ungespeichert = False
        self._liste_aktualisieren()
        self._detail_leeren()
        self._aktualisiere_titel()

    def oeffnen(self):
        if not self._frage_ungespeichert():
            return
        pfad = filedialog.askopenfilename(
            title="Arbeitsstände öffnen",
            filetypes=[("Arbeitsstände", "*.json"),
                       ("Excel-Dateien", "*.xlsx *.xlsm"),
                       ("Alle Dateien", "*.*")])
        if pfad:
            self._datei_laden(pfad)

    def excel_importieren(self):
        """Bestehende Excel-Mappe einlesen und ab da im eigenen Format
        weiterarbeiten -- der Weg von der alten Liste in die App."""
        if not self._frage_ungespeichert():
            return
        pfad = filedialog.askopenfilename(
            title="Aus Excel importieren",
            filetypes=[("Excel-Dateien", "*.xlsx *.xlsm"), ("Alle Dateien", "*.*")])
        if pfad:
            self._datei_laden(pfad)

    def _datei_laden(self, pfad: str):
        # Herkunft merken: wird die Frage nach der Arbeitsdatei abgebrochen,
        # schlaegt "Speichern" spaeter denselben Ordner vor.
        self._letzte_quelle = pfad
        try:
            warnungen = self.az.laden(pfad)
        except Exception as e:
            messagebox.showerror("Fehler beim Öffnen", str(e))
            return
        if warnungen:
            messagebox.showwarning("Hinweise beim Öffnen", "\n".join(warnungen))

        self.aktueller_schueler = None
        self._liste_aktualisieren()
        self._detail_leeren()

        if ist_json_pfad(pfad):
            # Eigenes Format: es wird direkt in dieser Datei weitergearbeitet.
            self.ungespeichert = False
            self._arbeitsdatei_merken()
            self.status_leiste.config(text=f"Geladen: {pfad}")
            self._aktualisiere_titel()
            return

        # Aus Excel importiert: die Ausgangsdatei bleibt unangetastet, ab jetzt
        # wird im eigenen Format gearbeitet (verlustfrei und nachbearbeitbar).
        # Excel ist über "Als Excel exportieren…" jederzeit wieder erreichbar.
        basis, _ = os.path.splitext(pfad)
        vorschlag = basis + ".json"
        ziel = filedialog.asksaveasfilename(
            title="Arbeitsdatei anlegen (auch für die automatische Sicherung alle 5 Min.)",
            initialdir=os.path.dirname(vorschlag), initialfile=os.path.basename(vorschlag),
            defaultextension=".json", filetypes=[("Arbeitsstände", "*.json")])

        if ziel:
            ziel = self._als_json_pfad(ziel)
            self.az.dateipfad = ziel
            try:
                self.az.speichern(ziel)
                self.ungespeichert = False
                self._arbeitsdatei_merken()
                self.status_leiste.config(
                    text=f"Aus {os.path.basename(pfad)} übernommen -- Änderungen gehen an {ziel}")
            except Exception as e:
                messagebox.showerror("Fehler beim Speichern", str(e))
                self.ungespeichert = True
        else:
            self.az.dateipfad = None
            self.ungespeichert = False
            self.status_leiste.config(
                text=f"Geladen aus {pfad} -- noch keine Arbeitsdatei gewählt, "
                     f"'Speichern' fragt beim nächsten Mal danach.")
        self._aktualisiere_titel()

    def speichern(self) -> bool:
        # In Excel-Mappen wird nie von selbst geschrieben -- sie sind reines
        # Import-/Exportformat. Steht (noch) keine Arbeitsdatei fest, wird
        # hier eine angelegt.
        if not self.az.dateipfad or not ist_json_pfad(self.az.dateipfad):
            return self.speichern_unter()
        try:
            self.az.speichern(self.az.dateipfad)
        except Exception as e:
            messagebox.showerror("Fehler beim Speichern", str(e))
            return False
        self.ungespeichert = False
        self._arbeitsdatei_merken()
        self._aktualisiere_titel()
        self.status_leiste.config(text=f"Gespeichert: {self.az.dateipfad}")
        return True

    def speichern_unter(self) -> bool:
        vorschlag = self._als_json_pfad(
            self.az.dateipfad or getattr(self, "_letzte_quelle", None)
            or "Arbeitsstaende.json")
        pfad = filedialog.asksaveasfilename(
            title="Arbeitsdatei speichern unter",
            initialdir=os.path.dirname(vorschlag) or None,
            initialfile=os.path.basename(vorschlag),
            defaultextension=".json", filetypes=[("Arbeitsstände", "*.json")])
        if not pfad:
            return False
        pfad = self._als_json_pfad(pfad)
        try:
            self.az.speichern(pfad)
        except Exception as e:
            messagebox.showerror("Fehler beim Speichern", str(e))
            return False
        self.ungespeichert = False
        self._arbeitsdatei_merken()
        self._aktualisiere_titel()
        self.status_leiste.config(text=f"Gespeichert: {pfad}")
        return True

    def excel_exportieren(self):
        """Aktuellen Stand als Excel-Mappe herausschreiben -- zum Ausdrucken
        oder Weitergeben. Die Arbeitsdatei bleibt davon unberührt."""
        if not self.az.students:
            messagebox.showinfo("Nichts zu exportieren", "Es sind keine Personen geladen.")
            return
        basis = os.path.splitext(self.az.dateipfad or "Arbeitsstaende")[0]
        pfad = filedialog.asksaveasfilename(
            title="Als Excel exportieren",
            initialdir=os.path.dirname(basis) or None,
            initialfile=os.path.basename(basis) + ".xlsx",
            defaultextension=".xlsx", filetypes=[("Excel-Datei", "*.xlsx")])
        if not pfad:
            return
        arbeitsdatei = self.az.dateipfad
        try:
            self.az.speichern_excel(pfad)
        except Exception as e:
            messagebox.showerror("Fehler beim Export", str(e))
            return
        finally:
            # speichern_excel() merkt sich den Zielpfad -- der Export darf die
            # Arbeitsdatei aber nicht umhängen.
            self.az.dateipfad = arbeitsdatei
        self.status_leiste.config(text=f"Als Excel exportiert: {pfad}")

    def _autosave_tick(self):
        if (self.ungespeichert and self.az.dateipfad
                and ist_json_pfad(self.az.dateipfad)):
            try:
                self.az.speichern(self.az.dateipfad)
                self.ungespeichert = False
                self._aktualisiere_titel()
                zeit = datetime.now().strftime("%H:%M")
                self._arbeitsdatei_merken()
                self.status_leiste.config(text=f"Automatisch gespeichert um {zeit} Uhr -- {self.az.dateipfad}")
            except Exception as e:
                self.status_leiste.config(text=f"⚠ Automatisches Speichern fehlgeschlagen: {e}")
        self._autosave_job = self.after(AUTOSAVE_INTERVALL_MS, self._autosave_tick)

    def _beenden(self):
        if self._frage_ungespeichert():
            if getattr(self, "_autosave_job", None):
                self.after_cancel(self._autosave_job)
            self.destroy()

    def _aktualisiere_titel(self):
        pfad = self.az.dateipfad or "Unbenannt"
        stern = "•" if self.ungespeichert else ""
        self.title(f"{stern} {os.path.basename(pfad)} — {APP_TITEL}")

    def _markiere_ungespeichert(self):
        self.ungespeichert = True
        self._aktualisiere_titel()

    # ------------------------------------------------------------------
    # Schülerliste
    # ------------------------------------------------------------------
    def _sortier_key(self, student: Student):
        """Jahrgangsstufe zuerst (fehlende Angabe sortiert ans Ende),
        innerhalb der Stufe alphabetisch. Jahrgangsstufe ist ein ganz
        normales, jederzeit nachpflegbares Feld -- eine fehlende oder noch
        falsche Angabe soll die Sortierung also nicht durcheinanderbringen,
        nur konsistent ans Ende der jeweiligen Gruppe stellen."""
        jahrgang = student.jahrgangsstufe if student.jahrgangsstufe is not None else 9999
        return (jahrgang, student.nachname, student.vorname)

    FB_GRUEN_TAGE = 7
    FB_GELB_TAGE = 14

    def _fb_symbol(self, student: Student, heute: date) -> str:
        """Farbindikator nur für die FB-Spalte (Treeview-Zeilen können nur
        eine Hintergrundfarbe insgesamt haben, die ist schon für die
        Deadline-Dringlichkeit vergeben -- deshalb hier ein eingefärbtes
        Symbol direkt im Zelltext statt einer Zeilenfarbe)."""
        if not student.fb_besuche:
            return "🔴"
        tage = (heute - student.fb_besuche[-1]).days
        if tage <= self.FB_GRUEN_TAGE:
            return "🟢"
        elif tage <= self.FB_GELB_TAGE:
            return "🟡"
        return "🔴"

    def _liste_sortieren(self, spalte):
        """Spaltenkopf angeklickt: danach sortieren, bei erneutem Klick umkehren.
        Ein dritter Klick stellt die Standardsortierung wieder her."""
        if self._liste_sortierung != spalte:
            self._liste_sortierung, self._liste_umgekehrt = spalte, False
        elif not self._liste_umgekehrt:
            self._liste_umgekehrt = True
        else:
            self._liste_sortierung, self._liste_umgekehrt = None, False
        self._liste_aktualisieren()

    def _spalten_key(self, student: Student, spalte):
        """Sortierschluessel je Spalte. Leere Werte kommen ans Ende, damit eine
        fehlende Angabe die Reihenfolge nicht zufaellig durcheinanderbringt."""
        heute = date.today()
        if spalte == "#0":
            return (0, student.nachname.lower(), student.vorname.lower())
        if spalte == "jahrgang":
            return (0, student.jahrgangsstufe) if student.jahrgangsstufe is not None else (1, 0)
        if spalte == "kursung":
            return (0, student.kursung) if student.kursung else (1, "")
        if spalte == "fb":
            letzter = student.fb_besuche[-1] if student.fb_besuche else None
            return (0, letzter) if letzter else (1, date.min)
        if spalte == "baustein":
            baustein, _ = self.az.berechne_status(student)
            return (0, str(baustein).lower()) if baustein else (1, "")
        if spalte == "deadline":
            deadline, _ = self.az.deadline_info(student, heute)
            if isinstance(deadline, date):
                return (0, deadline)
            if deadline:
                return (1, heute)      # Hinweistext direkt hinter den echten Terminen
            return (2, date.min)
        if spalte == "anlass":
            _, anlass = self.az.deadline_info(student, heute)
            return (0, anlass.lower()) if anlass else (1, "")
        return (0, student.nachname.lower())

    def _liste_aktualisieren(self):
        markierung = self.liste.selection()
        self.liste.delete(*self.liste.get_children())
        suche = self.suche_var.get().strip().lower()
        heute = date.today()
        if self._liste_sortierung:
            personen = sorted(self.az.students,
                              key=lambda st: self._spalten_key(st, self._liste_sortierung),
                              reverse=self._liste_umgekehrt)
        else:
            personen = sorted(self.az.students, key=self._sortier_key)
        for s in personen:
            if suche and suche not in s.voller_name.lower():
                continue
            baustein, _ = self.az.berechne_status(s)
            # Angezeigt wird die naechste Frist ueberhaupt -- LZK oder frei
            # gesetzte Deadline -- mit ihrem Anlass in der Spalte daneben.
            deadline, anlass = self.az.deadline_info(s, heute)
            if isinstance(deadline, date):
                deadline_text = fmt_datum(deadline)
                tag = "dringend" if deadline < heute else "bevorstehend"
            elif deadline:
                deadline_text = str(deadline)
                tag = "dringend"
            else:
                deadline_text = ""
                tag = ""
            jahrgang_text = str(s.jahrgangsstufe) if s.jahrgangsstufe is not None else ""
            fb_symbol = self._fb_symbol(s, heute)
            fb_text = f"{fb_symbol} {fmt_datum(s.letzter_besuch_fb)}" if s.fb_besuche else f"{fb_symbol} nie"
            self.liste.insert("", "end", iid=s.voller_name, text=s.voller_name,
                               values=(jahrgang_text, deadline_text, anlass, baustein,
                                       s.kursung, fb_text),
                               tags=(tag,) if tag else ())
        vorhanden = set(self.liste.get_children())
        neue_markierung = [m for m in markierung if m in vorhanden]
        if neue_markierung:
            self.liste.selection_set(neue_markierung)

    def _auswahl_geaendert(self, event=None):
        auswahl = self.liste.selection()
        if not auswahl:
            return
        name = auswahl[0]
        self.aktueller_schueler = next((s for s in self.az.students if s.voller_name == name), None)
        self._detail_anzeigen()

    def schueler_hinzufuegen(self):
        vorhandene = {s.voller_name for s in self.az.students}
        dlg = SchuelerDialog(self, vorhandene)
        self.wait_window(dlg)
        if dlg.result is None:
            return
        neuer = dlg.result
        neuer.bausteine = [Baustein(name=n, status="Ausstehend") for n in self.az.vorlage_bausteine]
        self.az.students.append(neuer)
        self._markiere_ungespeichert()
        self._liste_aktualisieren()
        self.liste.selection_set(neuer.voller_name)
        self.liste.see(neuer.voller_name)

    def schueler_entfernen(self):
        if not self.aktueller_schueler:
            messagebox.showinfo("Keine Auswahl", "Bitte zuerst eine Person in der Liste auswählen.")
            return
        name = self.aktueller_schueler.voller_name
        if not messagebox.askyesno("Wirklich entfernen?", f"„{name}“ endgültig aus der Liste entfernen?"):
            return
        self.az.students = [s for s in self.az.students if s.voller_name != name]
        self.aktueller_schueler = None
        self._markiere_ungespeichert()
        self._liste_aktualisieren()
        self._detail_leeren()

    def _ausgewaehlte_schueler(self) -> List[Student]:
        iids = set(self.liste.selection())
        return [s for s in self.az.students if s.voller_name in iids]

    def fb_heute_eintragen(self):
        ausgewaehlt = self._ausgewaehlte_schueler()
        if not ausgewaehlt:
            messagebox.showinfo("Keine Auswahl",
                                 "Bitte eine oder mehrere Personen in der Liste auswählen\n"
                                 "(mehrere geht mit Cmd-Klick bzw. Shift-Klick).")
            return
        heute = date.today()
        for s in ausgewaehlt:
            s.fb_besuch_eintragen(heute)
        self._markiere_ungespeichert()
        self._liste_aktualisieren()
        if self.aktueller_schueler in ausgewaehlt:
            self._detail_anzeigen()
        namen = ", ".join(s.voller_name for s in ausgewaehlt)
        self.status_leiste.config(text=f"FB-Besuch heute ({fmt_datum(heute)}) eingetragen für: {namen}")

    def fb_nachtragen(self):
        ausgewaehlt = self._ausgewaehlte_schueler()
        if not ausgewaehlt:
            messagebox.showinfo("Keine Auswahl",
                                 "Bitte eine oder mehrere Personen in der Liste auswählen\n"
                                 "(mehrere geht mit Cmd-Klick bzw. Shift-Klick).")
            return
        text = simpledialog.askstring(
            "FB-Besuch nachtragen",
            "An welchem Tag waren sie im FB? (TT.MM.JJJJ)",
            initialvalue=fmt_datum(date.today()), parent=self)
        if not text:
            return
        try:
            tag = parse_datum(text)
        except ValueError as e:
            messagebox.showerror("Ungültiges Datum", str(e))
            return
        if tag is None:
            return
        for s in ausgewaehlt:
            s.fb_besuch_eintragen(tag)
        self._markiere_ungespeichert()
        self._liste_aktualisieren()
        if self.aktueller_schueler in ausgewaehlt:
            self._detail_anzeigen()
        namen = ", ".join(s.voller_name for s in ausgewaehlt)
        self.status_leiste.config(text=f"FB-Besuch am {fmt_datum(tag)} nachgetragen für: {namen}")

    # ------------------------------------------------------------------
    # Detailansicht
    # ------------------------------------------------------------------
    def _detail_leeren(self):
        self.name_label.config(text="–")
        self.f_kursung.set("")
        self.f_jahrgang.set("")
        self.f_hjnote.set("")
        self.f_alias.set("")
        self.f_letzter_besuch.set("")
        self.f_deadline.set("")
        self.f_deadline_bem.set("")
        self.deadline_hinweis.config(text="")
        self.tabelle.delete(*self.tabelle.get_children())

    def _detail_anzeigen(self):
        s = self.aktueller_schueler
        if s is None:
            self._detail_leeren()
            return
        self._laden_sperre = True
        self.name_label.config(text=s.voller_name)
        self.f_kursung.set(s.kursung or "")
        self.f_jahrgang.set(str(s.jahrgangsstufe) if s.jahrgangsstufe else "")
        self.f_hjnote.set(s.hj_note or "")
        self.f_alias.set(s.alias or "")
        self.f_letzter_besuch.set(fmt_datum(s.letzter_besuch_fb))
        self.f_deadline.set(fmt_datum(s.sonstige_deadline))
        self.f_deadline_bem.set(s.sonstige_deadline_bemerkung or "")
        self.deadline_hinweis.config(text="")
        self._laden_sperre = False

        self.tabelle.delete(*self.tabelle.get_children())
        aktueller, _ = self.az.berechne_status(s)

        # Anzeige-Reihenfolge; die iid bleibt der echte Listenindex, damit
        # Bearbeiten und Entfernen weiterhin die richtige Zeile treffen.
        eintraege = list(enumerate(s.bausteine))
        if self._bausteine_sortierung:
            eintraege.sort(key=lambda p: self._baustein_key(p[1], self._bausteine_sortierung),
                           reverse=self._bausteine_umgekehrt)

        for i, b in eintraege:
            tags = []
            if aktueller and b.name == aktueller:
                tags.append("aktuell")
            if b.status in STATUS_FARBEN:
                tags.append(b.status)
            self.tabelle.insert("", "end", iid=str(i), text=b.name,
                                 values=(b.status, b.bausteinarbeit,
                                         _mit_bemerkung(fmt_datum(b.lzk_datum_1), b.lzk_bem_1),
                                         b.lzk_note_1,
                                         _mit_bemerkung(fmt_datum(b.lzk_datum_2), b.lzk_bem_2),
                                         b.lzk_note_2,
                                         b.halbjahr, b.bemerkung),
                                 tags=tuple(tags))

    def _baustein_key(self, b: Baustein, spalte):
        """Sortierschluessel je Spalte. Leere Werte ans Ende."""
        def txt(wert):
            wert = (wert or "").strip().lower()
            return (0, wert) if wert else (1, "")
        if spalte == "#0":
            return txt(b.name)
        if spalte == "status":
            return txt(b.status)
        if spalte == "bausteinarbeit":
            return txt(b.bausteinarbeit)
        if spalte == "halbjahr":
            return txt(b.halbjahr)
        if spalte == "bemerkung":
            return txt(b.bemerkung)
        if spalte in ("note1", "note2"):
            return txt(b.lzk_note_1 if spalte == "note1" else b.lzk_note_2)
        if spalte in ("lzk1", "lzk2"):
            d = b.lzk_datum_1 if spalte == "lzk1" else b.lzk_datum_2
            return (0, d) if d else (1, date.min)
        return txt(b.name)

    def _bausteine_sortieren(self, spalte):
        """Spaltenkopf angeklickt: sortieren, umkehren, zurueck zur Dateireihenfolge."""
        if self._bausteine_sortierung != spalte:
            self._bausteine_sortierung, self._bausteine_umgekehrt = spalte, False
        elif not self._bausteine_umgekehrt:
            self._bausteine_umgekehrt = True
        else:
            self._bausteine_sortierung, self._bausteine_umgekehrt = None, False
        self._detail_anzeigen()

    def _kopf_uebernehmen(self):
        if getattr(self, "_laden_sperre", False) or not self.aktueller_schueler:
            return
        s = self.aktueller_schueler
        s.kursung = self.f_kursung.get()
        try:
            s.jahrgangsstufe = int(self.f_jahrgang.get()) if self.f_jahrgang.get().strip() else None
        except ValueError:
            pass
        s.hj_note = self.f_hjnote.get()
        s.alias = self.f_alias.get().strip().lower()
        s.sonstige_deadline_bemerkung = self.f_deadline_bem.get().strip()
        # Beim Tippen ist das Datum zwischendurch unvollstaendig; solange wird
        # der bisherige Wert einfach behalten und der Hinweis angezeigt.
        roh = self.f_deadline.get().strip()
        if not roh:
            s.sonstige_deadline = None
            self.deadline_hinweis.config(text="")
        else:
            try:
                s.sonstige_deadline = parse_datum(roh)
                self.deadline_hinweis.config(text="")
            except ValueError:
                self.deadline_hinweis.config(text="Datum bitte als TT.MM.JJJJ")
        self._markiere_ungespeichert()
        self._liste_aktualisieren()
        self.liste.selection_set(s.voller_name)

    # ------------------------------------------------------------------
    # Lerntheken-App: Aliasse pflegen und exportieren
    # ------------------------------------------------------------------
    def aliasse_ergaenzen(self):
        """Fuellt leere Aliasse mit dem Vorschlag "2 Buchstaben Vorname . 2
        Buchstaben Nachname". Bereits eingetragene Aliasse bleiben unangetastet.

        Mehrdeutigkeiten (zwei Personen ergaeben denselben Alias) werden NICHT
        automatisch aufgeloest, sondern gemeldet -- sonst bekaemen zwei Personen
        stillschweigend denselben Zugang.
        """
        if not self.az.students:
            messagebox.showinfo("Aliasse", "Keine Personen vorhanden.")
            return

        vergeben = {s.alias.strip().lower() for s in self.az.students if s.alias.strip()}
        ergaenzt, konflikte = [], []
        for s in self.az.students:
            if s.alias.strip():
                continue
            vorschlag = alias_vorschlag(s.vorname, s.nachname)
            if not vorschlag:
                konflikte.append(f"{s.voller_name}: kein Vorschlag ableitbar")
                continue
            if vorschlag in vergeben:
                konflikte.append(f"{s.voller_name}: '{vorschlag}' ist schon vergeben")
                continue
            s.alias = vorschlag
            vergeben.add(vorschlag)
            ergaenzt.append(f"{s.voller_name} -> {vorschlag}")

        if ergaenzt:
            self._markiere_ungespeichert()
            self._liste_aktualisieren()
            if self.aktueller_schueler:
                self.f_alias.set(self.aktueller_schueler.alias or "")

        text = f"{len(ergaenzt)} Alias(se) ergaenzt."
        if ergaenzt:
            text += "%s%s" % ("\n\n", "\n".join(ergaenzt[:15]))
            if len(ergaenzt) > 15:
                text += f"\n... und {len(ergaenzt) - 15} weitere"
        if konflikte:
            text += "\n\nBitte von Hand eintragen:\n" + "\n".join(konflikte)
        messagebox.showinfo("Aliasse ergaenzen", text)

    def _alias_dubletten(self):
        """{alias: [Namen]} fuer Aliasse, die mehr als einmal vergeben sind.

        Von Hand eingetragene Aliasse werden nirgends gegen die anderen
        geprueft; ohne diese Kontrolle bekaeme beim Abruf nur eine der beiden
        Personen ihre Zahlen -- und zwar stillschweigend.
        """
        nach_alias = {}
        for s in self.az.students:
            a = s.alias.strip().lower()
            if a:
                nach_alias.setdefault(a, []).append(s.voller_name)
        return {a: n for a, n in nach_alias.items() if len(n) > 1}

    def _dubletten_melden(self, titel) -> bool:
        """Meldet doppelte Aliasse. True = es gibt welche, Aktion abbrechen."""
        dubletten = self._alias_dubletten()
        if not dubletten:
            return False
        text = "\n".join(f"{a}: " + ", ".join(namen)
                         for a, namen in sorted(dubletten.items()))
        messagebox.showerror(
            titel,
            "Derselbe Lerntheken-Alias ist mehrfach vergeben:\n\n" + text +
            "\n\nBitte zuerst eindeutig machen -- sonst bekaeme nur eine der "
            "Personen ihre Ergebnisse.")
        return True

    def aliasse_exportieren(self):
        """Schreibt die Liste fuer den Bulk-Import der Lerntheken-App:
        eine Zeile je Person, "alias,passwort".
        """
        if self._dubletten_melden("Aliasse exportieren"):
            return
        ohne = [s for s in self.az.students if not s.alias.strip()]
        mit = [s for s in self.az.students if s.alias.strip()]
        if not mit:
            messagebox.showwarning(
                "Aliasse exportieren",
                "Keine Aliasse gepflegt.\n\nZuerst 'Bearbeiten -> Fehlende "
                "Lerntheken-Aliasse ergaenzen...' benutzen.")
            return

        passwort = simpledialog.askstring(
            "Start-Passwort",
            "Start-Passwort fuer die neuen Konten (mind. 4 Zeichen).\n\n"
            "Alle exportierten Konten bekommen dasselbe -- lass es die\n"
            "Schueler:innen beim ersten Login aendern.",
            parent=self)
        if passwort is None:
            return
        if len(passwort) < 4:
            messagebox.showerror("Start-Passwort", "Mindestens 4 Zeichen.")
            return

        pfad = filedialog.asksaveasfilename(
            title="Aliasse exportieren", defaultextension=".txt",
            initialfile="lerntheke_konten.txt",
            filetypes=[("Textdatei", "*.txt")])
        if not pfad:
            return
        try:
            with open(pfad, "w", encoding="utf-8") as f:
                for s in sorted(mit, key=lambda x: (x.nachname, x.vorname)):
                    f.write(f"{s.alias.strip().lower()},{passwort}\n")
        except OSError as e:
            messagebox.showerror("Aliasse exportieren", f"Konnte nicht schreiben:\n{e}")
            return

        hinweis = (f"{len(mit)} Konten exportiert nach:\n{pfad}\n\n"
                   "Inhalt in der Lerntheken-App unter 'Mehrere anlegen' einfuegen.")
        if ohne:
            hinweis += (f"\n\nOhne Alias und daher NICHT dabei ({len(ohne)}):\n"
                        + "\n".join(s.voller_name for s in ohne[:10]))
            if len(ohne) > 10:
                hinweis += f"\n... und {len(ohne) - 10} weitere"
        messagebox.showinfo("Aliasse exportieren", hinweis)

    # ------------------------------------------------------------------
    # Lerntheken-App: Einstellungen, Ergebnisse abrufen (nur lesend)
    # ------------------------------------------------------------------
    def _lt_einstellungen_laden(self) -> dict:
        """Server-Adresse und Admin-Benutzername liegen neben der Anwendung.

        Das PASSWORT wird bewusst nicht gespeichert -- es wird bei jeder Aktion
        neu abgefragt. Sonst laege ein Admin-Zugang im Klartext auf der Platte.
        """
        pfad = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "osk_einstellungen.json")
        try:
            with open(pfad, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _lt_einstellungen_speichern(self, werte: dict):
        """Schreibt die uebergebenen Werte in die Einstellungsdatei -- als
        Ergaenzung, damit z.B. die zuletzt geoeffnete Arbeitsdatei nicht
        verlorengeht, wenn nur die Serveradresse geaendert wird."""
        pfad = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "osk_einstellungen.json")
        bestand = self._lt_einstellungen_laden()
        bestand.update(werte)
        with open(pfad, "w", encoding="utf-8") as f:
            json.dump(bestand, f, indent=2, ensure_ascii=False)

    def app_einstellungen(self):
        cfg = self._lt_einstellungen_laden()
        dlg = LerntheckenEinstellungenDialog(self, cfg)
        self.wait_window(dlg)
        if dlg.result is not None:
            self._lt_einstellungen_speichern(dlg.result)
            messagebox.showinfo("Einstellungen", "Gespeichert.")

    def _lt_anmelden(self):
        """Meldet sich an der Lerntheken-App an. Gibt (client, klasse) oder None."""
        cfg = self._lt_einstellungen_laden()
        if not cfg.get("base_url") or not cfg.get("username"):
            # Nicht in ein anderes Menue verweisen, sondern gleich hier anbieten --
            # sonst muss man die Aktion abbrechen, woanders etwas eintragen und
            # von vorn anfangen.
            if not messagebox.askyesno(
                    "Lerntheken-App",
                    "Die Zugangsdaten für die Lerntheken-App fehlen noch.\n\n"
                    "Jetzt eintragen?"):
                return None
            self.app_einstellungen()
            cfg = self._lt_einstellungen_laden()
            if not cfg.get("base_url") or not cfg.get("username"):
                return None
        passwort = simpledialog.askstring(
            "Anmeldung",
            f"Passwort für '{cfg['username']}':", show="*", parent=self)
        if not passwort:
            return None
        try:
            client = osk_sync.AppClient(cfg["base_url"])
            me = client.login(cfg["username"], passwort)
        except SystemExit as e:          # osk_sync meldet Login-/Rollenfehler so
            messagebox.showerror("Anmeldung fehlgeschlagen", str(e))
            return None
        except Exception as e:
            messagebox.showerror("Anmeldung fehlgeschlagen",
                                 f"Keine Verbindung zu {cfg['base_url']}:\n{e}")
            return None
        return client, me.get("klasse", "?")

    def _lt_paare(self):
        """(vorname, nachname, alias) aller Personen mit gepflegtem Alias."""
        return [(s.vorname, s.nachname, s.alias.strip().lower())
                for s in self.az.students if s.alias.strip()]

    def app_ergebnisse_abrufen(self):
        """Holt die Auswertung aus der Lerntheken-App und legt sie als Blatt
        'App-Daten' in die geöffnete Datei.
        """
        if not self.az.students:
            messagebox.showinfo("Ergebnisse abrufen", "Keine Personen vorhanden.")
            return
        if self._dubletten_melden("Ergebnisse abrufen"):
            return
        paare = self._lt_paare()
        if not paare:
            messagebox.showwarning(
                "Ergebnisse abrufen",
                "Keine Lerntheken-Aliasse gepflegt.\n\nZuerst 'Bearbeiten -> "
                "Fehlende Lerntheken-Aliasse ergänzen…' benutzen.")
            return
        angemeldet = self._lt_anmelden()
        if not angemeldet:
            return
        client, klasse = angemeldet
        try:
            payload = client.halbjahr_uebersicht()
        except Exception as e:
            messagebox.showerror("Ergebnisse abrufen", f"Abruf fehlgeschlagen:\n{e}")
            return

        daten = osk_sync.AppDaten()
        daten.uebernehmen(klasse, payload)
        daten.sortiere()

        treffer, ohne = [], []
        for vn, nn, alias in paare:
            if alias in daten.nach_account:
                treffer.append((f"{vn} {nn}", vn, nn, alias))
            else:
                ohne.append(f"{vn} {nn} ({alias})")

        if not treffer:
            messagebox.showwarning(
                "Ergebnisse abrufen",
                f"Kein Alias passt zu einem Konto in Lerngruppe {klasse}.\n\n"
                "Stimmen die Aliasse mit den Benutzernamen in der App überein?")
            return

        # Das Rohdaten-Blatt "App-Daten" gibt es nur, wenn gerade mit einer
        # Excel-Mappe gearbeitet wird. Die eigentlichen Ergebnisse landen
        # ohnehin in den Bausteinlisten und damit in jedem Format.
        zeilen = (osk_sync.schreibe_app_daten(self.az._wb, treffer, daten)
                  if self.az._wb is not None else 0)

        # Je Halbjahr eine Zeile pro bearbeiteter Lerntheke (mit LZK-Terminen und
        # Bearbeitungszeitraum) sowie eine fuer Talks/Input. Wiederholte Abrufe
        # frischen diese Zeilen auf, statt sie zu haeufen.
        lerntheken = client.lerntheken_meta()
        try:
            konten = client.studierende()
        except Exception as e:
            messagebox.showerror("Ergebnisse abrufen", f"Abruf fehlgeschlagen:\n{e}")
            return
        # Passiv gesetzte Konten bleiben aussen vor -- sie sollen weder Zahlen
        # liefern noch als "nicht zuordenbar" gemeldet werden.
        je_konto = {(k.get("username") or "").lower(): k
                    for k in konten if k.get("aktiv", True)}
        inaktiv = sorted((k.get("username") or "").lower()
                         for k in konten if not k.get("aktiv", True))

        stand = datetime.now().strftime("%d.%m.%Y")
        nach_alias = {st.alias.strip().lower(): st
                      for st in self.az.students if st.alias.strip()}
        neu = akt = 0
        ohne_daten = []
        for _, _, _, alias in treffer:
            student = nach_alias.get(alias)
            konto = je_konto.get(alias)
            if not student or not konto:
                if student and alias not in je_konto:
                    ohne_daten.append(f"{student.voller_name} ({alias})")
                continue
            n, a = lt_zeilen_aktualisieren(
                student,
                daten.nach_account.get(alias, {}).get("byHalbjahr", {}),
                konto.get("all_progress") or {},
                konto.get("lzk") or [],
                lerntheken, stand)
            neu += n
            akt += a
        self._detail_anzeigen()

        self._markiere_ungespeichert()

        # Beide Richtungen benennen, damit nichts unbemerkt fehlt:
        # Personen ohne Konto bekommen keine Zahlen, und Konten ohne Person in
        # der Liste werden gar nicht ausgewertet (z.B. Tippfehler im Alias,
        # Zugezogene oder Abgaenge).
        zugeordnet = {t[3] for t in treffer}
        verwaist = sorted(set(daten.nach_account) - zugeordnet)

        text = (f"Lerngruppe {klasse}, nur Mathe.\n"
                f"In den Bausteinlisten: {neu} neu, {akt} aktualisiert.\n")
        if zeilen:
            text += f"Rohdaten im Blatt 'App-Daten': {zeilen} Zeilen.\n"
        text += "\nNoch speichern nicht vergessen."

        def _liste(titel, eintraege, grenze=10):
            if not eintraege:
                return ""
            teil = f"\n\n{titel} ({len(eintraege)}):\n" + "\n".join(eintraege[:grenze])
            if len(eintraege) > grenze:
                teil += f"\n... und {len(eintraege) - grenze} weitere"
            return teil

        text += _liste("Personen ohne passendes Konto -- ohne Zahlen", ohne)
        text += _liste("Konto passiv gesetzt -- uebersprungen", ohne_daten)
        text += _liste("App-Konten ohne Person in der Liste -- nicht ausgewertet",
                       [v for v in verwaist if v not in inaktiv])
        messagebox.showinfo("Ergebnisse abrufen", text)

    # ------------------------------------------------------------------
    # Baustein-Aktionen
    # ------------------------------------------------------------------
    def baustein_hinzufuegen(self):
        if not self.aktueller_schueler:
            messagebox.showinfo("Keine Auswahl", "Bitte zuerst eine Person auswählen.")
            return
        dlg = BausteinDialog(self, vorlage_namen=self.az.vorlage_bausteine)
        self.wait_window(dlg)
        if dlg.result is None:
            return
        self.aktueller_schueler.bausteine.append(dlg.result)
        self._markiere_ungespeichert()
        self._detail_anzeigen()
        self._liste_aktualisieren()

    def baustein_bearbeiten(self):
        if not self.aktueller_schueler:
            return
        auswahl = self.tabelle.selection()
        if not auswahl:
            return
        idx = int(auswahl[0])
        alt = self.aktueller_schueler.bausteine[idx]
        dlg = BausteinDialog(self, baustein=alt, vorlage_namen=self.az.vorlage_bausteine)
        self.wait_window(dlg)
        if dlg.result is None:
            return
        self.aktueller_schueler.bausteine[idx] = dlg.result
        self._markiere_ungespeichert()
        self._detail_anzeigen()
        self._liste_aktualisieren()

    def baustein_entfernen(self):
        if not self.aktueller_schueler:
            return
        auswahl = self.tabelle.selection()
        if not auswahl:
            return
        idx = int(auswahl[0])
        name = self.aktueller_schueler.bausteine[idx].name
        if not messagebox.askyesno("Wirklich entfernen?", f"Baustein „{name}“ entfernen?"):
            return
        del self.aktueller_schueler.bausteine[idx]
        self._markiere_ungespeichert()
        self._detail_anzeigen()

    def vorlage_bearbeiten(self):
        dlg = VorlageDialog(self, self.az.vorlage_bausteine)
        self.wait_window(dlg)
        if dlg.result is None:
            return
        self.az.vorlage_bausteine = dlg.result
        self._markiere_ungespeichert()


def main():
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
