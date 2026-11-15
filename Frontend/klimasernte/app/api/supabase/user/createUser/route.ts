import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const userColumns =
  "id,uuid,nombre,producersize,email,isfarmer,created_at,updated_at,apellido_p,apellido_m,activate_u,photourl";

type CreateUserBody = {
  nombre?: unknown;
  apellido_p?: unknown;
  apellido_m?: unknown;
  email?: unknown;
  producerSize?: unknown;
  photourl?: unknown;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function POST(request: NextRequest) {
  let body: CreateUserBody;
  try {
    body = (await request.json()) as CreateUserBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (
    !isNonEmptyString(body.nombre) ||
    !isNonEmptyString(body.apellido_p) ||
    !isNonEmptyString(body.apellido_m) ||
    !isNonEmptyString(body.email) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ||
    !["small", "medium", "big"].includes(String(body.producerSize).toLowerCase())
  ) {
    return NextResponse.json(
      { success: false, error: "Missing or invalid required user fields." },
      { status: 400 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { success: false, error: "Supabase is not configured." },
      { status: 500 },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const producerSize = String(body.producerSize).toLowerCase();
  const photoUrl = typeof body.photourl === "string" ? body.photourl.trim() : "";
  const { data, error } = await supabase
    .from("usuarios")
    .insert({
      uuid: randomUUID(),
      nombre: body.nombre.trim(),
      apellido_p: body.apellido_p.trim(),
      apellido_m: body.apellido_m.trim(),
      email: body.email.trim().toLowerCase(),
      producersize: producerSize,
      isfarmer: true,
      activate_u: true,
      photourl: photoUrl || null,
    })
    .select(userColumns)
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json(
      {
        success: false,
        error:
          error.code === "23505"
            ? "A profile with this email already exists."
            : error.message,
      },
      { status },
    );
  }

  return NextResponse.json({ success: true, data });
}