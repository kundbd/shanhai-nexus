import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { PrivacyPolicy } from "@/components/site/privacy-policy";
import { siteAgreementTerms } from "@/lib/site-consent";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {title:t("内容政策与隐私"),description:t("山海知序的资料收录、用户协议、地区访问规则与隐私政策。"),alternates:{canonical:"/policy"}};
}
export default async function Policy() {
  const t = await getTranslations();
  return <article className="frame page article editorial-page"><div className="catalog-heading"><p className="print-label">{t("内容政策")}</p><h1>{t("内容政策与隐私")}</h1></div>
    <nav className="filter-pills" aria-label={t("政策章节")}><a href="#evidence">{t("收录与报价")}</a><a href="#editorial">{t("编辑与评价")}</a><a href="#agreement">{t("用户协议与地区规则")}</a><a href="#privacy">{t("隐私政策")}</a><a href="#disclaimer">{t("免责声明")}</a></nav>
    <div className="policy-copy">
      <section id="evidence"><h2>{t("收录与报价")}</h2>
        <p>{t("收录以商家域名和可访问的公开页面为基础。平台上的独立店铺按店铺名称及链接识别。档案会列出可查阅的原始来源，方便读者核对。")}</p>
        <dl className="policy-legend">
        <dt>{t("公开报价")}</dt><dd>{t("有可追溯标价时记录原币种、计费条件和观察日期。AI 订阅按产品、等级、计费周期及交付方式分别比较。缺少来源时显示暂无公开报价。")}</dd>
        <dt>{t("商家评价")}</dt><dd>{t("用户评价见商家详情，编辑测评见山海观察。评价和测评各有自己的依据。")}</dd>
        <dt>{t("已失效 / 停运")}</dt><dd>{t("有公开证据时会标明停运，历史档案仍可查询。")}</dd>
      </dl></section>
      <section id="editorial"><h2>{t("编辑独立性与纠错")}</h2>
        <p>{t("山海观察标明资料性质，包括官方公开资料、站方实测、第三方报道、用户报告和待核实信息。第三方测评附原文链接，观点归原作者。涉及商业合作的内容会明确标注，档案核实和编辑审核按统一规则处理。")}</p>
        <p>{t("商家综合评分取自已审核的用户打分，并显示评分数量。匿名评论和回复经过屏蔽词检查与审核后公开。请描述亲身体验，并保护个人信息。")}</p>
        <p>{t("评论区和帖子区讨论商家与服务体验，禁止涉政内容、人身攻击、隐私曝光、垃圾广告和违法交易招揽。涉及价格、退款或疑似欺诈的消费经历，可按实际情况陈述。")}</p>
        <p>{t("确认违规的内容会被移除，首次警告，第二次起禁言 3 天。可在个人中心查看处置，并通过联系页面申请复核。")}</p>
        <p>{t("编辑根据来源与证据处理纠错和商家回应。具有充分依据的记录按内容政策保留。")}</p>
        <Link className="text-link" href="/contact#feedback">{t("提交纠错或回应")}</Link>
      </section>
      <section id="agreement">
        <h2>{t("用户协议与地区规则")}</h2>
        <p>{t("首次访问时，请阅读并勾选用户协议和隐私政策，确认后可进入原页面。")}</p>
        <ol className="site-consent-terms">
          {siteAgreementTerms.map(term => <li key={term}>{t(term)}</li>)}
        </ol>
        <p>{t("本站按页眉显示的内容地区提供资料。中国大陆地区开放基础内容，网络代理信息服务按第 3 条地区公告执行。")}</p>
        <Link className="text-link" href="/messages">{t("查看地区公告")}</Link>
      </section>
      <section id="privacy"><h2>{t("隐私政策")}</h2>
        <PrivacyPolicy />
        <Link className="text-link" href="/contact#feedback">{t("提交隐私相关请求")}</Link>
      </section>
      <section id="disclaimer"><h2>{t("免责声明")}</h2>
        <p>{t("本站提供商家公开资料、商品报价和相应来源，供订阅或购买前查阅。报价对应观察时的商品、地区、币种及周期。库存、优惠、结算金额与服务条件以商家页面及结算页为准。")}</p>
        <p>{t("商品、交易、付款、交付、退款和售后由对应商家负责。付款前请核对商家身份、结算总额、服务适用地区和退款条件。发现错价、失效链接或资料归属问题，可提交来源供编辑核查。")}</p>
        <Link className="text-link" href="/contact#feedback">{t("反馈档案问题")}</Link>
      </section>
    </div>
  </article>;
}
