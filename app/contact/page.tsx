import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { param,type Params } from "@/components/directory/catalog-page";
import { brand } from "@/lib/brand";
import { getSite } from "@/lib/directory/read";
import { isRetiredCategory,pipelines,publicPipelines } from "@/lib/directory/taxonomy";
import { contentVisibility } from "@/lib/geo/request";

const merchantLabels:Record<string,string>={"ai-topup":"AI 会员代充","ai-card":"AI 卡网 / 发卡站","ai-relay":"API 中转",
  "u-card":"U 卡","virtual-card":"虚拟信用卡","payment-accounts":"跨境支付","subscription-payment":"订阅支付",vps:"VPS / 云服务器"};

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {title:t("联系与纠错"),description:t("提交资料纠错、地区访问反馈、隐私相关请求或合作联系。"),alternates:{canonical:"/contact"}};
}
export default async function Contact({searchParams}:{searchParams:Promise<Params>}) {
  const t = await getTranslations();
  const search=await searchParams;
  const visibility=await contentVisibility();
  const site=getSite(param(search.site),undefined,visibility);
  const result=param(search.result);
  return <div className="frame page article editorial-page">
    <div className="catalog-heading"><p className="print-label">{t("联系本站")}</p><h1>{t("联系与纠错")}</h1><p>{site ? t("为 {name} 提交资料、更正或回应。", { name: site.name }) : t("通过表单提交资料、反馈站点问题或提出隐私相关请求。")}</p></div>
    <nav className="filter-pills" aria-label={t("联系渠道")}><a href="#feedback">{t("资料投稿与纠错")}</a><a href="#cooperation">{t("合作联系")}</a></nav>
    <div className="policy-copy contact-sections">
      <section id="feedback" aria-labelledby="feedback-heading">
        <h2 id="feedback-heading">{t("资料投稿与纠错")}</h2>
        <p>{t("推荐商家、纠正报价或提交商家回应时，请写明商家或商品名称、需要核对的内容及公开来源。涉及报价变化时，请附对应的观察日期。")}</p>
        <p>{t("地区访问和隐私相关请求可选择「纠错或补充资料」。反馈地区访问时，请写明页眉显示的内容地区、页面链接和发生时间。请勿提供公网 IP、密码、验证码、卡号或付款凭证。")}</p>
        {result && <p className="form-notice" role="status">{result==="ok"?t("已收到，资料进入编辑审核。"):result==="limited"?t("相同资料已提交，或当前投稿较多，请稍后再试。"):t("提交失败，请检查网址和说明内容。")}</p>}
        {!site&&<details open={search.submit==="merchant"}><summary>{t("商家提交收录")}</summary>
          <form action="/api/submissions" method="post" className="field-stack">
            <input type="hidden" name="kind" value="site"/><input type="hidden" name="merchant" value="1"/>
            <label>{t("商家名称")}<input name="merchant_name" maxLength={100} required/></label>
            <label>{t("所属分类")}<select name="merchant_category" required><option value="">{t("请选择")}</option>
              {publicPipelines.map(key=>({key,categories:pipelines[key].categories.filter(category=>!isRetiredCategory(category)&&visibility.categoryAllowed(category))}))
                .filter(item=>item.categories.length).map(({key,categories})=><optgroup key={key} label={t(pipelines[key].label)}>{categories.map(category=><option key={category} value={category}>{t(merchantLabels[category])}</option>)}</optgroup>)}
            </select></label>
            <label>{t("商家官网")}<input name="url" type="url" maxLength={1500} required/></label>
            <label>{t("公开资料说明")}<textarea name="body" required minLength={15} maxLength={1600} rows={3} placeholder={t("请说明服务类别和如何通过公开资料确认归属。")}/></label>
            <label>{t("公开联系方式（选填）")}<input name="merchant_contact" maxLength={180}/></label>
            <label>{t("套餐信息（选填）")}<textarea name="merchant_offers" maxLength={800} rows={2}/></label>
            <label>{t("运营状态说明（选填）")}<input name="merchant_operations" maxLength={300}/></label>
            <label><span><input type="checkbox" name="publication_consent" value="1" required/>{" "}{t("我代表商家提交，并同意公开名称、官网、分类与可复核的来源。")}</span></label>
            <div hidden aria-hidden="true"><label>{t("公司")}<input name="company" tabIndex={-1} autoComplete="off"/></label></div>
            <button type="submit" className="button primary">{t("提交商家资料")}</button>
          </form>
        </details>}
        <form action="/api/submissions" method="post" className="field-stack">
          {site && <input type="hidden" name="site" value={site.slug}/>}
          <label>{t("信息类型")}<select name="kind" defaultValue={site?"correction":"site"}><option value="site">{t("推荐服务商")}</option><option value="correction">{t("纠错或补充资料")}</option><option value="response">{t("商家回应")}</option></select></label>
          <label>{t("官网或公开来源")}<input name="url" placeholder="https://..." maxLength={1500}/></label>
          <label>{t("详细说明")}<textarea name="body" required minLength={15} maxLength={1600} rows={6} placeholder={t("写明问题、发生时间和希望核对的内容。")}/></label>
          <div hidden aria-hidden="true"><label>{t("公司")}<input name="company" tabIndex={-1} autoComplete="off"/></label></div>
          <button type="submit" className="button primary">{t("提交给编辑部")}</button>
        </form>
      </section>
      <section id="cooperation" aria-labelledby="cooperation-heading">
        <h2 id="cooperation-heading">{t("合作联系")}</h2>
        <p>{t("欢迎联系商家资料收录、数据授权、内容合作及推广。请在邮件中写明机构名称、官网、合作事项和可公开的资料。涉及推广时，请一并说明拟展示的地区和适用的服务条款。")}</p>
        <p><a className="text-link cooperation-email" href={`mailto:${brand.cooperationEmail}`}>{brand.cooperationEmail}</a></p>
        <p>{t("合作内容须符合本站内容政策、地区访问规则及适用法律法规。商业合作会明确标注，商家档案、编辑审核和用户评分按本站内容政策独立处理。")}</p>
      </section>
    </div>
  </div>;
}
