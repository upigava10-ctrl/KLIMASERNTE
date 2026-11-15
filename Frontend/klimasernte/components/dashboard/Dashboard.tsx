"use client";

import { useEffect, useMemo, useState } from "react";

// Lon,Lat,Elevation,Time,precipitation,randomError,probabilityLiquidPrecipitation,precipitation_cnt,precipitation_cnt_cond,MWprecipitation,MWprecipitation_cnt,MWprecipitation_cnt_cond,randomError_cnt
const CSV_DATA_URL = "/home/legion_user/Webpages/KLIMASERNTE/Backend/data/sonora_precipitation/sonora_imerg_2023-01-02.csv";

const SONORA_BOUNDS: [[number, number], [number, number]] = [
  [26.5, -115.05],
  [34.45, -108.45],
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
    <section className="w-full max-w-[900px] mx-auto p-5">
      {/* Header Section */}
      <div className="flex justify-between items-center flex-wrap gap-3 mb-4">
        <div>
          <h2 className="m-0 text-slate-800 text-2xl font-bold">Clima en Sonora</h2>
          <p className="mt-1 mb-0 text-slate-500 text-sm">
            Estado: {status}
          </p>
        </div>

        {availableDates.length > 0 && (
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
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

      {/* Map Section */}
      <div className="rounded-xl overflow-hidden shadow-md">
        <MapContainer
          bounds={SONORA_BOUNDS}
          maxBounds={SONORA_BOUNDS}
          maxBoundsViscosity={10}
          minZoom={5}
          zoomControl={false}
          className="h-[500px] w-full z-0"
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

      {/* Stats Grid Section */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4 mt-5">
        {/* Max Temp Card */}
        <div className="bg-white p-4 rounded-xl shadow-sm border-t-4 border-red-500 text-center">
          <p className="m-0 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Máxima
          </p>
          <p className="mt-2 mb-0 text-2xl font-bold text-red-500">
            {stats.max.toFixed(1)}°C
          </p>
        </div>

        {/* Avg Temp Card */}
        <div className="bg-white p-4 rounded-xl shadow-sm border-t-4 border-amber-500 text-center">
          <p className="m-0 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Promedio
          </p>
          <p className="mt-2 mb-0 text-2xl font-bold text-amber-500">
            {stats.avg.toFixed(1)}°C
          </p>
        </div>

        {/* Min Temp Card */}
        <div className="bg-white p-4 rounded-xl shadow-sm border-t-4 border-blue-500 text-center">
          <p className="m-0 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Mínima
          </p>
          <p className="mt-2 mb-0 text-2xl font-bold text-blue-500">
            {stats.min.toFixed(1)}°C
          </p>
        </div>

        {/* Records Card */}
        <div className="bg-white p-4 rounded-xl shadow-sm border-t-4 border-emerald-500 text-center">
          <p className="m-0 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Registros
          </p>
          <p className="mt-2 mb-0 text-2xl font-bold text-emerald-500">
            {stats.total}
          </p>
        </div>
      </div>
    </section>
  );
}