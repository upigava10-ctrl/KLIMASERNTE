import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

function redirectToLogin(request: NextRequest, response?: NextResponse) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/auth/login";
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  const redirectResponse = NextResponse.redirect(loginUrl);
  response?.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}

export async function proxy(request: NextRequest) {
  const isLoginPage = request.nextUrl.pathname === "/auth/login";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return isLoginPage
      ? NextResponse.next({ request })
      : redirectToLogin(request);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  let isRegistered = false;
  if (user) {
    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("uuid")
      .eq("uuid", user.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    isRegistered = profile !== null;
  }

  if (!user || !isRegistered) {
    return isLoginPage ? response : redirectToLogin(request, response);
  }

  if (isLoginPage) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/";
    destination.search = "";
    return NextResponse.redirect(destination);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
