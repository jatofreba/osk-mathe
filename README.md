# Lerntheke Kreise & Zylinder – Server

Multi-User-Server mit Login, Fortschrittsspeicherung und Admin-Dashboard.
Hosting: **Glitch.com** (dauerhaft kostenlos, kein Kreditkarte nötig)

---

## Einrichten (einmalig, ~10 Minuten, alles im Browser)

### Schritt 1: Glitch-Account erstellen

1. Gehe auf **glitch.com**
2. Klicke „Sign up"
3. Wähle „Sign up with GitHub" → bestätigen
4. Fertig – kein Kreditkarte nötig!

---

### Schritt 2: Neues Projekt aus GitHub importieren

1. Klicke oben rechts auf **„New Project"**
2. Wähle **„Import from GitHub"**
3. Gib deine GitHub-URL ein:
   `https://github.com/DEIN-USERNAME/lerntheke-kreise`
4. Klicke „OK"

→ Glitch importiert alle Dateien und startet automatisch

---

### Schritt 3: SESSION_SECRET setzen

1. Im Glitch-Editor links auf **„.env"** klicken
2. Folgendes eintragen:
```
SESSION_SECRET=einLangerZufaelligerStringDenNurDuKennst2024!
```
3. Datei wird automatisch gespeichert

> **Tipp:** Einfach ein paar zufällige Wörter+Zahlen zusammenwürfeln, z.B.:
> `SESSION_SECRET=Lerntheke2024KreiseZylinder!MeinGeheimnis`

---

### Schritt 4: App öffnen

1. Klicke oben links auf **„Share"**
2. Unter „Live site" findest du deine URL:
   `https://lerntheke-kreise.glitch.me`
3. Klicke darauf → deine Lerntheke ist online!

---

## Erste Anmeldung

Admin-Accounts sind automatisch angelegt:

| Benutzername | Passwort | Klasse |
|---|---|---|
| admin_m1m2 | admin123 | M1M2 |
| admin_m3m4 | admin123 | M3M4 |
| admin_m5m6 | admin123 | M5M6 |
| admin_m7m8 | admin123 | M7M8 |

**⚠️ Bitte sofort Passwort ändern!** (oben rechts → 🔑)

---

## Schüler:innen anlegen

Im Admin-Dashboard → „Bulk anlegen":

```
anna.mueller,Kreise24!
ben.schmidt,Kreise24!
clara.weber,Kreise24!
```

Format: `benutzername,passwort` – eine Zeile pro Person.

---

## Updates einspielen

### Neue Lerntheke hinzufügen
1. In Glitch: links im Dateibaum auf **„public/lerntheken"** klicken
2. **„Upload a file"** → neue HTML-Datei hochladen
3. Erscheint sofort im Dropdown – fertig!

### Lerntheke aktualisieren
1. In Glitch: `public/lerntheken/kreise-und-zylinder.html` anklicken
2. Oben rechts **„•••"** → **„Replace file"** → neue Datei hochladen
3. Sofort online!

### Code aus GitHub aktualisieren
1. In Glitch: unten links **„Tools"** → **„Terminal"**
2. Eingeben:
```bash
git pull https://github.com/DEIN-USERNAME/lerntheke-kreise main
refresh
```

---

## Hinweis: Schlafmodus

Glitch schläft nach **5 Minuten Inaktivität** ein.
Beim nächsten Aufruf wacht es in ca. **20–30 Sekunden** auf.

**Lösung für den Unterricht:**
- Seite einfach vor dem Unterricht kurz aufrufen
- Oder: Einen kostenlosen „Uptime"-Dienst nutzen (z.B. UptimeRobot.com), der die Seite alle 5 Minuten anpingt → schläft nie ein

---

## Datenschutz / DSGVO

- Daten liegen auf Glitch-Servern (USA) ⚠️
- Gespeichert: Benutzername, Passwort-Hash, Klasse, Lernfortschritt
- **Empfehlung:** Keine echten Klarnamen als Benutzernamen verwenden
  → z.B. `schueler01`, `schueler02` oder Kürzel wie `am2024`
- Datenbank-Export jederzeit möglich (Glitch Terminal → `sqlite3 .data/lerntheke.db .dump`)

---

## Kosten

**Dauerhaft kostenlos** – keine versteckten Kosten, kein Kreditkarte.

---

## Umzug auf eigenen Server später

```bash
# Im Glitch Terminal: Datenbank exportieren
sqlite3 .data/lerntheke.db .dump > backup.sql

# Auf eigenem Server wiederherstellen
sqlite3 lerntheke.db < backup.sql
```

