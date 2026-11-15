"use client";

import { useEffect, useMemo, useState } from "react";

const CSV_DATA_URL = "/data/temperaturas.csv";

const SONORA_BOUNDS: [[number, number], [number, number]] = [
  [26.2, -115.0],
  [32.5, -108.0],
];

type HeatPoint = [number, number, number];
type CreateHeatLayerFn = (
  points: HeatPoint[],
  options: Record<string, unknown>
) => any;

interface CsvRow {
  lat: number;
  lon: number;
  date: string;
  value: number;
}

function parseCsvRows(csvText: string): CsvRow[] {
  const cleaned = csvText.replace(/^\uFEFF/, "").trim();
  if (!cleaned) return [];

  const rows = cleaned
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  if (rows.length < 2) return [];

  const delimiter = rows[0].includes(";") ? ";" : ",";
  const header = rows[0]
    .split(delimiter)
    .map((cell) => cell.trim().toLowerCase());

  const latIndex = header.findIndex((c) => c.includes("lat"));
  const lonIndex = header.findIndex((c) => c.includes("lon"));
  const dateIndex = header.findIndex(
    (c) => c.includes("date") || c.includes("fecha")
  );
  const valueIndex = header.findIndex(
    (c) => c.includes("t_2m") || c.includes("temp")
  );

  if (latIndex === -1 || lonIndex === -1 || valueIndex === -1) return [];

  const parsed: CsvRow[] = [];

  for (const row of rows.slice(1)) {
    const cells = row.split(delimiter).map((cell) => cell.trim());
    if (cells.length <= Math.max(latIndex, lonIndex, valueIndex)) continue;

    const lat = Number(cells[latIndex]);
    const lon = Number(cells[lonIndex]);
    const value = Number(cells[valueIndex]);
    const date = dateIndex !== -1 ? cells[dateIndex] : "Sin fecha";

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !Number.isFinite(value)
    ) {
      continue;
    }

    parsed.push({ lat, lon, date, value });
  }

  return parsed;
}

function HeatLayerOverlay({
  points,
  useMap,
  createHeatLayer,
}: {
  points: HeatPoint[];
  useMap: () => any;
  createHeatLayer: CreateHeatLayerFn;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !points.length) return;

    const layer = createHeatLayer(points, {
      radius: 65,
      blur: 45,
      maxZoom: 10,
      max: 1.0,
      minOpacity: 0.45,
      gradient: {
        0.2: "#3b82f6",
        0.45: "#06b6d4",
        0.65: "#eab308",
        0.85: "#f97316",
        1.0: "#ef4444",
      },
    });

    layer.addTo(map);

    return () => {
      map.removeLayer(layer);
    };
  }, [map, points, createHeatLayer]);

  return null;
}

export default function Dashboard() {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("__AVG__");
  const [status, setStatus] = useState("Cargando datos meteorológicos...");
  const [leafletDeps, setLeafletDeps] = useState<{
    MapContainer: any;
    TileLayer: any;
    useMap: () => any;
    createHeatLayer: CreateHeatLayerFn;
  } | null>(null);

  useEffect(() => {
    let active = true;

    async function initLeaflet() {
      const LModule = await import("leaflet");
      const L = (LModule.default ?? LModule) as any;
      (window as any).L = L;

      await import("leaflet/dist/leaflet.css");
      const heatModule: any = await import("leaflet.heat");
      const ReactLeaflet = await import("react-leaflet");

      const createHeatLayer: CreateHeatLayerFn = (pts, opts) => {
        const HeatLayerClass =
          heatModule?.HeatLayer ?? heatModule?.default?.HeatLayer;
        if (typeof HeatLayerClass === "function") {
          return new HeatLayerClass(pts, opts);
        }
        if (typeof L.heatLayer === "function") {
          return L.heatLayer(pts, opts);
        }
        throw new Error("No se encontró HeatLayer ni L.heatLayer");
      };

      if (!active) return;

      setLeafletDeps({
        MapContainer: ReactLeaflet.MapContainer,
        TileLayer: ReactLeaflet.TileLayer,
        useMap: ReactLeaflet.useMap,
        createHeatLayer,
      });
    }

    initLeaflet().catch((error) => {
      console.error("Error cargando Leaflet:", error);
      if (active) setStatus(`Error al iniciar mapa: ${error.message}`);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    fetch(CSV_DATA_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`CSV respondió ${res.status}`);
        return res.text();
      })
      .then((text) => {
        const parsed = parseCsvRows(text);
        if (parsed.length > 0) {
          setRows(parsed);
          setStatus("Datos cargados correctamente");
        } else {
          setStatus("El CSV no contiene columnas o datos válidos.");
        }
      })
      .catch((error) => setStatus(`Error al cargar datos: ${error.message}`));
  }, []);

  const availableDates = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.date))).sort();
  }, [rows]);

  const { points, stats } = useMemo(() => {
    if (!rows.length) {
      return {
        points: [] as HeatPoint[],
        stats: { min: 0, max: 0, avg: 0, total: 0 },
      };
    }

    const filtered =
      selectedDate === "__AVG__"
        ? rows
        : rows.filter((r) => r.date === selectedDate);

    if (!filtered.length) {
      return {
        points: [] as HeatPoint[],
        stats: { min: 0, max: 0, avg: 0, total: 0 },
      };
    }

    const values = filtered.map((r) => r.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const total = values.length;

    const grouped = new Map<
      string,
      { lat: number; lon: number; sum: number; count: number }
    >();

    for (const r of filtered) {
      const key = `${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.sum += r.value;
        existing.count += 1;
      } else {
        grouped.set(key, { lat: r.lat, lon: r.lon, sum: r.value, count: 1 });
      }
    }

    const points: HeatPoint[] = Array.from(grouped.values()).map((g) => {
      const coordAvg = g.sum / g.count;
      const normalized =
        max === min ? 0.8 : 0.2 + ((coordAvg - min) / (max - min)) * 0.8;
      return [g.lat, g.lon, normalized];
    });

    return { points, stats: { min, max, avg, total } };
  }, [rows, selectedDate]);

  if (!leafletDeps) {
    return (
      <div style={{ padding: "20px", textAlign: "center", color: "#666" }}>
        <p>{status}</p>
        <p>Iniciando mapa interactivo...</p>
      </div>
    );
  }

  const { MapContainer, TileLayer, useMap, createHeatLayer } = leafletDeps;

  return (
    <section
      style={{
        width: "100%",
        maxWidth: "900px",
        margin: "0 auto",
        padding: "20px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div>
          <h2 style={{ margin: 0, color: "#1e293b" }}>Clima en Sonora</h2>
          <p
            style={{
              margin: "4px 0 0 0",
              color: "#64748b",
              fontSize: "14px",
            }}
          >
            Estado: {status}
          </p>
        </div>

        {availableDates.length > 0 && (
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid #cbd5e1",
              backgroundColor: "#fff",
              color: "#1e293b",
              fontSize: "14px",
            }}
          >
            <option value="__AVG__">Promedio general por ubicación</option>
            {availableDates.map((d) => (
              <option key={d} value={d}>
                {new Date(d).toLocaleString("es-MX", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </option>
            ))}
          </select>
        )}
      </div>

      <div
        style={{
          borderRadius: "12px",
          overflow: "hidden",
          boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
        }}
      >
        <MapContainer
          bounds={SONORA_BOUNDS}
          maxBounds={SONORA_BOUNDS}
          maxBoundsViscosity={1}
          minZoom={5}
          scrollWheelZoom
          style={{ height: "500px", width: "100%", zIndex: 0 }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <HeatLayerOverlay
            points={points}
            useMap={useMap}
            createHeatLayer={createHeatLayer}
          />
        </MapContainer>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "16px",
          marginTop: "20px",
        }}
      >
        <div
          style={{
            backgroundColor: "#ffffff",
            padding: "16px",
            borderRadius: "12px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            borderTop: "4px solid #ef4444",
            textAlign: "center",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "12px",
              fontWeight: "600",
              color: "#64748b",
              textTransform: "uppercase",
            }}
          >
            Máxima
          </p>
          <p
            style={{
              margin: "8px 0 0 0",
              fontSize: "24px",
              fontWeight: "700",
              color: "#ef4444",
            }}
          >
            {stats.max.toFixed(1)}°C
          </p>
        </div>

        <div
          style={{
            backgroundColor: "#ffffff",
            padding: "16px",
            borderRadius: "12px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            borderTop: "4px solid #f59e0b",
            textAlign: "center",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "12px",
              fontWeight: "600",
              color: "#64748b",
              textTransform: "uppercase",
            }}
          >
            Promedio
          </p>
          <p
            style={{
              margin: "8px 0 0 0",
              fontSize: "24px",
              fontWeight: "700",
              color: "#f59e0b",
            }}
          >
            {stats.avg.toFixed(1)}°C
          </p>
        </div>

        <div
          style={{
            backgroundColor: "#ffffff",
            padding: "16px",
            borderRadius: "12px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            borderTop: "4px solid #3b82f6",
            textAlign: "center",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "12px",
              fontWeight: "600",
              color: "#64748b",
              textTransform: "uppercase",
            }}
          >
            Mínima
          </p>
          <p
            style={{
              margin: "8px 0 0 0",
              fontSize: "24px",
              fontWeight: "700",
              color: "#3b82f6",
            }}
          >
            {stats.min.toFixed(1)}°C
          </p>
        </div>

        <div
          style={{
            backgroundColor: "#ffffff",
            padding: "16px",
            borderRadius: "12px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            borderTop: "4px solid #10b981",
            textAlign: "center",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "12px",
              fontWeight: "600",
              color: "#64748b",
              textTransform: "uppercase",
            }}
          >
            Registros
          </p>
          <p
            style={{
              margin: "8px 0 0 0",
              fontSize: "24px",
              fontWeight: "700",
              color: "#10b981",
            }}
          >
            {stats.total}
          </p>
        </div>
      </div>
    </section>
  );
}