# Logo-Quelldateien

`osklar-logo-original.png` ist das Original, so wie es geliefert wurde
(1536 × 1024 px, Hintergrund #FDFFFD, kein Alphakanal). **Nicht** ausgeliefert –
dieser Ordner liegt bewusst außerhalb von `public/`.

Daraus abgeleitet (mit `System.Drawing` über PowerShell, ohne Zusatzwerkzeuge):

| Datei | Größe | Verwendung |
|---|---|---|
| `public/img/osklar-logo.png` | 440 × 194 | Loginseite, angezeigt mit 64 px Höhe |
| `public/img/osklar-marke-32.png` | 32 × 32 | Tab-Symbol |
| `public/img/osklar-marke-64.png` | 64 × 64 | Tab-Symbol (hochauflösend), Topbar |
| `public/img/osklar-marke-180.png` | 180 × 180 | Startbildschirm-Symbol (iOS) |
| `tools/arbeitsstaende/app/osklar-marke-{32,180}.png` | | Fenstersymbol der Arbeitsstände-App |

## Maße für neue Ableitungen

Im Original gemessen (Hintergrund = Eckfarbe, Toleranz 40):

- **Inhalt gesamt:** x 92…1483, y 150…762 → 1392 × 613
- **Bildmarke allein** (S + Kalender + Punkt): x 92…687
- **Wortmarke** beginnt bei x 617; die Spalten 590…615 sind unterhalb von
  y 400 tintenfrei.

Der obere Schwung des S reicht also **über** den Beginn der Wortmarke hinaus.
Für ein quadratisches Symbol deshalb: Bereich x 92…687 ausschneiden, danach
alles rechts von x 600 unterhalb von y 400 mit der Hintergrundfarbe übermalen,
sonst hängt ein Zipfel vom „O" mit im Bild.
