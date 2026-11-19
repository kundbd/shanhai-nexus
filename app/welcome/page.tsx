import type { Metadata } from "next";
import { PrivacyPolicy } from "@/components/site/privacy-policy";
import { SiteConsentForm } from "@/components/site/site-consent-form";
import { brand } from "@/lib/brand";
import { siteAgreementTerms } from "@/lib/site-consent";

export const metadata: Metadata = { title: "用户协议", robots: { index: false, follow: false } };

export default function Welcome() {
  return <div className="site-consent-screen">
    <section className="site-consent-card" role="dialog" aria-modal="true" aria-labelledby="site-consent-title">
      <p className="site-consent-brand">{brand.name}</p>
      <h1 id="site-consent-title">用户协议</h1>
      <ol className="site-consent-terms">
        {siteAgreementTerms.map(term => <li key={term}>{term}</li>)}
      </ol>
      <details className="site-consent-privacy">
        <summary>查看本站隐私政策</summary>
        <div className="policy-copy"><PrivacyPolicy /></div>
      </details>
      <SiteConsentForm />
    </section>
  </div>;
}
