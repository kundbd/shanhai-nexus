import type { Metadata } from "next";
import { PrivacyPolicy } from "@/components/site/privacy-policy";
import { SiteConsentForm } from "@/components/site/site-consent-form";
import { brand } from "@/lib/brand";
import { siteServiceRegionClause } from "@/lib/site-consent";

export const metadata: Metadata = { title: "用户协议", robots: { index: false, follow: false } };

export default function Welcome() {
  return <div className="site-consent-screen">
    <section className="site-consent-card" role="dialog" aria-modal="true" aria-labelledby="site-consent-title">
      <p className="site-consent-brand">{brand.name}</p>
      <h1 id="site-consent-title">用户协议</h1>
      <ol className="site-consent-terms">
        <li>本站仅提供商家信息及来源，不对商品和商家负责。</li>
        <li>禁止利用本站信息进行违法犯罪活动，一经发现，后果自负。</li>
        <li>不支持地区的用户禁止通过不法手段访问本站。</li>
        <li>{siteServiceRegionClause}</li>
      </ol>
      <details className="site-consent-privacy">
        <summary>查看本站隐私政策</summary>
        <div className="policy-copy"><PrivacyPolicy /></div>
      </details>
      <SiteConsentForm />
    </section>
  </div>;
}
