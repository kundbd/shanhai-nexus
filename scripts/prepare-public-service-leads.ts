import { writeFileSync } from "node:fs";
import { directory,all } from "../lib/directory/db";
import { assessAutomatedAdmission } from "../lib/directory/merchant-lead-page";
import { limitedBacklogVisit } from "../lib/directory/merchant-lead-review";
import { merchantNameKey } from "../lib/directory/merchant-evidence";
import { readPublicPage,websiteVisit } from "../lib/directory/website-check";
import { pipelineForCategory,type Pipeline } from "../lib/directory/taxonomy";
import { today,websiteUrl } from "../lib/directory/validation";

const target=process.argv[2];
if (!target) throw new Error("请指定候选核对结果文件。");
const db=directory();
const found=all<{domain:string;pipeline:Pipeline;proof:string;detail:string|null}>(db,`WITH lead AS (
  SELECT c.registrable domain,c.pipeline,r.proof_url proof,json_extract(r.evidence,'$.detail') detail,r.outcome,r.checked_at,
    ROW_NUMBER() OVER (PARTITION BY c.registrable ORDER BY (r.outcome='merchant') DESC,r.checked_at DESC) rank
  FROM merchant_lead_reviews r JOIN merchant_candidates c ON c.id=r.candidate_id
  WHERE c.state NOT IN ('known','rejected') AND r.outcome IN ('merchant','possible') AND r.proof_url IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM site_domains d WHERE d.registrable=c.registrable)
) SELECT domain,pipeline,proof,detail FROM lead WHERE rank=1 ORDER BY (outcome='merchant') DESC, checked_at DESC`);
const names=new Set(all<{name:string}>(db,"SELECT name FROM sites WHERE publication='published'").map(({name})=>merchantNameKey(name)));
db.close();
const candidates=(["ai-retail","ai-relay","connections"] as const).flatMap(pipeline=>found.filter(lead=>lead.pipeline===pipeline).slice(0,36));
const transport=limitedBacklogVisit(websiteVisit(),6,650);
const privatePage=/\/(?:auth|login|signin|signup|register|checkout|pay|account|console|dashboard|token|redeem)(?:[/.]|$)/i;
const ads=/评测|测评|比价|导航|教程|博客|自建|资源站|开源|纯分享|\b(?:review|compare|blog|guide|directory|self.hosted)\b/i;
const verification:Record<string,string>={};
const merchants:{slug:string;name:string;category:string;website:string;summary:string;sources:{url:string;note:string}[]}[]=[];
async function inspect(lead:typeof candidates[number]) {
  for (const raw of [...new Set([lead.proof,lead.detail])].filter((url):url is string=>Boolean(url))) {
    try {
      const entry=websiteUrl(raw);
      if (entry.registrable!==lead.domain || privatePage.test(new URL(entry.url).pathname)) continue;
      const page=await readPublicPage(entry.url,(url,signal,max)=>{
        if (privatePage.test(url.pathname)) throw new Error("转向账户页面");
        return transport(url,signal,max);
      },190_000,10_000,0);
      const proof=assessAutomatedAdmission(lead.pipeline,page);
      if (proof.outcome!=="merchant"||!proof.name||!proof.category||pipelineForCategory(proof.category)!==lead.pipeline ||
          ads.test(proof.title)||merchantNameKey(proof.name).length<2||names.has(merchantNameKey(proof.name))||
          proof.category==="proxy-services"||proof.checkout) { verification[lead.domain]=proof.reason;continue; }
      const name=proof.name;
      names.add(merchantNameKey(name));
      merchants.push({slug:lead.domain.replace(/[^a-z0-9]+/g,"-"),name,category:proof.category,website:page.url,
        summary:`此站公开页面展示${proof.category==="ai-relay"?"模型 API 接入":proof.category==="airport"?"节点订阅":proof.category==="vpn"?"VPN 服务":"AI 会员商品"}。`,
        sources:[{url:page.url,note:`公开页面观察记录。页面标题：${proof.title.slice(0,115)}。`}]});
      verification[lead.domain]="accepted";
      return;
    } catch (error) {
      verification[lead.domain]=error instanceof Error?error.message.slice(0,130):"本次访问未完成";
      if (/robots|HTTP (401|403|429)|访问验证/.test(verification[lead.domain])) return;
    }
  }
}

let next=0;
async function worker() {
  for (;;) {
    const lead=candidates[next++];
    if (!lead) return;
    await inspect(lead);
  }
}
async function finish() {
  await Promise.all(Array.from({length:8},worker));
  writeFileSync(target,JSON.stringify({observed:today(),merchants,verification},null,2));
  console.log(JSON.stringify({checked:candidates.length,accepted:merchants.length}));
}
void finish().catch(error=>{console.error(error);process.exitCode=1;});
