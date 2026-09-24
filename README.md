# ShipSpot – Finland MVP v0.1

A mobile-first ShipSpot prototype using Finnish live AIS data from Fintraffic / Digitraffic.

## What works

- GPS location in the browser
- Finland AIS lookup around the user
- 10 nearest fresh vessels
- Vessel name, type, distance, direction, speed, course, destination, IMO/MMSI/call sign, dimensions when available
- Ship detail view
- Radar view
- “I spotted this” local logbook
- Last successful nearby response cached locally
- Helsinki fallback position if GPS is unavailable
- Installable PWA manifest
- Responsive mobile UI

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Browser geolocation normally requires HTTPS, except localhost.

## Deploy to Vercel

1. Upload/import the project to GitHub or Vercel.
2. Framework preset: Next.js.
3. No environment variables are required.
4. Deploy.
5. Allow location access in the browser.

## AIS architecture

Client:
`GPS -> /api/nearby`

Server route:
`/api/nearby -> Digitraffic locations -> fresh-position filter -> nearest 10 -> vessel metadata -> normalized response`

The server route adds:
- `Digitraffic-User: ShipSpot/Finland-MVP`
- `Accept-Encoding: gzip`

Current search radius can be changed in Settings: 10 / 25 / 50 / 100 km.

## Data attribution

Vessel position and metadata:
Fintraffic / Digitraffic.

Before public release, add the exact CC BY 4.0 attribution wording and link to the app About / data sources screen.

## Next build steps

1. Test the REST response on an actual Helsinki/coastal device.
2. Tune freshness window (currently 15 minutes).
3. Replace generic ship silhouette with type-specific silhouettes.
4. Add vessel-photo strategy.
5. Add map layer after radar is stable.
6. Move from periodic REST refresh to MQTT/WebSocket when useful.
7. Wrap as native store app (e.g. Capacitor) after the web/PWA flow is stable.
