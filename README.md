# Lerntheke – Digitale Lernumgebung

Interaktive Lerntheken für den Mathematikunterricht mit Multi-User-Unterstützung, Fortschrittsspeicherung und Admin-Dashboard.

**Live:** [mathe.offene-schule-koeln.online](https://mathe.offene-schule-koeln.online)

---

## Features

- Schüler:innen-Login mit Klassen-Trennung
- Automatische Fortschrittsspeicherung (stationsweise)
- Admin-Dashboard: Nutzer anlegen, Fortschritt einsehen, Lösungen freigeben
- Mehrere Lerntheken parallel betreibbar
- Responsives Design für Tablet und Desktop

---

## Technik

| Komponente | Technologie |
|---|---|
| Backend | Node.js + Express |
| Datenbank | PostgreSQL |
| Session | express-session + connect-pg-simple |
| Deployment | Ubuntu Server + PM2 |

---

## Lokale Entwicklung

```bash
git clone https://github.com/jatofreba/osk-mathe.git
cd osk-mathe
npm install
```

`.env` anlegen:

```
DB_USER=postgres
DB_PASSWORD=dein_passwort
DB_HOST=localhost
DB_PORT=5432
DB_NAME=lerntheke
SESSION_SECRET=irgendein-langer-geheimer-string
PORT=3000
```

Dann:

```bash
node server.js
```

---

## Lerntheken

Neue Lerntheken einfach als HTML-Datei in `public/lerntheken/` ablegen – sie erscheinen automatisch im Dropdown.

---

## Lizenz

Entwickelt für die [Offene Schule Köln](https://offene-schule-koeln.de). Nicht-kommerziell.
