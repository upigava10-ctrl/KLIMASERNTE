import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";

interface WeatherPoint {
  Lat: number;
  Lon: number;
  temperature_c: number | null;
  max_temperature_c: number | null;
  min_temperature_c: number | null;
  relative_humidity_pct: number | null;
  soil_moisture_index: number | null;
  leaf_wetness_index: number | null;
  evapotranspiration_mm: number | null;
}

type WeatherIndex = Map<string, WeatherPoint[]>;
interface MoistureSeriesPoint {
  month: string;
  soil_moisture_index: number | null;
  leaf_wetness_index: number | null;
  evapotranspiration_mm: number | null;
}

function coordinateKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}:${longitude.toFixed(5)}`;
}

const WEATHER_CSV_PATH = join(process.cwd(), "data", "t_hum.csv");
let weatherIndexPromise: Promise<WeatherIndex> | undefined;

async function loadWeatherIndex(): Promise<WeatherIndex> {
  const index = new Map<string, Map<string, WeatherPoint>>();
  const lines = createInterface({
    input: createReadStream(WEATHER_CSV_PATH, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let isHeader = true;

  for await (const line of lines) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    if (!line) continue;

    const fields = line.split(",");
    if (fields.length !== 5) {
      throw new Error("Weather CSV contains a malformed row.");
    }

    const [parameter, latitudeText, longitudeText, timestamp, valueText] =
      fields;
    if (
      parameter !== "t_2m:C" &&
      parameter !== "t_max_2m_24h:C" &&
      parameter !== "t_min_2m_24h:C" &&
      parameter !== "relative_humidity_2m:p" &&
      parameter !== "soil_moisture_index_-5cm:idx" &&
      parameter !== "leaf_wetness:idx" &&
      parameter !== "evapotranspiration_24h:mm"
    ) {
      continue;
    }

    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    const value = valueText ? Number(valueText) : null;
    const month = timestamp.slice(0, 7);
    if (
      !latitudeText ||
      !longitudeText ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      (value !== null && !Number.isFinite(value)) ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    ) {
      throw new Error("Weather CSV contains invalid coordinate or weather data.");
    }

    let points = index.get(month);
    if (!points) {
      points = new Map();
      index.set(month, points);
    }

    const key = coordinateKey(latitude, longitude);
    let point = points.get(key);
    if (!point) {
      point = {
        Lat: latitude,
        Lon: longitude,
        temperature_c: null,
        max_temperature_c: null,
        min_temperature_c: null,
        relative_humidity_pct: null,
        soil_moisture_index: null,
        leaf_wetness_index: null,
        evapotranspiration_mm: null,
      };
      points.set(key, point);
    }

    if (parameter === "t_2m:C") {
      point.temperature_c = value;
    } else if (parameter === "t_max_2m_24h:C") {
      point.max_temperature_c = value;
    } else if (parameter === "t_min_2m_24h:C") {
      point.min_temperature_c = value;
    } else if (parameter === "relative_humidity_2m:p") {
      point.relative_humidity_pct = value;
    } else if (parameter === "soil_moisture_index_-5cm:idx") {
      point.soil_moisture_index = value;
    } else if (parameter === "leaf_wetness:idx") {
      point.leaf_wetness_index = value;
    } else {
      point.evapotranspiration_mm = value;
    }
  }

  return new Map(
    [...index].map(([month, points]) => [month, [...points.values()]])
  );
}

function getWeatherIndex(): Promise<WeatherIndex> {
  weatherIndexPromise ??= loadWeatherIndex().catch((error: unknown) => {
    weatherIndexPromise = undefined;
    throw error;
  });
  return weatherIndexPromise;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const latitudeText = searchParams.get("lat");
  const longitudeText = searchParams.get("lon");
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (latitudeText !== null || longitudeText !== null || start || end) {
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    if (
      latitudeText === null ||
      longitudeText === null ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180 ||
      !start ||
      !end ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(start) ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(end) ||
      start > end
    ) {
      return NextResponse.json(
        { error: "Provide valid lat, lon, start, and end parameters." },
        { status: 400 }
      );
    }

    const first = new Date(`${start}-01T00:00:00Z`);
    const last = new Date(`${end}-01T00:00:00Z`);
    const monthCount =
      (last.getUTCFullYear() - first.getUTCFullYear()) * 12 +
      last.getUTCMonth() -
      first.getUTCMonth() +
      1;
    if (monthCount > 36) {
      return NextResponse.json(
        { error: "Weather series ranges may not exceed 36 months." },
        { status: 400 }
      );
    }

    try {
      const index = await getWeatherIndex();
      const series: MoistureSeriesPoint[] = [];
      for (let offset = 0; offset < monthCount; offset += 1) {
        const monthDate = new Date(
          Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + offset, 1)
        );
        const month = `${monthDate.getUTCFullYear()}-${String(
          monthDate.getUTCMonth() + 1
        ).padStart(2, "0")}`;
        const point = index
          .get(month)
          ?.find(
            (record) =>
              coordinateKey(record.Lat, record.Lon) ===
              coordinateKey(latitude, longitude)
          );
        series.push({
          month,
          soil_moisture_index: point?.soil_moisture_index ?? null,
          leaf_wetness_index: point?.leaf_wetness_index ?? null,
          evapotranspiration_mm: point?.evapotranspiration_mm ?? null,
        });
      }

      return NextResponse.json(
        { start, end, series },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (error) {
      console.error("Could not load moisture series from CSV:", error);
      return NextResponse.json(
        { error: "Moisture series could not be loaded." },
        { status: 500 }
      );
    }
  }

  const month = searchParams.get("month");
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json(
      { error: "Provide month as YYYY-MM." },
      { status: 400 }
    );
  }

  try {
    const records = (await getWeatherIndex()).get(month);
    if (!records?.length) {
      return NextResponse.json(
        { error: `No weather data is available for ${month}.` },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { month, records },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Could not load temperature and humidity CSV data:", error);
    return NextResponse.json(
      { error: "Temperature and humidity map data could not be loaded." },
      { status: 500 }
    );
  }
}
