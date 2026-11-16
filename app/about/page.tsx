import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@/lib/brand";

export const metadata: Metadata = {title:"关于本站",description:brand.motto,alternates:{canonical:"/about"}};
export default function About() {
  return <article className="frame page article editorial-page"><div className="catalog-heading"><p className="print-label">关于本站</p><h1>关于山海知序</h1><p>{brand.motto}</p></div>
    <div className="policy-copy">
      <section><h2>我们做什么</h2><p>山海知序是面向中文用户的独立数字服务资料库。我们整理 AI 代充与卡网、API 中转、机场与 VPN、跨境支付和云服务的公开档案、商品报价及使用条件，方便读者在订阅或购买前核对。</p><Link className="text-link" href="/services">浏览服务目录</Link></section>
      <section><h2>怎样阅读本站资料</h2><p>商家档案附可追溯来源。山海观察标明编辑整理和第三方测评的出处与范围。店铺综合评分由已审核的用户打分计算，并显示评分数量。社区公开展示通过审核的匿名评论和回复。</p><Link className="text-link" href="/policy">了解内容与核实政策</Link></section>
      <section><h2>更新与维护</h2><p>我们持续补充档案和商品，复核报价与链接，并依据来源修正错误、记录重要变化。欢迎读者补充公开资料，也欢迎商家就自己的档案提交更正或回应。</p><Link className="text-link" href="/contact">提交资料或纠错</Link></section>
    </div>
  </article>;
}
