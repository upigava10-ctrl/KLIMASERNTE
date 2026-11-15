import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

const DATA_DIRECTORY = path.resolve(
  process.cwd(),
  "../../Backend/data/sonora_precipitation"
);
const FILE_PREFIX = "sonora_imerg_";

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");

  if (!date) {
    try {
      const files = await readdir(DATA_DIRECTORY);
      const dates = files
        .map((file) => file.match(/^sonora_imerg_(\d{4}-\d{2}-\d{2})\.csv$/)?.[1])
        .filter((fileDate): fileDate is string => Boolean(fileDate))
        .sort()
        .reverse();

      return NextResponse.json({ dates });
    } catch (error) {
      console.error("Could not list IMERG CSV files:", error);
      return NextResponse.json(
        { error: "Could not load IMERG file list." },
        { status: 500 }
      );
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid IMERG date." }, { status: 400 });
  }

  const filePath = path.join(DATA_DIRECTORY, `${FILE_PREFIX}${date}.csv`);

  try {
    const csv = await readFile(filePath, "utf8");
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json(
        { error: `No IMERG CSV found for ${date}.` },
        { status: 404 }
      );
    }

    console.error(`Could not read IMERG CSV for ${date}:`, error);
    return NextResponse.json(
      { error: "Could not read IMERG CSV file." },
      { status: 500 }
    );
  }
}
