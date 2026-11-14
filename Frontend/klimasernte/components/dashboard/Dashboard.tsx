
"use client";

import { useEffect, useState } from "react";
import L from "leaflet";
// @ts-ignore leaflet.heat extends Leaflet at runtime and may not ship typings.
import "leaflet.heat";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const DATA_URL =
  "https://api.meteomatics.com/2018-01-01T00:00:00.000-06:00--2026-11-01T00:00:00.000-06:00:PT1H/t_2m:C/23.6585116,-102.0077097/json?model=mix";
const INITIAL_POSITION: [number, number] = [23.6585116, -102.0077097];

type HeatPoint = [number, number, number];

function parseHeatPoints(payload: unknown): HeatPoint[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];

  const locations: { lat: number; lon: number; value: number }[] = [];
  for (const series of data) {
    if (!Array.isArray(series?.coordinates)) continue;
    for (const coordinate of series.coordinates) {
      const lat = Number(coordinate?.lat);
      const lon = Number(coordinate?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const values = Array.isArray(coordinate.dates)
        ? coordinate.dates
            .map((item: { value?: unknown }) => Number(item?.value))
            .filter(Number.isFinite)
        : [];
      if (values.length) {
        locations.push({
          lat,
          lon,
          value: values.reduce((sum: number, value: number) => sum + value, 0) / values.length,
        });
      }
    }
  }

  if (!locations.length) return [];
  const min = Math.min(...locations.map(({ value }) => value));
  const max = Math.max(...locations.map(({ value }) => value));
  return locations.map(({ lat, lon, value }) => [
    lat,
    lon,
    max === min ? 0.8 : 0.2 + ((value - min) / (max - min)) * 0.8,
  ]);
}

function HeatLayer({ points }: { points: HeatPoint[] }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;
    const leafletWithHeat = L as typeof L & {
      heatLayer: (data: HeatPoint[], options: object) => L.Layer;
    };
    const layer = leafletWithHeat.heatLayer(points, {
      radius: 32,
      blur: 22,
      maxZoom: 10,
      minOpacity: 0.35,
    });
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map, points]);

  return null;
}

const Dashboard = () => {
  const [points, setPoints] = useState<HeatPoint[]>([]);
  const [status, setStatus] = useState("Cargando datos meteorológicos...");

  useEffect(() => {
    const controller = new AbortController();

    fetch(DATA_URL, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`La API respondió ${response.status}`);
        return response.json();
      })
      .then((payload: unknown) => {
        const heatPoints = parseHeatPoints(payload);
        setPoints(heatPoints);
        setStatus(
          heatPoints.length
            ? `Mapa actualizado con ${heatPoints.length} ubicación(es).`
            : "La respuesta no contiene coordenadas con datos válidos.",
        );
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setStatus(
          `No se pudieron cargar los datos. Comprueba el acceso a Meteomatics y CORS${
            error instanceof Error ? ` (${error.message})` : ""
          }.`,
        );
      });

    return () => controller.abort();
  }, []);

  return (
    <section style={{ width: "100%" }}>
      <p role="status" style={{ margin: "0 0 8px" }}>
        {status}
      </p>
      <MapContainer
        center={INITIAL_POSITION}
        zoom={5}
        scrollWheelZoom
        style={{ height: "600px", width: "100%", borderRadius: "8px" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <HeatLayer points={points} />
      </MapContainer>
      <small>
        El enlace proporciona una sola coordenada; para un mapa de calor geográfico real necesitas
        datos de varias ubicaciones.
      </small>
    </section>
  );
};

export default Dashboard;
