# Lerntheke Kreise & Zylinder – Server

Multi-User-Server mit Login, Fortschrittsspeicherung und Admin-Dashboard.
Hosting: **Render.com** (dauerhaft kostenlos, kein Kreditkarte nötig)

---

## Einrichten (einmalig, ~15 Minuten, alles im Browser)

### Schritt 1: Render-Account erstellen

1. Gehe auf **render.com**
2. Klicke „Get Started for Free"
3. Wähle „Continue with GitHub" → bestätigen
4. Fertig – kein Kreditkarte nötig!

---

### Schritt 2: PostgreSQL-Datenbank anlegen

1. Im Render-Dashboard: Klicke **„New +"** → **„PostgreSQL"**
2. Einstellungen:
   - **Name:** `lerntheke-db`
   - **Region:** `Frankfurt (EU Central)`
   - **Plan:** `Free`
3. Klicke **„Create Database"**
4. Warte bis Status **„Available"** zeigt (~1 Minute)
5. Kopiere die **„Internal Database URL"** – brauchst du gleich!

---

### Schritt 3: Web Service anlegen

1. Klicke **„New +"** → **„Web Service"**
2. Wähle **„Build and deploy from a Git repository"**
3. Verbinde dein GitHub-Repository `lerntheke-kreise`
4. Einstellungen:
   - **Name:** `lerntheke-kreise`
   - **Region:** `Frankfurt (EU Central)`
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** `Free`
5. Klappe **„Advanced"** auf
6. Klicke **„Add Environment Variable"** – zweimal:

   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | *(die Internal Database URL aus Schritt 2)* |
   | `SESSION_SECRET` | *(irgendein langer Text, z.B.:* `MeineSchuleLerntheke2024GeheimesPasswort!`)* |

7. Klicke **„Create Web Service"**

→ Render baut und startet den Server (~3 Minuten)
→ Du bekommst eine URL wie: `https://lerntheke-kreise.onrender.com`

---

### Schritt 4: App öffnen

Klicke auf deine URL → Lerntheke ist online!

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

**Lerntheke aktualisieren:**
1. Neue `kreise-und-zylinder.html` in GitHub hochladen
   (in `public/lerntheken/` ersetzen)
2. Render deployed automatisch innerhalb weniger Minuten

**Neue Lerntheke hinzufügen:**
1. HTML-Datei in `public/lerntheken/` auf GitHub hochladen
2. Render deployed automatisch
3. Erscheint sofort im Dropdown

---

## Hinweis: Schlafmodus

Render Free Tier schläft nach **15 Minuten Inaktivität** ein.
Beim nächsten Aufruf wacht es in ca. **30–50 Sekunden** auf.

**Lösung:** Seite vor dem Unterricht kurz aufrufen.
Oder: Kostenlosen Dienst **UptimeRobot.com** nutzen:
- Account anlegen (kostenlos)
- „Add New Monitor" → HTTP → deine Render-URL
- Interval: 14 Minuten
→ Schläft nie ein!

---

## Datenschutz / DSGVO

- Server und Datenbank laufen in **Frankfurt (EU)** ✓
- Gespeichert: Benutzername, Passwort-Hash, Klasse, Lernfortschritt
- Keine Weitergabe an Dritte
- **Empfehlung:** Keine Klarnamen als Benutzernamen → z.B. Kürzel

---

## Kosten

**Dauerhaft kostenlos:**
- Render Web Service Free Tier: kostenlos
- Render PostgreSQL Free Tier: kostenlos

Keine versteckten Kosten, kein Kreditkarte.

