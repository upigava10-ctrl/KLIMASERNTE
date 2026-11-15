"use client";

import { useEffect, useMemo, useState } from "react";
import type { HeatLayerOptions } from "leaflet.heat";

const SONORA_BOUNDS: [[number, number], [number, number]] = [
  [26.5, -115.05],
  [34.45, -108.45],
];
const FLASK_API_URL = (
  process.env.NEXT_PUBLIC_FLASK_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");
const TARGET_COLUMN = "next_3_months_precipitation_avg";

type ViewMode = "actual" | "prediction";
type HeatPoint = [number, number, number];
type HeatLayer = {
  addTo: (map: ReturnType<typeof import("react-leaflet").useMap>) => unknown;
  remove: () => unknown;
};
type CreateHeatLayerFn = (
  points: HeatPoint[],
  options: HeatLayerOptions
) => HeatLayer;
type MapDependencies = {
  MapContainer: typeof import("react-leaflet").MapContainer;
  TileLayer: typeof import("react-leaflet").TileLayer;
  useMap: typeof import("react-leaflet").useMap;
  createHeatLayer: CreateHeatLayerFn;
};

interface MonthlyRecord {
  Lon: number;
  Lat: number;
  [TARGET_COLUMN]: number;
}

interface MonthlyResponse {
  view: ViewMode;
  month: string;
  input_month: string;
  period_start: string;
  period_end: string;
  target: string;
  records: MonthlyRecord[];
}

function isHeatLayer(layer: unknown): layer is HeatLayer {
  return (
    typeof layer === "object" &&
    layer !== null &&
    "addTo" in layer &&
    typeof layer.addTo === "function" &&
    "remove" in layer &&
    typeof layer.remove === "function"
  );
}

function HeatLayerOverlay({
  points,
  useMap,
  createHeatLayer,
}: {
  points: HeatPoint[];
  useMap: typeof import("react-leaflet").useMap;
  createHeatLayer: CreateHeatLayerFn;
}) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;

    const layer = createHeatLayer(points, {
      radius: 25,
      blur: 20,
      maxZoom: 12,
      max: 1,
      minOpacity: 0.35,
      gradient: {
        0.2: "#3b82f6",
        0.45: "#06b6d4",
        0.65: "#eab308",
        0.85: "#f97316",
        1: "#ef4444",
      },
    });

    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [createHeatLayer, map, points]);

  return null;
}

export default function ImergDashboard() {
  const [view, setView] = useState<ViewMode>("actual");
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [loadedData, setLoadedData] = useState<MonthlyResponse | null>(null);
  const [status, setStatus] = useState("Connecting to the prediction service...");
  const [leafletDeps, setLeafletDeps] = useState<MapDependencies | null>(null);

  useEffect(() => {
    let active = true;

    async function initLeaflet() {
      await import("leaflet/dist/leaflet.css");

      const heatModule = await import("leaflet.heat");
      const reactLeaflet = await import("react-leaflet");
      const createHeatLayer: CreateHeatLayerFn = (points, options) => {
        const layer: unknown = new heatModule.HeatLayer(points, options);
        if (!isHeatLayer(layer)) {
          throw new Error("Leaflet heat layer is missing map lifecycle methods.");
        }
        return layer;
      };

      if (active) {
        setLeafletDeps({
          MapContainer: reactLeaflet.MapContainer,
          TileLayer: reactLeaflet.TileLayer,
          useMap: reactLeaflet.useMap,
          createHeatLayer,
        });
      }
    }

    initLeaflet().catch((error: unknown) => {
      console.error("Could not initialize the map:", error);
      if (active) {
        setStatus(
          `Map initialization failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadMonths() {
      try {
        const response = await fetch(
          `${FLASK_API_URL}/api/months?view=${view}`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          const details = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(
            details?.error ?? `Month list request failed (${response.status})`
          );
        }

        const result = (await response.json()) as { months: string[] };
        if (!active) return;
        setMonths(result.months);
        setSelectedMonth(result.months.at(-1) ?? "");
        setStatus(
          result.months.length
            ? "Select a month to view its three-month precipitation value."
            : "No monthly data is available for this view."
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setStatus(
          `Could not connect to Flask: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    let active = true;
    void loadMonths();
    return () => {
      active = false;
      controller.abort();
    };
  }, [view]);

  useEffect(() => {
    if (!selectedMonth) return;

    const controller = new AbortController();
    async function loadMonthlyData() {
      try {
        const query = new URLSearchParams({
          view,
          month: selectedMonth,
        });
        const response = await fetch(
          `${FLASK_API_URL}/api/monthly?${query.toString()}`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          const details = (await response.json().catch(() => null)) as
            | { error?: string; details?: string }
            | null;
          throw new Error(
            details?.details ??
              details?.error ??
              `Monthly data request failed (${response.status})`
          );
        }

        const result = (await response.json()) as MonthlyResponse;
        setLoadedData(result);
        setStatus(
          `${result.records.length.toLocaleString()} grid locations; input data: ${result.input_month}.`
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadedData(null);
        setStatus(
          `Could not load monthly data: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    void loadMonthlyData();
    return () => controller.abort();
  }, [selectedMonth, view]);

  const currentData =
    loadedData?.view === view && loadedData.month === selectedMonth
      ? loadedData
      : null;
  const { points, stats } = useMemo(() => {
    const rows = currentData?.records ?? [];
    const values = rows.map((row) => row[TARGET_COLUMN]);
    const max = values.reduce(
      (highest, value) => Math.max(highest, value),
      0
    );

    return {
      points: rows.map(
        (row): HeatPoint => [
          row.Lat,
          row.Lon,
          max > 0 ? Math.max(0, row[TARGET_COLUMN] / max) : 0,
        ]
      ),
      stats: {
        min: values.length ? Math.min(...values) : 0,
        max,
        avg: values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : 0,
        count: rows.length,
      },
    };
  }, [currentData]);

  if (!leafletDeps) {
    return <p className="p-5 text-center text-slate-600">{status}</p>;
  }

  const { MapContainer, TileLayer, useMap, createHeatLayer } = leafletDeps;
  const isPrediction = view === "prediction";

  return (
    <section className="mx-auto w-full max-w-6xl items-center p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">
            Precipitación IMERG en Sonora
          </h2>
          <p className="mt-1 text-sm text-slate-500">{status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            Vista
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2"
              value={view}
              onChange={(event) => {
                setMonths([]);
                setSelectedMonth("");
                setView(event.target.value as ViewMode);
              }}
            >
              <option value="actual">Observado · 2023–2024</option>
              <option value="prediction">Predicción · 2025</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            Mes
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              disabled={!months.length}
            >
              {months.map((month) => (
                <option key={month} value={month}>
                  {month}
                  {isPrediction && month === "2025-10"
                    ? " · pronóstico con datos de septiembre"
                    : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="mb-3 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">
        {currentData ? (
          <>
            {isPrediction ? "Pronóstico" : "Valor observado"} para el periodo{" "}
            <strong>
              {currentData.period_start} a {currentData.period_end}
            </strong>
            , calculado con datos del mes{" "}
            <strong>{currentData.input_month}</strong>.
          </>
        ) : (
          "Cargando valores mensuales..."
        )}
      </div>

      <div className="overflow-hidden rounded-xl shadow-md">
        <MapContainer
          bounds={SONORA_BOUNDS}
          maxBounds={SONORA_BOUNDS}
          maxBoundsViscosity={0}
          zoomSnap={0.5}
          minZoom={7}
          scrollWheelZoom
          className="z-0 h-[500px] w-full"
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

      <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4">
        {[
          ["Máxima", stats.max],
          ["Promedio", stats.avg],
          ["Mínima", stats.min],
        ].map(([label, value]) => (
          <div
            className="rounded-xl border-t-4 border-cyan-500 bg-white p-4 text-center shadow-sm"
            key={label}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {label} {isPrediction ? "prevista" : "observada"}
            </p>
            <p className="mt-2 text-2xl font-bold text-cyan-700">
              {Number(value).toFixed(2)}
            </p>
          </div>
        ))}
        <div className="rounded-xl border-t-4 border-emerald-500 bg-white p-4 text-center shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Ubicaciones
          </p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">
            {stats.count.toLocaleString()}
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Intensidad de color relativa al máximo del periodo; los valores
        corresponden al promedio de precipitación estimado para tres meses.
      </p>
    </section>
  );
}
