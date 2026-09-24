"use client";

import { useEffect, useMemo, useState } from "react";

type Vessel = {
  mmsi: number;
  lat: number;
  lon: number;
  distanceKm: number;
  bearing: number;
  direction: string;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  navStat: number | null;
  timestampExternal: number | null;
  name: string;
  type: number | null;
  typeLabel: string;
  destination: string;
  callSign: string;
  imo: number | null;
  draught: number | null;
  eta: number | null;
  lengthM: number | null;
  widthM: number | null;
};

type Spot = {
  id: string;
  mmsi: number;
  name: string;
  typeLabel: string;
  date: string;
  lat: number;
  lon: number;
  distanceKm: number;
};

type Tab = "nearby" | "radar" | "spots" | "settings";

const HELSINKI = { lat: 60.1675, lon: 24.9537 };

function Arrow({ deg = 0, size = 20 }: { deg?: number; size?: number }) {
  return (
    <span
      className="direction-arrow"
      style={{ transform: `rotate(${deg}deg)`, width: size, height: size }}
      aria-hidden="true"
    >
      ↑
    </span>
  );
}

function ShipIcon({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M31 5h2v11h12l4 12 9 4-6 19c-5 4-12 7-20 8-8-1-15-4-20-8L6 32l9-4 4-12h12V5Zm-9 17-2 7h24l-2-7H22Zm-8 12 4 13c4 3 9 5 14 6 5-1 10-3 14-6l4-13-18 8-18-8Z"
        fill="currentColor"
      />
    </svg>
  );
}

function NavIcon({ name }: { name: Tab }) {
  if (name === "nearby") return <ShipIcon size={22} />;
  if (name === "radar") return <span className="nav-glyph">◎</span>;
  if (name === "spots") return <span className="nav-glyph">★</span>;
  return <span className="nav-glyph">⚙</span>;
}

function fmtKm(n: number) {
  return n < 10 ? `${n.toFixed(1)} km` : `${Math.round(n)} km`;
}

function fmtKnots(n: number | null) {
  return n === null ? "—" : `${n.toFixed(1)} kn`;
}

function navStatus(code: number | null) {
  const map: Record<number, string> = {
    0: "Under way",
    1: "At anchor",
    2: "Not under command",
    3: "Restricted manoeuvrability",
    4: "Constrained by draught",
    5: "Moored",
    6: "Aground",
    7: "Fishing",
    8: "Sailing"
  };
  return code === null ? "Unknown" : map[code] ?? "Under way";
}

function useLocalStorageNumber(key: string, fallback: number) {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    const saved = window.localStorage.getItem(key);
    if (saved) setValue(Number(saved) || fallback);
  }, [key, fallback]);
  const save = (next: number) => {
    setValue(next);
    window.localStorage.setItem(key, String(next));
  };
  return [value, save] as const;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("nearby");
  const [selected, setSelected] = useState<Vessel | null>(null);
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState("Finding your location");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("GPS");
  const [error, setError] = useState("");
  const [spots, setSpots] = useState<Spot[]>([]);
  const [radius, setRadius] = useLocalStorageNumber("shipspot-radius", 25);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("shipspot-spots") || "[]");
      if (Array.isArray(saved)) setSpots(saved);
    } catch {}
  }, []);

  function persistSpots(next: Spot[]) {
    setSpots(next);
    localStorage.setItem("shipspot-spots", JSON.stringify(next));
  }

  async function loadNearby(
    pos: { lat: number; lon: number },
    useCache = true,
    radiusOverride?: number
  ) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/nearby?lat=${encodeURIComponent(pos.lat)}&lon=${encodeURIComponent(pos.lon)}&radius=${radiusOverride ?? radius}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`AIS request failed (${res.status})`);
      const data = await res.json();
      const next = Array.isArray(data.vessels) ? data.vessels : [];
      setVessels(next);
      setStatus("LIVE");
      localStorage.setItem(
        "shipspot-last-nearby",
        JSON.stringify({ savedAt: Date.now(), vessels: next })
      );
    } catch (e) {
      if (useCache) {
        try {
          const cached = JSON.parse(localStorage.getItem("shipspot-last-nearby") || "null");
          if (cached?.vessels?.length) {
            setVessels(cached.vessels);
            setStatus("CACHED");
            setError("Live AIS unavailable — showing the last saved vessels.");
            return;
          }
        } catch {}
      }
      setError(e instanceof Error ? e.message : "Unable to load AIS data.");
      setStatus("OFFLINE");
    } finally {
      setLoading(false);
    }
  }

  function requestLocation() {
    setLoading(true);
    setLocationLabel("Finding your location");
    if (!navigator.geolocation) {
      setPosition(HELSINKI);
      setLocationLabel("Helsinki test position");
      loadNearby(HELSINKI);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setPosition(next);
        setLocationLabel("Your location");
        loadNearby(next);
      },
      () => {
        setPosition(HELSINKI);
        setLocationLabel("Helsinki test position");
        setError("GPS permission was not available. Using Helsinki test position.");
        loadNearby(HELSINKI);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  useEffect(() => {
    requestLocation();
    // Radius changes are handled from Settings refresh to avoid duplicate geolocation prompts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function spot(v: Vessel) {
    const nextSpot: Spot = {
      id: `${v.mmsi}-${Date.now()}`,
      mmsi: v.mmsi,
      name: v.name,
      typeLabel: v.typeLabel,
      date: new Date().toISOString(),
      lat: position?.lat ?? 0,
      lon: position?.lon ?? 0,
      distanceKm: v.distanceKm
    };
    persistSpots([nextSpot, ...spots]);
  }

  function goTab(next: Tab) {
    setSelected(null);
    setTab(next);
  }

  const nearest = vessels[0] || null;

  const radarVessels = useMemo(
    () => vessels.filter((v) => v.distanceKm <= radius),
    [vessels, radius]
  );

  if (selected) {
    const alreadySpotted = spots.some((s) => s.mmsi === selected.mmsi);
    return (
      <main className="app-shell detail-shell">
        <header className="topbar">
          <button className="icon-button" onClick={() => setSelected(null)} aria-label="Back">
            ←
          </button>
          <div className="topbar-title">{selected.name}</div>
          <div className="live-pill"><span /> {status}</div>
        </header>

        <section className="ship-hero">
          <div className="ship-waterline" />
          <div className="hero-ship"><ShipIcon size={124} /></div>
          <div className="hero-distance">{fmtKm(selected.distanceKm)}</div>
        </section>

        <section className="detail-content">
          <div className="eyebrow">{selected.typeLabel}</div>
          <h1>{selected.name}</h1>
          <div className="detail-direction">
            <Arrow deg={selected.bearing} size={22} />
            <span>{Math.round(selected.bearing)}° {selected.direction}</span>
          </div>

          <div className="metrics-grid">
            <div><span>Speed</span><strong>{fmtKnots(selected.sog)}</strong></div>
            <div><span>Course</span><strong>{selected.cog === null ? "—" : `${Math.round(selected.cog)}°`}</strong></div>
            <div><span>Status</span><strong>{navStatus(selected.navStat)}</strong></div>
          </div>

          <div className="destination-card">
            <span>Destination</span>
            <strong>{selected.destination || "Not reported"}</strong>
          </div>

          <div className="data-list">
            <div><span>Length</span><b>{selected.lengthM ? `${selected.lengthM} m` : "—"}</b></div>
            <div><span>Width</span><b>{selected.widthM ? `${selected.widthM} m` : "—"}</b></div>
            <div><span>IMO</span><b>{selected.imo || "—"}</b></div>
            <div><span>MMSI</span><b>{selected.mmsi}</b></div>
            <div><span>Call sign</span><b>{selected.callSign || "—"}</b></div>
          </div>

          <button
            className={`spot-button ${alreadySpotted ? "spotted" : ""}`}
            onClick={() => !alreadySpotted && spot(selected)}
          >
            {alreadySpotted ? "✓ SPOTTED" : "✓ I SPOTTED THIS"}
          </button>
        </section>
        <div className="source-note">AIS: Fintraffic / Digitraffic</div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="brandbar">
        <div>
          <div className="brand">SHIP<span>SPOT</span></div>
          <div className="subbrand">{locationLabel}</div>
        </div>
        <div className={`live-pill ${status.toLowerCase()}`}><span /> {status}</div>
      </header>

      {tab === "nearby" && (
        <section className="screen">
          {error && <div className="notice">{error}</div>}

          {loading && !nearest ? (
            <div className="loading-card">
              <div className="sonar-loader"><i/><i/><i/></div>
              <strong>Looking for nearby ships</strong>
              <span>Live AIS · Finland</span>
            </div>
          ) : nearest ? (
            <>
              <div className="section-label">NEAREST SHIP</div>
              <button className="nearest-card" onClick={() => setSelected(nearest)}>
                <div className="nearest-top">
                  <div className="ship-visual">
                    <div className="water" />
                    <ShipIcon size={88} />
                  </div>
                  <div className="distance-badge">{fmtKm(nearest.distanceKm)}</div>
                </div>
                <div className="nearest-body">
                  <div className="type-line">{nearest.typeLabel}</div>
                  <h1>{nearest.name}</h1>
                  <div className="nearest-meta">
                    <span><Arrow deg={nearest.bearing} /> {nearest.direction}</span>
                    <span>{fmtKnots(nearest.sog)}</span>
                    {nearest.destination && <span>→ {nearest.destination}</span>}
                  </div>
                  <div className="view-link">VIEW SHIP <b>→</b></div>
                </div>
              </button>

              <div className="list-head">
                <span>NEARBY</span>
                <span>{vessels.length} vessels · {radius} km</span>
              </div>

              <div className="vessel-list">
                {vessels.slice(1).map((v) => (
                  <button key={v.mmsi} className="vessel-row" onClick={() => setSelected(v)}>
                    <div className="row-icon"><ShipIcon size={26} /></div>
                    <div className="row-main">
                      <strong>{v.name}</strong>
                      <span>{v.typeLabel}</span>
                    </div>
                    <div className="row-distance">
                      <strong>{fmtKm(v.distanceKm)}</strong>
                      <span><Arrow deg={v.bearing} size={16} /> {v.direction}</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <ShipIcon size={64} />
              <h2>No ships nearby</h2>
              <p>No fresh AIS positions were found inside {radius} km.</p>
              <button onClick={requestLocation}>Try again</button>
            </div>
          )}
        </section>
      )}

      {tab === "radar" && (
        <section className="screen radar-screen">
          <div className="screen-heading">
            <div><div className="section-label">LIVE AIS</div><h1>Radar</h1></div>
            <div className="radius-label">{radius} km</div>
          </div>

          <div className="radar">
            <div className="radar-ring ring-1" />
            <div className="radar-ring ring-2" />
            <div className="radar-ring ring-3" />
            <div className="radar-axis horizontal" />
            <div className="radar-axis vertical" />
            <div className="north">N</div>
            <div className="you">YOU</div>

            {radarVessels.map((v) => {
              const angle = (v.bearing * Math.PI) / 180;
              const r = Math.min(v.distanceKm / radius, 1) * 43;
              const left = 50 + Math.sin(angle) * r;
              const top = 50 - Math.cos(angle) * r;
              return (
                <button
                  key={v.mmsi}
                  className="radar-ship"
                  style={{ left: `${left}%`, top: `${top}%`, transform: `translate(-50%,-50%) rotate(${v.cog ?? v.bearing}deg)` }}
                  title={v.name}
                  onClick={() => setSelected(v)}
                >
                  ▲
                </button>
              );
            })}
          </div>

          <div className="radar-list">
            {radarVessels.slice(0, 5).map((v) => (
              <button key={v.mmsi} onClick={() => setSelected(v)}>
                <strong>{v.name}</strong>
                <span>{fmtKm(v.distanceKm)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {tab === "spots" && (
        <section className="screen">
          <div className="screen-heading">
            <div><div className="section-label">YOUR LOGBOOK</div><h1>My Spots</h1></div>
            <div className="spot-count">{spots.length}</div>
          </div>
          {spots.length === 0 ? (
            <div className="empty-state compact">
              <span className="big-star">☆</span>
              <h2>No spots yet</h2>
              <p>Open a nearby ship and tap “I spotted this”.</p>
              <button onClick={() => goTab("nearby")}>Find ships</button>
            </div>
          ) : (
            <div className="spots-list">
              {spots.map((s) => (
                <div className="spot-row" key={s.id}>
                  <div className="spot-badge"><ShipIcon size={28} /></div>
                  <div>
                    <strong>{s.name}</strong>
                    <span>{s.typeLabel}</span>
                    <small>{new Date(s.date).toLocaleString()}</small>
                  </div>
                  <b>{fmtKm(s.distanceKm)}</b>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "settings" && (
        <section className="screen">
          <div className="screen-heading">
            <div><div className="section-label">SHIPSPOT</div><h1>Settings</h1></div>
          </div>

          <div className="settings-card">
            <div className="setting-title">Search radius</div>
            <div className="segmented">
              {[10, 25, 50, 100].map((n) => (
                <button
                  key={n}
                  className={radius === n ? "active" : ""}
                  onClick={() => {
                    setRadius(n);
                    if (position) loadNearby(position, true, n);
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <small>kilometres</small>
          </div>

          <button className="settings-row" onClick={requestLocation}>
            <div><strong>GPS location</strong><span>{locationLabel}</span></div><b>Refresh</b>
          </button>
          <div className="settings-row static">
            <div><strong>Offline cache</strong><span>Last successful nearby list</span></div><b>On</b>
          </div>
          <div className="settings-row static">
            <div><strong>Data source</strong><span>Fintraffic / Digitraffic AIS</span></div><b>FI</b>
          </div>

          <div className="about-card">
            <div className="brand small">SHIP<span>SPOT</span></div>
            <p>Finland MVP · v0.1</p>
            <p>Vessel positions and metadata: Fintraffic / Digitraffic.</p>
          </div>
        </section>
      )}

      <nav className="bottom-nav">
        {(["nearby", "radar", "spots", "settings"] as Tab[]).map((name) => (
          <button
            key={name}
            className={tab === name ? "active" : ""}
            onClick={() => goTab(name)}
          >
            <NavIcon name={name} />
            <span>{name === "spots" ? "Spots" : name[0].toUpperCase() + name.slice(1)}</span>
          </button>
        ))}
      </nav>
    </main>
  );
}
