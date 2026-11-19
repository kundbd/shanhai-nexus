import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { PrivacyPolicy } from "@/components/site/privacy-policy";
import { SiteConsentForm } from "@/components/site/site-consent-form";
import { LanguageSwitch } from "@/components/site/language";
import { brand } from "@/lib/brand";
import { siteAgreementTerms } from "@/lib/site-consent";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("用户协议"), robots: { index: false, follow: false } };
}

export default async function Welcome() {
  const t = await getTranslations();
  return <div className="site-consent-screen">
    <section className="site-consent-card" role="dialog" aria-modal="true" aria-labelledby="site-consent-title">
      <div className="site-consent-top"><p className="site-consent-brand">{brand.name}</p><LanguageSwitch /></div>
      <h1 id="site-consent-title">{t("用户协议")}</h1>
      <ol className="site-consent-terms">
        {siteAgreementTerms.map(term => <li key={term}>{t(term)}</li>)}
      </ol>
      <details className="site-consent-privacy">
        <summary>{t("查看本站隐私政策")}</summary>
        <div className="policy-copy"><PrivacyPolicy /></div>
      </details>
      <SiteConsentForm />
    </section>
  </div>;
}
