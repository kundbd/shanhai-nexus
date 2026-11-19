import { NextResponse, type NextRequest } from "next/server";
import { formFields } from "@/lib/directory/admin-request";
import { sameOriginBrowserRequest } from "@/lib/site-request";
import { siteConsentCookie, siteConsentDays, siteConsentDestination, siteConsentVersion } from "@/lib/site-consent";

const noStore = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  if (!sameOriginBrowserRequest(request)) {
    return new Response("请求来源无效。", { status: 403, headers: noStore });
  }
  let fields: Record<string, string>;
  try {
    fields = await formFields(request, 32 * 1024);
  } catch {
    return new Response("表单格式无效。", { status: 400, headers: noStore });
  }
  if (fields.agreement !== siteConsentVersion || fields.privacy !== siteConsentVersion) {
    return new Response("请先接受本站用户协议和隐私政策。", { status: 400, headers: noStore });
  }
  const response = new NextResponse(null, {
    status: 303, headers: { ...noStore, Location: siteConsentDestination(fields.destination) },
  });
  response.cookies.set(siteConsentCookie, siteConsentVersion, {
    path: "/", httpOnly: true, sameSite: "lax", maxAge: siteConsentDays * 24 * 60 * 60,
    secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
  });
  return response;
}
