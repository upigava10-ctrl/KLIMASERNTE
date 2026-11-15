import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const userColumns =
  "id,uuid,nombre,producersize,email,isfarmer,created_at,updated_at,apellido_p,apellido_m,activate_u,photourl";

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json(
      { success: false, error: "An email query parameter is required." },
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
  const { data, error } = await supabase
    .from("usuarios")
    .select(userColumns)
    .eq("email", email)
    .eq("activate_u", true)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { success: false, error: "No active profile was found for this email." },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true, data });
}