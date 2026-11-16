import type { Metadata } from "next";
import { param,type Params } from "@/components/directory/catalog-page";
import { brand } from "@/lib/brand";
import { getSite } from "@/lib/directory/read";
import { pipelines } from "@/lib/directory/taxonomy";

const merchantLabels:Record<string,string>={"ai-topup":"AI 会员代充","ai-card":"AI 卡网 / 发卡站","ai-relay":"API 中转",airport:"机场 / 节点订阅",vpn:"商业 VPN",
  "u-card":"U 卡","virtual-card":"虚拟信用卡","payment-accounts":"跨境支付","subscription-payment":"订阅支付",vps:"VPS / 云服务器"};

export const dynamic = "force-dynamic";
export const metadata:Metadata = {title:"联系与纠错",description:"提交资料纠错、推荐新商家、发表商家回应或联系合作。",alternates:{canonical:"/contact"}};
export default async function Contact({searchParams}:{searchParams:Promise<Params>}) {
  const search=await searchParams;
  const site=getSite(param(search.site));
  const result=param(search.result);
  return <div className="frame page article editorial-page">
    <div className="catalog-heading"><p className="print-label">联系本站</p><h1>联系与纠错</h1><p>{site ? `为 ${site.name} 提交信息。` : "通过表单推荐新服务、指出错误或提交商家回应。"}</p></div>
    <nav className="filter-pills" aria-label="联系渠道"><a href="#feedback">资料投稿与纠错</a><a href="#cooperation">合作联系</a></nav>
    <div className="policy-copy contact-sections">
      <section id="feedback" aria-labelledby="feedback-heading">
        <h2 id="feedback-heading">资料投稿与纠错</h2>
        <p>请附商家名称、需要核对的内容和可查阅的公开来源。商家回应也可通过下方表单提交。</p>
        {result && <p className="form-notice" role="status">{result==="ok"?"已收到，资料进入编辑审核。":result==="limited"?"相同资料已提交，或当前投稿较多，请稍后再试。":"提交失败，请检查网址和说明内容。"}</p>}
        {!site&&<details open={search.submit==="merchant"}><summary>商家提交收录</summary>
          <form action="/api/submissions" method="post" className="field-stack">
            <input type="hidden" name="kind" value="site"/><input type="hidden" name="merchant" value="1"/>
            <label>商家名称<input name="merchant_name" maxLength={100} required/></label>
            <label>所属分类<select name="merchant_category" required><option value="">请选择</option>
              {Object.entries(pipelines).map(([key,pipeline])=><optgroup key={key} label={pipeline.label}>{pipeline.categories.map(category=><option key={category} value={category}>{merchantLabels[category]}</option>)}</optgroup>)}
            </select></label>
            <label>商家官网<input name="url" type="url" maxLength={1500} required/></label>
            <label>公开资料说明<textarea name="body" required minLength={15} maxLength={1600} rows={3} placeholder="请说明服务类别和如何通过公开资料确认归属。"/></label>
            <label>公开联系方式（选填）<input name="merchant_contact" maxLength={180}/></label>
            <label>套餐信息（选填）<textarea name="merchant_offers" maxLength={800} rows={2}/></label>
            <label>运营状态说明（选填）<input name="merchant_operations" maxLength={300}/></label>
            <label><span><input type="checkbox" name="publication_consent" value="1" required/> 我代表商家提交，并同意公开名称、官网、分类与可复核的来源。</span></label>
            <div hidden aria-hidden="true"><label>公司<input name="company" tabIndex={-1} autoComplete="off"/></label></div>
            <button type="submit" className="button primary">提交商家资料</button>
          </form>
        </details>}
        <form action="/api/submissions" method="post" className="field-stack">
          {site && <input type="hidden" name="site" value={site.slug}/>}
          <label>信息类型<select name="kind" defaultValue={site?"correction":"site"}><option value="site">推荐服务商</option><option value="correction">纠错或补充资料</option><option value="response">商家回应</option></select></label>
          <label>官网或公开来源<input name="url" placeholder="https://..." maxLength={1500}/></label>
          <label>详细说明<textarea name="body" required minLength={15} maxLength={1600} rows={6} placeholder="写明需要核查的内容，请勿填入敏感信息。"/></label>
          <div hidden aria-hidden="true"><label>公司<input name="company" tabIndex={-1} autoComplete="off"/></label></div>
          <button type="submit" className="button primary">提交给编辑部</button>
        </form>
      </section>
      <section id="cooperation" aria-labelledby="cooperation-heading">
        <h2 id="cooperation-heading">合作联系</h2>
        <p>欢迎商家资料对接、数据授权和内容合作。来信请附机构名称、官网、合作事项和可公开的相关资料。</p>
        <p><a className="text-link cooperation-email" href={`mailto:${brand.cooperationEmail}`}>{brand.cooperationEmail}</a></p>
        <p>商业合作会明确标注。档案核实、编辑审核和用户评分按本站内容政策独立处理。</p>
      </section>
    </div>
  </div>;
}
