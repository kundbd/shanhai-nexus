import { NextResponse, type NextRequest } from "next/server";
import { siteConsentCookie, siteConsentPath, siteConsentRequiredHeader, siteConsentVersion } from "@/lib/site-consent";

const privateResponse = { "Cache-Control": "private, no-store" };

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isWelcome = pathname === siteConsentPath;
  if (request.cookies.get(siteConsentCookie)?.value === siteConsentVersion) {
    if (isWelcome) return new NextResponse(null, { status: 307, headers: { ...privateResponse, Location: "/" } });
    if (!request.headers.has(siteConsentRequiredHeader)) return NextResponse.next();
    const headers = new Headers(request.headers);
    headers.delete(siteConsentRequiredHeader);
    return NextResponse.next({ request: { headers } });
  }

  const headers = new Headers(request.headers);
  headers.set(siteConsentRequiredHeader, "1");
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Cache-Control", privateResponse["Cache-Control"]);
  return response;
}

export const config = {
  matcher: ["/((?!(?:api|admin|_next|ad-icons|ai-product-icons|contact-icons|bin-data|region|\\.well-known)(?:/|$)|(?:robots\\.txt|sitemap\\.xml|favicon\\.ico)$).*)"],
};
