import type { Metadata } from "next";
import { headers } from "next/headers";
import { Header } from "@/components/site/header";
import { Footer } from "@/components/site/footer";
import { RegionIndicator } from "@/components/site/region-indicator";
import { PageTraffic } from "@/components/site/page-traffic";
import { siteDescription, siteUrl } from "@/lib/site";
import { brand, legacyThemeStorageKey, themeStorageKey } from "@/lib/brand";
import { siteConsentRequiredHeader } from "@/lib/site-consent";
import "./globals.css";
import "./directory.css";

const themeScript = `try{var t=localStorage.getItem('${themeStorageKey}')??localStorage.getItem('${legacyThemeStorageKey}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: `${brand.name} ${brand.english} · 独立数字服务评测与消费指南`, template: `%s · ${brand.name}` },
  description: siteDescription,
  applicationName: brand.english,
  openGraph: { siteName: `${brand.name} ${brand.english}`, type: "website", locale: "zh_CN", description: siteDescription },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pendingConsent = (await headers()).get(siteConsentRequiredHeader) === "1";
  return <html lang="zh-CN" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
    <body>
      {!pendingConsent && <>
        <a className="skip-link" href="#main">跳到主要内容</a>
        <Header region={<RegionIndicator />} />
      </>}
      <main id="main" tabIndex={-1}>{children}</main>
      {!pendingConsent && <><Footer /><PageTraffic /></>}
    </body>
  </html>;
}
