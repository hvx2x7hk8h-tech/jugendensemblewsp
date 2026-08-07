# Jugendensemble WSP

## Ticketkasse einrichten

Damit Online-Reservierungen in der Admin-Ticketkasse erscheinen, in Netlify unter
`Site configuration → Environment variables` die Variable `GITHUB_TOKEN` hinterlegen.
Der Token benötigt für dieses Repository Lese- und Schreibrechte auf Inhalte. Anschließend
neu deployen. Die Daten liegen in `content/reservations.json` und `content/kiosk.json`.
