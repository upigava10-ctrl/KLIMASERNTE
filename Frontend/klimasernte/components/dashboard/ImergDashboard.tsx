"use client";

import { useEffect, useMemo, useState } from "react";
import sonoraBoundary from "@/data/sonora_boundary.json";

const SONORA_BOUNDS: [[number, number], [number, number]] = [
  [26.2, -115.1],
  [32.5, -108.4],
];
const TARGET_COLUMN = "next_3_months_precipitation_avg";

type ViewMode = "actual" | "prediction";
type MapMetric =
  | "precipitation"
  | "temperature"
  | "maxTemperature"
  | "minTemperature"
  | "humidity"
  | "soilMoisture"
  | "leafWetness"
  | "evapotranspiration";
type Position = [number, number];
type PolygonCoordinates = Position[][];
type MultiPolygonCoordinates = PolygonCoordinates[];
type MapDependencies = {
  MapContainer: typeof import("react-leaflet").MapContainer;
  TileLayer: typeof import("react-leaflet").TileLayer;
  CircleMarker: typeof import("react-leaflet").CircleMarker;
  Popup: typeof import("react-leaflet").Popup;
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

interface WeatherMapRecord {
  Lon: number;
  Lat: number;
  temperature_c: number | null;
  max_temperature_c: number | null;
  min_temperature_c: number | null;
  relative_humidity_pct: number | null;
  soil_moisture_index: number | null;
  leaf_wetness_index: number | null;
  evapotranspiration_mm: number | null;
}

interface WeatherMapResponse {
  month: string;
  records: WeatherMapRecord[];
}

interface MapPoint {
  Lon: number;
  Lat: number;
  value: number;
}

interface LocationOption {
  id: number;
  name: string;
  type: string;
  municipality_code: string;
  lat: number;
  lon: number;
  grid_lat: number;
  grid_lon: number;
}

interface MoistureSeriesPoint {
  month: string;
  soil_moisture_index: number | null;
  leaf_wetness_index: number | null;
  evapotranspiration_mm: number | null;
}

interface MoistureSeriesResponse {
  start: string;
  end: string;
  series: MoistureSeriesPoint[];
}

interface LocationSeriesPoint {
  month: string;
  input_month: string;
  precipitation_mean: number | null;
  next_3_months_precipitation_avg: number | null;
}

interface LocationSeriesResponse {
  view: ViewMode;
  location: LocationOption;
  series: LocationSeriesPoint[];
}

const SONORA_POLYGONS: MultiPolygonCoordinates =
  sonoraBoundary.geometry.coordinates.map((polygon) =>
    polygon.map((ring) => ring.map(([lon, lat]) => [lon, lat] as Position))
  );

function pointInRing(lon: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentLon, currentLat] = ring[index];
    const [previousLon, previousLat] = ring[previous];
    const crossesLatitude = (currentLat > lat) !== (previousLat > lat);
    if (
      crossesLatitude &&
      lon <
        ((previousLon - currentLon) * (lat - currentLat)) /
          (previousLat - currentLat) +
          currentLon
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInSonora(
  lon: number,
  lat: number,
  polygons: MultiPolygonCoordinates
): boolean {
  return polygons.some(([outer, ...holes]) => {
    if (!pointInRing(lon, lat, outer)) return false;
    return !holes.some((hole) => pointInRing(lon, lat, hole));
  });
}

function interpolateColor(value: number, min: number, max: number, stops: string[]) {
  const normalized = max > min
    ? Math.min(Math.max((value - min) / (max - min), 0), 1)
    : 0.5;
  const stopPosition = normalized * (stops.length - 1);
  const startIndex = Math.floor(stopPosition);
  const endIndex = Math.min(startIndex + 1, stops.length - 1);
  const fraction = stopPosition - startIndex;
  const start = stops[startIndex];
  const end = stops[endIndex];
  const channels = [1, 3, 5].map((offset) => {
    const startValue = Number.parseInt(start.slice(offset, offset + 2), 16);
    const endValue = Number.parseInt(end.slice(offset, offset + 2), 16);
    return Math.round(startValue + (endValue - startValue) * fraction);
  });
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function mapPointColor(metric: MapMetric, value: number, maxPrecipitation: number) {
  if (metric === "precipitation") {
    const intensity = maxPrecipitation > 0 ? value / maxPrecipitation : 0;
    return intensity > 0.75
      ? "#dc2626"
      : intensity > 0.4
        ? "#ea580c"
        : "#0284c7";
  }
  if (
    metric === "temperature" ||
    metric === "maxTemperature" ||
    metric === "minTemperature"
  ) {
    return interpolateColor(value, -5, 45, [
      "#2563eb",
      "#06b6d4",
      "#facc15",
      "#f97316",
      "#dc2626",
    ]);
  }
  if (metric === "humidity") {
    return interpolateColor(value, 0, 100, [
      "#a16207",
      "#eab308",
      "#84cc16",
      "#38bdf8",
      "#1d4ed8",
    ]);
  }
  if (metric === "soilMoisture") {
    return interpolateColor(value, 0, 1.5, [
      "#fef3c7",
      "#a3e635",
      "#22c55e",
      "#0284c7",
      "#1e3a8a",
    ]);
  }
  if (metric === "leafWetness") {
    return interpolateColor(value, 0, 1, [
      "#fef3c7",
      "#bef264",
      "#34d399",
      "#0ea5e9",
      "#1d4ed8",
    ]);
  }
  return interpolateColor(value, 0, 12, [
    "#fef3c7",
    "#facc15",
    "#fb923c",
    "#0ea5e9",
    "#1d4ed8",
  ]);
}

function mapMetricLabel(metric: MapMetric): string {
  if (metric === "temperature") return "Temperatura media a 2 m";
  if (metric === "maxTemperature") return "Temperatura máxima";
  if (metric === "minTemperature") return "Temperatura mínima";
  if (metric === "humidity") return "Humedad relativa";
  if (metric === "soilMoisture") return "Índice de humedad del suelo (−5 cm)";
  if (metric === "leafWetness") return "Humedad foliar";
  if (metric === "evapotranspiration") return "Evapotranspiración";
  return "Precipitación estimada";
}

function mapMetricUnit(metric: MapMetric): string {
  if (
    metric === "temperature" ||
    metric === "maxTemperature" ||
    metric === "minTemperature"
  ) {
    return "°C";
  }
  if (metric === "humidity") return "%";
  if (metric === "soilMoisture" || metric === "leafWetness") return "índice";
  if (metric === "evapotranspiration") return "mm/24 h";
  return "mm/día";
}

function mapLegendGradient(metric: MapMetric): string {
  if (
    metric === "temperature" ||
    metric === "maxTemperature" ||
    metric === "minTemperature"
  ) {
    return "linear-gradient(90deg, #2563eb, #06b6d4, #facc15, #f97316, #dc2626)";
  }
  if (metric === "humidity") {
    return "linear-gradient(90deg, #a16207, #eab308, #84cc16, #38bdf8, #1d4ed8)";
  }
  if (metric === "soilMoisture") {
    return "linear-gradient(90deg, #fef3c7, #a3e635, #22c55e, #0284c7, #1e3a8a)";
  }
  if (metric === "leafWetness") {
    return "linear-gradient(90deg, #fef3c7, #bef264, #34d399, #0ea5e9, #1d4ed8)";
  }
  if (metric === "evapotranspiration") {
    return "linear-gradient(90deg, #fef3c7, #facc15, #fb923c, #0ea5e9, #1d4ed8)";
  }
  return "linear-gradient(90deg, #0284c7, #ea580c, #dc2626)";
}

function LocationPrecipitationChart({
  points,
  view,
  locationName,
  status,
}: {
  points: LocationSeriesPoint[];
  view: ViewMode;
  locationName: string;
  status: string;
}) {
  const series = [
    {
      label: "Precipitación media diaria",
      value: (point: LocationSeriesPoint) => point.precipitation_mean,
      color: "#0284c7",
    },
    {
      label: view === "prediction" ? "Pronóstico 3 meses" : "Promedio observado 3 meses",
      value: (point: LocationSeriesPoint) =>
        point.next_3_months_precipitation_avg,
      color: "#ea580c",
    },
  ];
  const values = points.flatMap((point) =>
    series.map(({ value }) => value(point))
  ).filter((value): value is number => value !== null && Number.isFinite(value));
  const maxValue = Math.max(...values, 0);
  const scaleMax = maxValue > 0 ? maxValue * 1.1 : 1;
  const width = 900;
  const height = 330;
  const left = 58;
  const right = 20;
  const top = 20;
  const bottom = 48;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const x = (index: number) =>
    points.length < 2
      ? left + chartWidth / 2
      : left + (index / (points.length - 1)) * chartWidth;
  const y = (value: number) => top + chartHeight * (1 - value / scaleMax);
  const labelStep = Math.max(1, Math.ceil(points.length / 12));

  return (
    <article className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-800">
          Precipitación mensual · {locationName}
        </h3>
        <p className="text-sm text-slate-500">{status}</p>
      </div>
      {points.length ? (
        <div className="w-full overflow-x-auto">
          <svg
            aria-label={`Precipitation line chart for ${locationName}`}
            className="h-auto min-w-[640px] w-full"
            role="img"
            viewBox={`0 0 ${width} ${height}`}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
              const tickY = top + chartHeight * fraction;
              const tickValue = scaleMax * (1 - fraction);
              return (
                <g key={fraction}>
                  <line
                    x1={left}
                    x2={width - right}
                    y1={tickY}
                    y2={tickY}
                    stroke="#e2e8f0"
                    strokeWidth="1"
                  />
                  <text
                    x={left - 8}
                    y={tickY + 4}
                    textAnchor="end"
                    fill="#64748b"
                    fontSize="11"
                  >
                    {tickValue.toFixed(maxValue < 10 ? 2 : 0)}
                  </text>
                </g>
              );
            })}
            {series.map((line) => (
              <g key={line.label}>
                <polyline
                  fill="none"
                  stroke={line.color}
                  strokeWidth="3"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={points
                    .map((point, index) => {
                      const value = line.value(point);
                      return value !== null && Number.isFinite(value)
                        ? `${x(index)},${y(value)}`
                        : null;
                    })
                    .filter((point): point is string => point !== null)
                    .join(" ")}
                />
                {points.map((point, index) => {
                  const value = line.value(point);
                  if (value === null || !Number.isFinite(value)) return null;
                  return (
                    <circle
                      key={`${line.label}-${point.month}`}
                      cx={x(index)}
                      cy={y(value)}
                      r="4"
                      fill={line.color}
                    >
                      <title>
                        {line.label} · {point.month}: {value.toFixed(3)} mm/day
                        {view === "prediction"
                          ? ` (input ${point.input_month})`
                          : ""}
                      </title>
                    </circle>
                  );
                })}
              </g>
            ))}
            {points.map((point, index) =>
              index % labelStep === 0 || index === points.length - 1 ? (
                <text
                  key={point.month}
                  x={x(index)}
                  y={height - 14}
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize="11"
                >
                  {point.month}
                </text>
              ) : null
            )}
          </svg>
        </div>
      ) : (
        <p className="py-16 text-center text-sm text-slate-500">
          {status || "Select a Sonora location to load its monthly series."}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
        {series.map((line) => (
          <span className="inline-flex items-center gap-2" key={line.label}>
            <span
              aria-hidden="true"
              className="inline-block h-1 w-5 rounded"
              style={{ backgroundColor: line.color }}
            />
            {line.label}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {view === "prediction"
          ? "El valor IMERG usa el mes de entrada indicado al pasar el cursor; el pronóstico comienza en el mes seleccionado."
          : "Cada punto representa el mes de entrada; el promedio observado usa los tres meses siguientes."}
        {" "}Unidades: mm/día.
      </p>
    </article>
  );
}

function locationLabel(location: LocationOption): string {
  return `${location.name} · ${location.type} · ${location.lat.toFixed(2)}, ${location.lon.toFixed(2)}`;
}

function previousMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function MoistureHistoryChart({
  points,
  locationName,
  status,
}: {
  points: MoistureSeriesPoint[];
  locationName: string;
  status: string;
}) {
  const charts = [
    {
      key: "soil_moisture_index" as const,
      label: "Humedad del suelo (−5 cm)",
      color: "#15803d",
      unit: "índice",
    },
    {
      key: "leaf_wetness_index" as const,
      label: "Humedad foliar",
      color: "#0284c7",
      unit: "índice",
    },
    {
      key: "evapotranspiration_mm" as const,
      label: "Evapotranspiración",
      color: "#ea580c",
      unit: "mm/24 h",
    },
  ];

  return (
    <article className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-800">
          Variables de humedad · {locationName}
        </h3>
        <p className="text-sm text-slate-500">{status}</p>
      </div>
      {points.length ? (
        <div className="grid gap-3 md:grid-cols-3">
          {charts.map((chart) => {
            const values = points.map((point) => point[chart.key]);
            const finiteValues = values.filter(
              (value): value is number =>
                value !== null && Number.isFinite(value)
            );
            const maximum = Math.max(...finiteValues, 0);
            const minimum = Math.min(...finiteValues, 0);
            const scaleMinimum = Math.min(0, minimum);
            const scaleMaximum = maximum > scaleMinimum ? maximum * 1.1 : 1;
            const width = 420;
            const height = 150;
            const left = 44;
            const right = 12;
            const top = 14;
            const bottom = 34;
            const chartWidth = width - left - right;
            const chartHeight = height - top - bottom;
            const x = (index: number) =>
              points.length < 2
                ? left + chartWidth / 2
                : left + (index / (points.length - 1)) * chartWidth;
            const y = (value: number) =>
              top +
              chartHeight *
                (1 - (value - scaleMinimum) / (scaleMaximum - scaleMinimum));
            const segments: string[][] = [];
            let segment: string[] = [];
            values.forEach((value, index) => {
              if (value === null || !Number.isFinite(value)) {
                if (segment.length) segments.push(segment);
                segment = [];
              } else {
                segment.push(`${x(index)},${y(value)}`);
              }
            });
            if (segment.length) segments.push(segment);
            const labelStep = Math.max(1, Math.ceil(points.length / 5));

            return (
              <section
                className="min-w-0 rounded-lg border border-slate-100 p-2"
                key={chart.key}
              >
                <h4 className="text-sm font-medium text-slate-700">
                  {chart.label}
                </h4>
                {finiteValues.length ? (
                  <>
                    <svg
                      aria-label={`${chart.label} history for ${locationName}`}
                      className="h-auto w-full"
                      role="img"
                      viewBox={`0 0 ${width} ${height}`}
                    >
                      {[0, 0.5, 1].map((fraction) => {
                        const value =
                          scaleMaximum -
                          fraction * (scaleMaximum - scaleMinimum);
                        const tickY = top + chartHeight * fraction;
                        return (
                          <g key={fraction}>
                            <line
                              x1={left}
                              x2={width - right}
                              y1={tickY}
                              y2={tickY}
                              stroke="#e2e8f0"
                            />
                            <text
                              x={left - 5}
                              y={tickY + 4}
                              textAnchor="end"
                              fill="#64748b"
                              fontSize="9"
                            >
                              {value.toFixed(1)}
                            </text>
                          </g>
                        );
                      })}
                      {segments.map((segmentPoints, index) => (
                        <polyline
                          key={index}
                          fill="none"
                          stroke={chart.color}
                          strokeWidth="2.5"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          points={segmentPoints.join(" ")}
                        />
                      ))}
                      {values.map((value, index) =>
                        value === null || !Number.isFinite(value) ? null : (
                          <circle
                            key={points[index].month}
                            cx={x(index)}
                            cy={y(value)}
                            r="3"
                            fill={chart.color}
                          >
                            <title>
                              {points[index].month}: {value.toFixed(3)}{" "}
                              {chart.unit}
                            </title>
                          </circle>
                        )
                      )}
                      {points.map((point, index) =>
                        index % labelStep === 0 ||
                        index === points.length - 1 ? (
                          <text
                            key={point.month}
                            x={x(index)}
                            y={height - 8}
                            textAnchor="middle"
                            fill="#64748b"
                            fontSize="9"
                          >
                            {point.month}
                          </text>
                        ) : null
                      )}
                    </svg>
                    <p className="text-right text-xs text-slate-500">
                      {chart.unit}
                    </p>
                  </>
                ) : (
                  <p className="py-10 text-center text-xs text-slate-500">
                    No hay valores disponibles en este intervalo.
                  </p>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-slate-500">{status}</p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Datos históricos del CSV; los meses sin medición se muestran como
        espacios. No se estiman valores futuros para estas variables.
      </p>
    </article>
  );
}

export default function ImergDashboard() {
  const [view, setView] = useState<ViewMode>("actual");
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [locationOptions, setLocationOptions] = useState<LocationOption[]>([]);
  const [selectedLocation, setSelectedLocation] =
    useState<LocationOption | null>(null);
  const [loadedData, setLoadedData] = useState<MonthlyResponse | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherMapResponse | null>(null);
  const [weatherStatus, setWeatherStatus] = useState("");
  const [moistureData, setMoistureData] = useState<{
    requestKey: string;
    series: MoistureSeriesPoint[];
  } | null>(null);
  const [moistureStatus, setMoistureStatus] = useState("");
  const [locationSeries, setLocationSeries] = useState<{
    requestKey: string;
    points: LocationSeriesPoint[];
  } | null>(null);
  const [seriesStatus, setSeriesStatus] = useState("");
  const [mapLayer, setMapLayer] = useState<"satellite" | "street">("satellite");
  const [mapMetric, setMapMetric] = useState<MapMetric>("precipitation");
  const [status, setStatus] = useState("Connecting to the prediction service...");
  const [leafletDeps, setLeafletDeps] = useState<MapDependencies | null>(null);

  useEffect(() => {
    let active = true;

    async function initLeaflet() {
      await import("leaflet/dist/leaflet.css");

      const reactLeaflet = await import("react-leaflet");

      if (active) {
        setLeafletDeps({
          MapContainer: reactLeaflet.MapContainer,
          TileLayer: reactLeaflet.TileLayer,
          CircleMarker: reactLeaflet.CircleMarker,
          Popup: reactLeaflet.Popup,
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
          `/api/model/months?view=${view}`,
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

        const result = (await response.json()) as {
          months: string[];
          training_cutoff?: string;
          feature_projection?: string;
        };
        if (!active) return;
        setMonths(result.months);
        setSelectedMonth(result.months.at(-1) ?? "");
        setRangeStart(result.months[0] ?? "");
        setRangeEnd(result.months.at(-1) ?? "");
        setStatus(
          result.months.length
            ? view === "prediction" && result.training_cutoff
              ? `${result.months.length}-month forecast through ${result.months.at(-1)}; features projected from training through ${result.training_cutoff} using seasonal linear regression.`
              : "Select a month to view its three-month precipitation value."
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
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const query = new URLSearchParams({
          q: locationSearch,
          limit: "30",
        });
        const response = await fetch(`/api/model/locations?${query}`, {
          signal: controller.signal,
        });
        const result = (await response.json()) as {
          locations?: LocationOption[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(result.error ?? `Location search failed (${response.status})`);
        }
        const matches = result.locations ?? [];
        setLocationOptions(matches);
        setSelectedLocation((current) => current ?? matches[0] ?? null);
      } catch (error) {
        if (!controller.signal.aborted) {
          setSeriesStatus(
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }, 200);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [locationSearch]);

  useEffect(() => {
    if (!selectedLocation || !rangeStart || !rangeEnd) {
      return;
    }

    const location = selectedLocation;
    const requestKey = `${view}:${rangeStart}:${rangeEnd}:${location.id}`;
    const controller = new AbortController();
    async function loadLocationSeries() {
      setSeriesStatus("Loading this location's precipitation history...");
      try {
        const query = new URLSearchParams({
          view,
          start: rangeStart,
          end: rangeEnd,
          location_id: String(location.id),
        });
        const response = await fetch(
          `/api/model/location-series?${query.toString()}`,
          { signal: controller.signal }
        );
        const result = (await response.json()) as
          | LocationSeriesResponse
          | { error?: string; details?: string };
        if (!response.ok) {
          const error = result as { error?: string; details?: string };
          throw new Error(
            error.details ?? error.error ?? `Location series failed (${response.status})`
          );
        }

        const data = result as LocationSeriesResponse;
        setLocationSeries({ requestKey, points: data.series });
        setSeriesStatus(`${data.series.length} monthly points`);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSeriesStatus(
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    void loadLocationSeries();
    return () => controller.abort();
  }, [rangeEnd, rangeStart, selectedLocation, view]);

  const locationSeriesKey =
    selectedLocation && rangeStart && rangeEnd
      ? `${view}:${rangeStart}:${rangeEnd}:${selectedLocation.id}`
      : "";
  const visibleLocationSeries =
    locationSeries?.requestKey === locationSeriesKey
      ? locationSeries.points
      : [];

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
          `/api/model/monthly?${query.toString()}`,
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
  const currentWeatherData =
    weatherData?.month === selectedMonth ? weatherData : null;

  const moistureRequestKey =
    selectedLocation && rangeStart && rangeEnd
      ? `${selectedLocation.id}:${rangeStart}:${rangeEnd}`
      : "";

  useEffect(() => {
    if (
      mapMetric === "precipitation" ||
      !selectedMonth ||
      weatherData?.month === selectedMonth
    ) {
      return;
    }

    const controller = new AbortController();
    async function loadWeatherData() {
      setWeatherStatus("Loading temperature and humidity data...");
      try {
        const query = new URLSearchParams({ month: selectedMonth });
        const response = await fetch(`/api/weather?${query}`, {
          signal: controller.signal,
        });
        const result = (await response.json()) as
          | WeatherMapResponse
          | { error?: string };
        if (!response.ok) {
          throw new Error(
            (result as { error?: string }).error ??
              `Weather data request failed (${response.status})`
          );
        }

        const data = result as WeatherMapResponse;
        setWeatherData(data);
        setWeatherStatus(
          `${data.records.length.toLocaleString()} weather grid locations for ${data.month}.`
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setWeatherStatus(
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    void loadWeatherData();
    return () => controller.abort();
  }, [mapMetric, selectedMonth, weatherData]);

  useEffect(() => {
    if (!selectedLocation || !rangeStart || !rangeEnd) return;

    const location = selectedLocation;
    const requestKey = `${location.id}:${rangeStart}:${rangeEnd}`;
    const controller = new AbortController();
    async function loadMoistureSeries() {
      setMoistureStatus("Loading moisture history...");
      try {
        const query = new URLSearchParams({
        lat: String(location.grid_lat),
        lon: String(location.grid_lon),
          start: rangeStart,
          end: rangeEnd,
        });
        const response = await fetch(`/api/weather?${query}`, {
          signal: controller.signal,
        });
        const result = (await response.json()) as
          | MoistureSeriesResponse
          | { error?: string };
        if (!response.ok) {
          throw new Error(
            (result as { error?: string }).error ??
              `Moisture series request failed (${response.status})`
          );
        }

        const data = result as MoistureSeriesResponse;
        setMoistureData({ requestKey, series: data.series });
        const availableMonths = data.series.filter((point) =>
          [
            point.soil_moisture_index,
            point.leaf_wetness_index,
            point.evapotranspiration_mm,
          ].some((value) => value !== null)
        ).length;
        setMoistureStatus(
          `${availableMonths} months with moisture measurements`
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setMoistureStatus(
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    void loadMoistureSeries();
    return () => controller.abort();
  }, [rangeEnd, rangeStart, selectedLocation]);

  const visibleMoistureSeries =
    moistureData?.requestKey === moistureRequestKey ? moistureData.series : [];

  const { locations, stats } = useMemo(() => {
    let rows: MapPoint[] = [];
    if (mapMetric === "precipitation") {
      rows = (currentData?.records ?? []).map((row) => ({
        Lon: row.Lon,
        Lat: row.Lat,
        value: row[TARGET_COLUMN],
      }));
    } else if (currentWeatherData) {
      rows = currentWeatherData.records.flatMap((row) => {
        const value =
          mapMetric === "temperature"
            ? row.temperature_c
            : mapMetric === "maxTemperature"
              ? row.max_temperature_c
              : mapMetric === "minTemperature"
                ? row.min_temperature_c
                : mapMetric === "humidity"
                  ? row.relative_humidity_pct
                  : mapMetric === "soilMoisture"
                    ? row.soil_moisture_index
                    : mapMetric === "leafWetness"
                      ? row.leaf_wetness_index
                      : row.evapotranspiration_mm;
        return value !== null && Number.isFinite(value)
          ? [{ Lon: row.Lon, Lat: row.Lat, value }]
          : [];
      });
    }

    const inSonora = rows.filter(
      (row) =>
        Number.isFinite(row.value) &&
        pointInSonora(row.Lon, row.Lat, SONORA_POLYGONS)
    );
    const values = inSonora.map((row) => row.value);
    const max = values.reduce(
      (highest, value) => Math.max(highest, value),
      0
    );

    return {
      locations: inSonora,
      stats: {
        min: values.length ? Math.min(...values) : 0,
        max,
        avg: values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : 0,
        count: inSonora.length,
      },
    };
  }, [currentData, currentWeatherData, mapMetric]);

  if (!leafletDeps) {
    return <p className="p-5 text-center text-slate-600">{status}</p>;
  }

  const { MapContainer, TileLayer, CircleMarker, Popup } = leafletDeps;
  const isPrediction = view === "prediction";

  return (
    <section className="mx-auto w-full max-w-6xl items-center p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">
            Mapa meteorológico de Sonora
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {mapMetric === "precipitation" ? status : weatherStatus}
          </p>
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
                setRangeStart("");
                setRangeEnd("");
                setView(event.target.value as ViewMode);
              }}
            >
              <option value="actual">Observado · 2023–2024</option>
              <option value="prediction">Predicción · 2025–2026</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            Variable
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2"
              value={mapMetric}
              onChange={(event) =>
                setMapMetric(event.target.value as MapMetric)
              }
            >
              <option value="precipitation">Precipitación</option>
              <option value="temperature">Temperatura media</option>
              <option value="maxTemperature">Temperatura máxima</option>
              <option value="minTemperature">Temperatura mínima</option>
              <option value="humidity">Humedad</option>
              <option value="soilMoisture">Humedad del suelo</option>
              <option value="leafWetness">Humedad foliar</option>
              <option value="evapotranspiration">Evapotranspiración</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            Desde
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2"
              value={rangeStart}
              onChange={(event) => {
                const nextStart = event.target.value;
                setRangeStart(nextStart);
                if (rangeEnd && nextStart > rangeEnd) setRangeEnd(nextStart);
              }}
              disabled={!months.length}
            >
              {months.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            Hasta
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2"
              value={rangeEnd}
              onChange={(event) => {
                const nextEnd = event.target.value;
                setRangeEnd(nextEnd);
                if (rangeStart && nextEnd < rangeStart) setRangeStart(nextEnd);
              }}
              disabled={!months.length}
            >
              {months.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
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
                  {isPrediction ? ` · entrada ${previousMonth(month)}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            Mapa
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2"
              value={mapLayer}
              onChange={(event) =>
                setMapLayer(event.target.value as "satellite" | "street")
              }
            >
              <option value="satellite">Satelital</option>
              <option value="street">Calles</option>
            </select>
          </label>
        </div>
      </header>

      <section className="mb-5 space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">
            Serie mensual por ciudad o localidad
          </h2>
          <p className="text-sm text-slate-500">
            Catálogo de lugares de Sonora situados al menos 15 km tierra
            adentro. Puedes buscar ranchos por su nombre cuando están
            registrados como localidades.
          </p>
        </div>
        <div className="relative max-w-xl">
          <label
            className="mb-1 block text-sm font-medium text-slate-700"
            htmlFor="sonora-location-search"
          >
            Buscar ciudad, localidad o rancho
          </label>
          <input
            id="sonora-location-search"
            type="search"
            autoComplete="off"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800"
            placeholder="Ej. Hermosillo, Nogales, Rancho..."
            value={locationSearch}
            onChange={(event) => setLocationSearch(event.target.value)}
          />
          {locationSearch.trim() &&
            locationSearch.trim() !== selectedLocation?.name && (
              <div className="absolute z-[1000] mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {locationOptions.length ? (
                  locationOptions.map((location) => (
                    <button
                      className="block w-full border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50"
                      key={location.id}
                      type="button"
                      onClick={() => {
                        setSelectedLocation(location);
                        setLocationSearch(location.name);
                      }}
                    >
                      <span className="block font-medium text-slate-800">
                        {location.name}
                      </span>
                      <span className="text-xs text-slate-500">
                        {location.type} · municipio {location.municipality_code}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-2 text-sm text-slate-500">
                    No matching inland Sonora locations.
                  </p>
                )}
              </div>
            )}
          {selectedLocation && (
            <p className="mt-2 text-sm text-slate-600">
              Selected: <strong>{locationLabel(selectedLocation)}</strong>
            </p>
          )}
        </div>
        <LocationPrecipitationChart
          points={visibleLocationSeries}
          view={view}
          locationName={selectedLocation?.name ?? "Sonora"}
          status={seriesStatus}
        />
        {selectedLocation && (
          <MoistureHistoryChart
            points={visibleMoistureSeries}
            locationName={selectedLocation.name}
            status={moistureStatus}
          />
        )}
        <details className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
          <summary className="cursor-pointer font-medium">
            Data source and searchable catalog
          </summary>
          <p className="mt-2">
            The graph uses the nearest inland IMERG grid cell for the selected
            place. Settlement names come from GeoNames (CC BY 4.0); this catalog
            is not a complete official ranch registry. Search “Rancho” to find
            ranch-named localities present in the source.
          </p>
        </details>
      </section>

      <div className="mb-3 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">
        {mapMetric === "precipitation" ? (
          currentData ? (
            <>
              {isPrediction ? "Pronóstico" : "Valor observado"} para el periodo{" "}
              <strong>
                {currentData.period_start} a {currentData.period_end}
              </strong>
              , calculado con datos del mes{" "}
              <strong>{currentData.input_month}</strong>.
            </>
          ) : (
            status
          )
        ) : currentWeatherData ? (
          <>
            {mapMetricLabel(mapMetric)} observada para el mes{" "}
            <strong>{currentWeatherData.month}</strong>.
          </>
        ) : (
          weatherStatus || "Loading temperature and humidity data..."
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
            key={mapLayer}
            attribution={
              mapLayer === "satellite"
                ? "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
                : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }
            url={
              mapLayer === "satellite"
                ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            }
          />
          {locations.map((location) => {
            return (
              <CircleMarker
                key={`${location.Lat},${location.Lon}`}
                center={[location.Lat, location.Lon]}
                radius={5}
                pathOptions={{
                  color: "#ffffff",
                  weight: 1,
                  fillColor: mapPointColor(
                    mapMetric,
                    location.value,
                    stats.max
                  ),
                  fillOpacity: 0.9,
                }}
              >
                <Popup>
                  <div className="space-y-1">
                    <strong>
                      {mapMetric === "precipitation"
                        ? isPrediction
                          ? "Pronóstico"
                          : "Valor observado"
                        : mapMetricLabel(mapMetric)}{" "}
                      {selectedMonth}
                    </strong>
                    <div>
                      {mapMetricLabel(mapMetric)}: {location.value.toFixed(2)}{" "}
                      {mapMetricUnit(mapMetric)}
                    </div>
                    <div>
                      Lat: {location.Lat.toFixed(3)}, Lon: {location.Lon.toFixed(3)}
                    </div>
                    {mapMetric === "precipitation" && currentData && (
                      <div>
                        Periodo: {currentData.period_start} a{" "}
                        {currentData.period_end}
                      </div>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>

      {stats.count > 0 && (
        <div className="mt-3 flex items-center gap-3 text-xs text-slate-600">
          <span>{mapMetricLabel(mapMetric)}</span>
          <span>{stats.min.toFixed(1)} {mapMetricUnit(mapMetric)}</span>
          <div
            aria-label={`${mapMetricLabel(mapMetric)} color scale`}
            className="h-2 flex-1 rounded-full"
            role="img"
            style={{ background: mapLegendGradient(mapMetric) }}
          />
          <span>{stats.max.toFixed(1)} {mapMetricUnit(mapMetric)}</span>
        </div>
      )}

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
              {label} ·{" "}
              {mapMetric === "precipitation"
                ? isPrediction
                  ? "prevista"
                  : "observada"
                : mapMetricLabel(mapMetric)}
            </p>
            <p className="mt-2 text-2xl font-bold text-cyan-700">
              {Number(value).toFixed(2)} {mapMetricUnit(mapMetric)}
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
    </section>
  );
}
