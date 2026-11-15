import { NextRequest, NextResponse } from "next/server";

const FLASK_API_URL = (
  process.env.FLASK_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");
const ALLOWED_ENDPOINTS = new Set([
  "health",
  "months",
  "monthly",
  "series",
  "locations",
  "location-series",
]);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  if (path.length !== 1 || !ALLOWED_ENDPOINTS.has(path[0])) {
    return NextResponse.json({ error: "Unknown model API endpoint." }, { status: 404 });
  }

  try {
    const upstream = await fetch(
      `${FLASK_API_URL}/api/${path[0]}${request.nextUrl.search}`,
      { cache: "no-store", signal: request.signal }
    );
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Could not reach the Flask model API:", error);
    return NextResponse.json(
      { error: "The model service is unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
