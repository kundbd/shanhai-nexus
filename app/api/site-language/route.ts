import { NextResponse, type NextRequest } from "next/server";
import { formFields } from "@/lib/directory/admin-request";
import { isSiteLanguage, languageCookie } from "@/lib/i18n/language";
import { siteConsentDestination } from "@/lib/site-consent";
import { sameOriginBrowserRequest } from "@/lib/site-request";

const noStore = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  if (!sameOriginBrowserRequest(request)) return new Response(null, { status: 403, headers: noStore });

  let fields: Record<string, string>;
  try {
    fields = await formFields(request, 16 * 1024);
  } catch {
    return new Response(null, { status: 400, headers: noStore });
  }
  if (!isSiteLanguage(fields.language)) return new Response(null, { status: 400, headers: noStore });

  const response = new NextResponse(null, {
    status: 303,
    headers: { ...noStore, Location: siteConsentDestination(fields.destination) },
  });
  response.cookies.set(languageCookie, fields.language, {
    path: "/", httpOnly: true, sameSite: "lax", maxAge: 365 * 24 * 60 * 60,
    secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
  });
  return response;
}
