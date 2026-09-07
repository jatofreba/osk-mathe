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
    STATUS_OPTIONEN, KURSUNG_OPTIONEN, STATUS_FARBEN,
)
# Zugriff auf die Lerntheken-App (Anmeldung, Auswertung, Konten anlegen).
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

        b = baustein or Baustein()
        felder = [
            ("Baustein", "name", "entry_or_combo", vorlage_namen),
            ("Status", "status", "combo", STATUS_OPTIONEN),
            ("Bausteinarbeit", "bausteinarbeit", "entry", None),
            ("LZK-Datum 1 (TT.MM.JJJJ)", "lzk_datum_1", "entry", None),
            ("LZK-Note 1", "lzk_note_1", "entry", None),
            ("LZK-Datum 2 (TT.MM.JJJJ)", "lzk_datum_2", "entry", None),
            ("LZK-Note 2", "lzk_note_2", "entry", None),
            ("Halbjahr", "halbjahr", "entry", None),
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
        lerntheke_menu.add_command(label="Konten anlegen…", command=self.app_konten_anlegen)
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

        self.liste = ttk.Treeview(links, columns=("jahrgang", "deadline", "baustein", "kursung", "fb"),
                                   show="tree headings", height=20)
        self.liste.heading("#0", text="Name")
        self.liste.heading("jahrgang", text="Jgst.")
        self.liste.heading("deadline", text="Deadline")
        self.liste.heading("baustein", text="Baustein")
        self.liste.heading("kursung", text="Kurs")
        self.liste.heading("fb", text="FB zuletzt")
        self.liste.column("#0", width=125)
        self.liste.column("jahrgang", width=40, anchor="center")
        self.liste.column("deadline", width=95, anchor="center")
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

        for var in (self.f_kursung, self.f_jahrgang, self.f_hjnote, self.f_alias):
            var.trace_add("write", lambda *a: self._kopf_uebernehmen())

        baustein_rahmen = ttk.LabelFrame(rechts, text="Bausteine", padding=8)
        baustein_rahmen.pack(fill="both", expand=True, pady=(8, 0))

        spalten = ("status", "bausteinarbeit", "lzk1", "note1", "lzk2", "note2", "halbjahr", "bemerkung")
        self.tabelle = ttk.Treeview(baustein_rahmen, columns=spalten, show="tree headings", height=12)
        self.tabelle.heading("#0", text="Baustein")
        for key, text, width in [
            ("status", "Status", 110), ("bausteinarbeit", "Bausteinarbeit", 140),
            ("lzk1", "LZK 1", 90), ("note1", "Note", 55),
            ("lzk2", "LZK 2", 90), ("note2", "Note", 55),
            ("halbjahr", "HJ", 65), ("bemerkung", "Bemerkung", 260),
        ]:
            self.tabelle.heading(key, text=text)
            self.tabelle.column(key, width=width)
        self.tabelle.column("#0", width=170)
        self.tabelle.pack(fill="both", expand=True)
        self.tabelle.bind("<Double-1>", lambda e: self.baustein_bearbeiten())

        for status, farbe in STATUS_FARBEN.items():
            self.tabelle.tag_configure(status, background=f"#{farbe}")

        baustein_btns = ttk.Frame(baustein_rahmen)
        baustein_btns.pack(fill="x", pady=(6, 0))
        ttk.Button(baustein_btns, text="+ Baustein", command=self.baustein_hinzufuegen).pack(side="left")
        ttk.Button(baustein_btns, text="Bearbeiten", command=self.baustein_bearbeiten).pack(side="left", padx=6)
        ttk.Button(baustein_btns, text="− Entfernen", command=self.baustein_entfernen).pack(side="left")

        self.status_leiste = ttk.Label(self, text="Keine Datei geladen.", anchor="w", padding=4)
        self.status_leiste.pack(fill="x", side="bottom")

    # ------------------------------------------------------------------
    # Datei-Aktionen
    # ------------------------------------------------------------------
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
            filetypes=[("Excel-Dateien", "*.xlsx *.xlsm"), ("Alle Dateien", "*.*")])
        if not pfad:
            return
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

        # Die geöffnete Datei bleibt unangetastet -- hier einmalig festlegen,
        # wohin Änderungen (manuell und automatisch alle 5 Minuten)
        # gespeichert werden. Vorschlag: dieselbe Datei, falls schon .xlsx;
        # bei .xlsm dieselbe Datei mit .xlsx-Endung (ohne Makros).
        basis, ext = os.path.splitext(pfad)
        vorschlag = pfad if ext.lower() == ".xlsx" else basis + ".xlsx"
        ziel = filedialog.asksaveasfilename(
            title="Änderungen speichern unter (auch für die automatische Sicherung alle 5 Min.)",
            initialdir=os.path.dirname(vorschlag), initialfile=os.path.basename(vorschlag),
            defaultextension=".xlsx", filetypes=[("Excel-Datei", "*.xlsx")])

        if ziel:
            self.az.dateipfad = ziel
            try:
                self.az.speichern(ziel)
                self.ungespeichert = False
                self.status_leiste.config(text=f"Geladen aus {pfad} -- Änderungen gehen an {ziel}")
            except Exception as e:
                messagebox.showerror("Fehler beim Speichern", str(e))
                self.ungespeichert = True
        else:
            self.az.dateipfad = None
            self.ungespeichert = False
            self.status_leiste.config(
                text=f"Geladen aus {pfad} -- noch keine Zieldatei gewählt, "
                     f"'Speichern' fragt beim nächsten Mal danach.")
        self._aktualisiere_titel()

    def speichern(self) -> bool:
        if not self.az.dateipfad:
            return self.speichern_unter()
        try:
            self.az.speichern(self.az.dateipfad)
        except Exception as e:
            messagebox.showerror("Fehler beim Speichern", str(e))
            return False
        self.ungespeichert = False
        self._aktualisiere_titel()
        self.status_leiste.config(text=f"Gespeichert: {self.az.dateipfad}")
        return True

    def speichern_unter(self) -> bool:
        pfad = filedialog.asksaveasfilename(
            title="Speichern unter",
            defaultextension=".xlsx",
            filetypes=[("Excel-Datei", "*.xlsx")])
        if not pfad:
            return False
        try:
            self.az.speichern(pfad)
        except Exception as e:
            messagebox.showerror("Fehler beim Speichern", str(e))
            return False
        self.ungespeichert = False
        self._aktualisiere_titel()
        self.status_leiste.config(text=f"Gespeichert: {pfad}")
        return True

    def _autosave_tick(self):
        if self.ungespeichert and self.az.dateipfad:
            try:
                self.az.speichern(self.az.dateipfad)
                self.ungespeichert = False
                self._aktualisiere_titel()
                zeit = datetime.now().strftime("%H:%M")
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

    def _liste_aktualisieren(self):
        markierung = self.liste.selection()
        self.liste.delete(*self.liste.get_children())
        suche = self.suche_var.get().strip().lower()
        heute = date.today()
        for s in sorted(self.az.students, key=self._sortier_key):
            if suche and suche not in s.voller_name.lower():
                continue
            baustein, deadline = self.az.berechne_status(s)
            if deadline == "Frist vereinbaren!":
                deadline_text = deadline
                tag = "dringend"
            elif isinstance(deadline, date):
                deadline_text = fmt_datum(deadline)
                tag = "dringend" if deadline < heute else "bevorstehend"
            else:
                deadline_text = ""
                tag = ""
            jahrgang_text = str(s.jahrgangsstufe) if s.jahrgangsstufe is not None else ""
            fb_symbol = self._fb_symbol(s, heute)
            fb_text = f"{fb_symbol} {fmt_datum(s.letzter_besuch_fb)}" if s.fb_besuche else f"{fb_symbol} nie"
            self.liste.insert("", "end", iid=s.voller_name, text=s.voller_name,
                               values=(jahrgang_text, deadline_text, baustein, s.kursung, fb_text),
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
        self._laden_sperre = False

        self.tabelle.delete(*self.tabelle.get_children())
        for i, b in enumerate(s.bausteine):
            self.tabelle.insert("", "end", iid=str(i), text=b.name,
                                 values=(b.status, b.bausteinarbeit,
                                         fmt_datum(b.lzk_datum_1), b.lzk_note_1,
                                         fmt_datum(b.lzk_datum_2), b.lzk_note_2,
                                         b.halbjahr, b.bemerkung),
                                 tags=(b.status,) if b.status in STATUS_FARBEN else ())

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
        if not self.daten.students:
            messagebox.showinfo("Aliasse", "Keine Personen vorhanden.")
            return

        vergeben = {s.alias.strip().lower() for s in self.daten.students if s.alias.strip()}
        ergaenzt, konflikte = [], []
        for s in self.daten.students:
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

    def aliasse_exportieren(self):
        """Schreibt die Liste fuer den Bulk-Import der Lerntheken-App:
        eine Zeile je Person, "alias,passwort".
        """
        ohne = [s for s in self.daten.students if not s.alias.strip()]
        mit = [s for s in self.daten.students if s.alias.strip()]
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
    # Lerntheken-App: Einstellungen, Ergebnisse abrufen, Konten anlegen
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
        pfad = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "osk_einstellungen.json")
        with open(pfad, "w", encoding="utf-8") as f:
            json.dump(werte, f, indent=2, ensure_ascii=False)

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
            messagebox.showwarning(
                "Lerntheken-App",
                "Zuerst unter 'Lerntheken-App -> Einstellungen…' die Adresse "
                "und den Admin-Benutzernamen eintragen.")
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
                for s in self.daten.students if s.alias.strip()]

    def app_ergebnisse_abrufen(self):
        """Holt die Auswertung aus der Lerntheken-App und legt sie als Blatt
        'App-Daten' in die geöffnete Datei.
        """
        if not self.daten.students:
            messagebox.showinfo("Ergebnisse abrufen", "Keine Personen vorhanden.")
            return
        paare = self._lt_paare()
        if not paare:
            messagebox.showwarning(
                "Ergebnisse abrufen",
                "Keine Lerntheken-Aliasse gepflegt.\n\nZuerst 'Bearbeiten -> "
                "Fehlende Lerntheken-Aliasse ergänzen…' benutzen.")
            return
        if self.daten._wb is None:
            messagebox.showwarning(
                "Ergebnisse abrufen",
                "Bitte die Datei zuerst speichern -- die Ergebnisse werden als "
                "zusätzliches Blatt in diese Mappe geschrieben.")
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

        zeilen = osk_sync.schreibe_app_daten(self.daten._wb, treffer, daten)
        self._markiere_ungespeichert()
        text = (f"{zeilen} Zeilen im Blatt 'App-Daten' aktualisiert "
                f"(Lerngruppe {klasse}).\n\nNoch speichern nicht vergessen.")
        if ohne:
            text += (f"\n\nOhne passendes Konto ({len(ohne)}):\n"
                     + "\n".join(ohne[:10]))
            if len(ohne) > 10:
                text += f"\n... und {len(ohne) - 10} weitere"
        messagebox.showinfo("Ergebnisse abrufen", text)

    def app_konten_anlegen(self):
        """Legt für alle Personen mit Alias, die in der App noch kein Konto
        haben, eines an -- in der Lerngruppe des angemeldeten Admin-Kontos.
        """
        paare = self._lt_paare()
        if not paare:
            messagebox.showwarning(
                "Konten anlegen",
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
            messagebox.showerror("Konten anlegen", f"Abruf fehlgeschlagen:\n{e}")
            return
        vorhanden = {(s.get("username") or "").lower()
                     for s in payload.get("students", [])}
        fehlend = [(vn, nn, a) for vn, nn, a in paare if a not in vorhanden]
        if not fehlend:
            messagebox.showinfo(
                "Konten anlegen",
                f"Alle {len(paare)} Personen haben in Lerngruppe {klasse} "
                f"bereits ein Konto.")
            return

        passwort = simpledialog.askstring(
            "Start-Passwort",
            "Start-Passwort für die neuen Konten (mind. 4 Zeichen).\n\n"
            "Alle bekommen dasselbe -- lass es die Schüler:innen\n"
            "beim ersten Login ändern.", parent=self)
        if passwort is None:
            return
        if len(passwort) < 4:
            messagebox.showerror("Start-Passwort", "Mindestens 4 Zeichen.")
            return

        vorschau = "\n".join(f"{a}  ({vn} {nn})" for vn, nn, a in fehlend[:12])
        if len(fehlend) > 12:
            vorschau += f"\n... und {len(fehlend) - 12} weitere"
        if not messagebox.askyesno(
                "Konten anlegen",
                f"{len(fehlend)} Konten in Lerngruppe {klasse} anlegen?\n\n{vorschau}"):
            return

        try:
            ergebnis = client.bulk_create(
                [{"username": a, "password": passwort} for _, _, a in fehlend])
        except Exception as e:
            messagebox.showerror("Konten anlegen", f"Anlegen fehlgeschlagen:\n{e}")
            return
        messagebox.showinfo(
            "Konten anlegen",
            f"Angelegt: {ergebnis.get('created', 0)}\n"
            f"Übersprungen: {ergebnis.get('skipped', 0)} (Name bereits vergeben)")

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
