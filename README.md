# Wukaninchen Stundenerfassung

Eine Web-App zur Arbeitszeiterfassung für Wukaninchen e.V.

## Features

- Optimiert für Smartphones
- Lädt Dienstplan automatisch aus Nextcloud
- Einfache Abweichungs-Erfassung per Button-Klick
- Übersicht für die Leitung mit Genehmigungsworkflow
- Automatischer Pausenabzug (0.5 Std bei 6+ Arbeitsstunden)
- Speichert Einträge in Nextcloud (JSON-Datei)
- Status-Tracking: Offen, Eingereicht, Genehmigt, Abgelehnt

## Workflow

### Mitarbeiter
1. App öffnen, Name auswählen
2. Woche auswählen
3. Für jeden Tag: Abweichung eingeben (oder "Wie geplant")
4. "Speichern" klicken

### Leitung (Catharina)
1. "Übersicht (Leitung)" öffnen
2. Eingereichte Einträge sehen (blau markiert)
3. Auf Mitarbeiter klicken zum Genehmigen/Ablehnen

## Deployment auf Vercel

### 1. Repository auf GitHub erstellen

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/DEIN-USERNAME/wukaninchen-stundenerfassung.git
git push -u origin main
```

### 2. Auf Vercel deployen

1. Gehe zu [vercel.com](https://vercel.com)
2. Klicke "Add New Project"
3. Importiere dein GitHub Repository
4. **Wichtig:** Füge Environment Variables hinzu:

| Variable | Wert |
|----------|------|
| `NEXTCLOUD_URL` | `https://cloud.wukaninchen.net` |
| `NEXTCLOUD_USER` | `kim.mahler` |
| `NEXTCLOUD_PASS` | `dein-app-passwort` |
| `DIENSTPLAN_PATH` | `/03 Kinderbetreuung/Pädagogik/Dienstpläne/` |

5. Klicke "Deploy"

### 3. Fertig!

Die App ist jetzt unter `https://dein-projekt.vercel.app` erreichbar.

## Lokale Entwicklung

```bash
npm install
cp .env.example .env.local
# Bearbeite .env.local mit deinen Zugangsdaten
npm run dev
```

Öffne [http://localhost:3000](http://localhost:3000)

## Technologie

- [Next.js 16](https://nextjs.org/) - React Framework
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [SheetJS](https://sheetjs.com/) - Excel/ODS Parsing
- WebDAV - Nextcloud-Anbindung

## Datenstruktur

Einträge werden als JSON in Nextcloud gespeichert:
- Datei: `Stundeneintraege_YYYY_MM.json`
- Pfad: Gleicher Ordner wie Dienstpläne

```json
{
  "eintraege": {
    "Alina-0-2": { "value": "+1", "timestamp": "...", "mitarbeiter": "Alina" }
  },
  "submissions": {
    "Alina-2025-12": { "status": "eingereicht", "timestamp": "..." }
  },
  "approvals": {
    "Alina-2025-12": { "status": "genehmigt", "timestamp": "..." }
  }
}
```
