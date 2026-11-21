import type { NextConfig } from "next";
import { siteConsentPath, siteConsentRequiredHeader } from "./lib/site-consent";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: { "/*": ["./lib/directory/migrations/*.sql"] },
  poweredByHeader: false,
  logging: { incomingRequests: { ignore: [/^\/(?:search|api\/traffic)(?:[/?]|$)/] } },
  experimental: { cpus: 2 },
  async rewrites() {
    return {
      beforeFiles: [{
        source: "/((?!(?:api|admin|_next|welcome|ad-icons|ai-product-icons|contact-icons|bin-data|region|\\.well-known)(?:/|$)|(?:robots\\.txt|sitemap\\.xml|favicon\\.ico)$).*)",
        has: [{ type: "header", key: siteConsentRequiredHeader, value: "1" }],
        // Use an internal path even when the public HTTPS connection ends at Nginx.
        destination: siteConsentPath,
      }],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
        ],
      },
      {
        source: "/sitemap.xml",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        source: "/bin-data/issuer-regions-fcc907c.bin",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/search",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      ...["/admin/:path*", "/api/admin/:path*", "/account", "/login", "/register", "/api/account"].map((source)=>({
        source,headers:[{key:"Cache-Control",value:"private, no-store"},{key:"X-Robots-Tag",value:"noindex, nofollow"}],
      })),
      {source:"/admin/:path*",headers:[{key:"Referrer-Policy",value:"same-origin"}]},
      {source:"/community",has:[{type:"query",key:"view",value:"saved"}],
        headers:[{key:"Cache-Control",value:"private, no-store"},{key:"X-Robots-Tag",value:"noindex, nofollow"}]},
    ];
  },
};

export default config;
