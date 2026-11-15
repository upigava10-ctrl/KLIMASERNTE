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
}

type WeatherIndex = Map<string, WeatherPoint[]>;

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
      parameter !== "relative_humidity_2m:p"
    ) {
      continue;
    }

    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    const value = Number(valueText);
    const month = timestamp.slice(0, 7);
    if (
      !latitudeText ||
      !longitudeText ||
      !valueText ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(value) ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    ) {
      throw new Error("Weather CSV contains invalid coordinate or weather data.");
    }

    let points = index.get(month);
    if (!points) {
      points = new Map();
      index.set(month, points);
    }

    const coordinateKey = `${latitude}:${longitude}`;
    let point = points.get(coordinateKey);
    if (!point) {
      point = {
        Lat: latitude,
        Lon: longitude,
        temperature_c: null,
        max_temperature_c: null,
        min_temperature_c: null,
        relative_humidity_pct: null,
      };
      points.set(coordinateKey, point);
    }

    if (parameter === "t_2m:C") {
      point.temperature_c = value;
    } else if (parameter === "t_max_2m_24h:C") {
      point.max_temperature_c = value;
    } else if (parameter === "t_min_2m_24h:C") {
      point.min_temperature_c = value;
    } else {
      point.relative_humidity_pct = value;
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
  const month = request.nextUrl.searchParams.get("month");
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
        { error: `No temperature or humidity data is available for ${month}.` },
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
