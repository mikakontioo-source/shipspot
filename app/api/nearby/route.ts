import { NextRequest, NextResponse } from "next/server";

const DIGITRAFFIC = "https://meri.digitraffic.fi/api/ais/v1";
const USER_HEADER = "ShipSpot/Finland-MVP";
const MAX_AGE_MS = 15 * 60 * 1000;

type GeoFeature = {
  mmsi?: number;
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, unknown>;
};

type VesselMeta = Record<string, unknown>;

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function cardinal(deg: number) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function shipType(type: number | null) {
  if (type === null) return "Vessel";
  if (type === 36) return "Sailing vessel";
  if (type === 37) return "Pleasure craft";
  if (type === 50) return "Pilot vessel";
  if (type === 51) return "Search & rescue";
  if (type === 52 || type === 31 || type === 32) return "Tug";
  if (type === 53) return "Port tender";
  if (type === 55) return "Law enforcement";
  if (type >= 60 && type <= 69) return "Passenger ship";
  if (type >= 70 && type <= 79) return "Cargo ship";
  if (type >= 80 && type <= 89) return "Tanker";
  if (type >= 40 && type <= 49) return "High speed craft";
  return "Vessel";
}

function metaValue(meta: VesselMeta, key: string) {
  if (key in meta) return meta[key];
  const props = meta.properties;
  if (props && typeof props === "object" && key in (props as Record<string, unknown>)) {
    return (props as Record<string, unknown>)[key];
  }
  return undefined;
}

async function fetchMeta(mmsi: number): Promise<VesselMeta | null> {
  const headers = {
    "Digitraffic-User": USER_HEADER,
    "Accept-Encoding": "gzip",
    "Accept": "application/json"
  };

  // Current AIS API supports vessel metadata by MMSI path.
  const urls = [
    `${DIGITRAFFIC}/vessels/${mmsi}`,
    `${DIGITRAFFIC}/vessels?mmsi=${mmsi}`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers, next: { revalidate: 300 } });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) return (data[0] ?? null) as VesselMeta | null;
      if (Array.isArray(data?.features) && data.features[0]) {
        return (data.features[0].properties ?? data.features[0]) as VesselMeta;
      }
      return data as VesselMeta;
    } catch {
      // Try fallback URL.
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const radius = Math.min(Math.max(Number(params.get("radius") || 25), 1), 100);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Missing or invalid lat/lon." }, { status: 400 });
  }

  const url = new URL(`${DIGITRAFFIC}/locations`);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("radius", String(radius));
  // Give a freshness hint as well as filtering locally.
  url.searchParams.set("from", String(Date.now() - MAX_AGE_MS));

  try {
    const response = await fetch(url, {
      headers: {
        "Digitraffic-User": USER_HEADER,
        "Accept-Encoding": "gzip",
        "Accept": "application/json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      const body = await response.text();
      return NextResponse.json(
        { error: `Digitraffic returned ${response.status}`, details: body.slice(0, 300) },
        { status: 502 }
      );
    }

    const data = await response.json();
    const rawFeatures: GeoFeature[] = Array.isArray(data?.features)
      ? data.features
      : Array.isArray(data)
        ? data
        : [];

    const now = Date.now();

    const positions = rawFeatures
      .map((feature) => {
        const p = (feature.properties || {}) as Record<string, unknown>;
        const coords = feature.geometry?.coordinates;
        const vesselLat =
          coords && coords.length >= 2 ? toNumber(coords[1]) : toNumber(p.lat);
        const vesselLon =
          coords && coords.length >= 2 ? toNumber(coords[0]) : toNumber(p.lon);
        const mmsi = toNumber(feature.mmsi ?? p.mmsi);
        const externalTs = toNumber(p.timestampExternal);
        const timeTs = toNumber(p.time);
        const timestampExternal =
          externalTs !== null
            ? externalTs
            : timeTs !== null && timeTs > 1_000_000_000
              ? timeTs * 1000
              : null;

        if (vesselLat === null || vesselLon === null || mmsi === null) return null;

        const ageMs = timestampExternal ? now - timestampExternal : null;
        if (ageMs !== null && ageMs > MAX_AGE_MS) return null;

        const distanceKm = haversineKm(lat, lon, vesselLat, vesselLon);
        if (distanceKm > radius) return null;

        const bearing = bearingDeg(lat, lon, vesselLat, vesselLon);

        return {
          mmsi,
          lat: vesselLat,
          lon: vesselLon,
          distanceKm,
          bearing,
          direction: cardinal(bearing),
          sog: toNumber(p.sog),
          cog: toNumber(p.cog),
          heading: toNumber(p.heading),
          navStat: toNumber(p.navStat),
          timestampExternal
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.distanceKm - b.distanceKm)
      .slice(0, 10) as Array<Record<string, any>>;

    const enriched = await Promise.all(
      positions.map(async (position) => {
        const meta = await fetchMeta(position.mmsi);
        const type = toNumber(meta ? metaValue(meta, "type") : null);
        const refA = toNumber(meta ? metaValue(meta, "refA") : null) ?? 0;
        const refB = toNumber(meta ? metaValue(meta, "refB") : null) ?? 0;
        const refC = toNumber(meta ? metaValue(meta, "refC") : null) ?? 0;
        const refD = toNumber(meta ? metaValue(meta, "refD") : null) ?? 0;

        return {
          ...position,
          name: String(meta ? metaValue(meta, "name") ?? `MMSI ${position.mmsi}` : `MMSI ${position.mmsi}`).trim(),
          type,
          typeLabel: shipType(type),
          destination: String(meta ? metaValue(meta, "destination") ?? "" : "").trim(),
          callSign: String(meta ? metaValue(meta, "callSign") ?? "" : "").trim(),
          imo: toNumber(meta ? metaValue(meta, "imo") : null),
          draught: toNumber(meta ? metaValue(meta, "draught") : null),
          eta: toNumber(meta ? metaValue(meta, "eta") : null),
          lengthM: refA + refB || null,
          widthM: refC + refD || null
        };
      })
    );

    return NextResponse.json({
      source: "Fintraffic / Digitraffic",
      dataUpdatedTime: data?.dataUpdatedTime ?? null,
      center: { lat, lon, radius },
      vessels: enriched
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to load AIS data.",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
