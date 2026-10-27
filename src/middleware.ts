import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase session cookie before rendering and marks every response private.
// Page reads use getClaims: it verifies the JWT locally (asymmetric signing keys, cached JWKS) and
// refreshes a session near expiry without a round trip to Auth; the page loaders still ask Auth
// (getUser), so a revoked session is caught there. Everything else (server actions are POSTs)
// keeps getUser here: it clears a revoked session's cookies before RPC-only actions run.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  if (request.method === "GET" || request.method === "HEAD") await supabase.auth.getClaims();
  else await supabase.auth.getUser();
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (request.nextUrl.protocol === "https:") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|healthz|favicon.ico).*)"],
};
