import type { Metadata } from "next";
import { headers } from "next/headers";
import { Header } from "@/components/site/header";
import { Footer } from "@/components/site/footer";
import { RegionIndicator } from "@/components/site/region-indicator";
import { SiteLanguageProvider } from "@/components/site/language";
import { PageTraffic } from "@/components/site/page-traffic";
import { Assistant } from "@/components/site/assistant";
import { siteDescription, siteUrl } from "@/lib/site";
import { brand, legacyThemeStorageKey, themeStorageKey } from "@/lib/brand";
import { siteConsentRequiredHeader } from "@/lib/site-consent";
import { getSiteLanguage, getTranslations } from "@/lib/i18n/server";
import "./globals.css";
import "./directory.css";
import "./assistant.css";

const themeScript = `try{var t=localStorage.getItem('${themeStorageKey}')??localStorage.getItem('${legacyThemeStorageKey}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const language = await getSiteLanguage();
  const t = await getTranslations();
  const description = t(siteDescription);
  const name = language === "en" ? brand.english : `${brand.name} ${brand.english}`;
  const openGraphLocale = { "zh-CN": "zh_CN", "zh-Hant": "zh_TW", en: "en_US" };
  return {
    metadataBase: siteUrl(),
    title: { default: `${name} · ${t("独立数字服务评测与消费指南")}`, template: `%s · ${language === "en" ? brand.english : brand.name}` },
    description,
    applicationName: brand.english,
    openGraph: { siteName: name, type: "website", locale: openGraphLocale[language], description },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pendingConsent = (await headers()).get(siteConsentRequiredHeader) === "1";
  const language = await getSiteLanguage();
  const t = await getTranslations();
  return <html lang={language} suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
    <body>
      <SiteLanguageProvider language={language}>
        {!pendingConsent && <>
          <a className="skip-link" href="#main">{t("跳到主要内容")}</a>
          <Header region={<RegionIndicator />} />
        </>}
        <main id="main" tabIndex={-1}>{children}</main>
        {!pendingConsent && <><Footer /><PageTraffic /><Assistant enabled={Boolean(process.env.DEEPSEEK_API_KEY?.trim())} /></>}
      </SiteLanguageProvider>
    </body>
  </html>;
}
