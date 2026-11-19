import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: { "/*": ["./content/articles/*.md", "./lib/directory/migrations/*.sql"] },
  poweredByHeader: false,
  logging: { incomingRequests: { ignore: [/^\/(?:search|api\/traffic)(?:[/?]|$)/] } },
  experimental: { cpus: 2 },
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
