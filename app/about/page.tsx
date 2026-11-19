import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {title:t("关于本站"),description:t("了解山海知序如何整理公开商家资料、维护报价和运营评论社区。"),alternates:{canonical:"/about"}};
}
export default async function About() {
  const t = await getTranslations();
  return <article className="frame page article editorial-page"><div className="catalog-heading"><p className="print-label">{t("关于本站")}</p><h1>{t("关于山海知序")}</h1><p>{brand.motto}</p></div>
    <div className="policy-copy">
      <section>
        <h2>{t("我们做什么")}</h2>
        <p>{t("山海知序是面向中文用户的独立数字服务资料库。我们整理 AI 代充与卡网、API 中转、跨境支付和云服务的公开商家档案、商品报价及使用条件，方便你在订阅或购买前核对价格、观察日期和出处。")}</p>
        <Link className="text-link" href="/services">{t("浏览服务目录")}</Link>
      </section>
      <section>
        <h2>{t("怎样阅读本站资料")}</h2>
        <p>{t("山海观察注明编辑整理和第三方测评的出处，第三方测评的观点归原作者。店铺综合评分来自审核通过的用户打分，评分旁会显示人数。登录后可匿名评价商家，也可以用账号名在评论社区发帖和回复。")}</p>
        <p>{t("首次访问需确认用户协议与隐私政策。页眉会显示当前内容地区，服务资料和推广内容按该地区的开放范围展示。")}</p>
        <Link className="text-link" href="/policy">{t("查看内容政策与用户协议")}</Link>
      </section>
      <section>
        <h2>{t("更新与维护")}</h2>
        <p>{t("我们持续补充商家和商品档案，复核公开报价与失效链接，并依据来源纠正错误、记录变化。读者可补充公开资料，商家也可就自己的档案提交更正或回应。")}</p>
        <Link className="text-link" href="/contact">{t("提交资料或纠错")}</Link>
      </section>
    </div>
  </article>;
}
