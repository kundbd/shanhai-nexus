import type { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { all,one,transaction } from "./db";
import { merchantSearchLead } from "./discovery-rules";
import { assessAutomatedAdmission,assessBasicAdmission,assessLeadPage,catalogSourceDisposition,preferredBasicDetail,preferredLeadDetail,type LeadPage,type PageAssessment } from "./merchant-lead-page";
import { NetworkFailure,parseProxy,retryableNetworkCodes } from "./network-transport";
import type { Pipeline } from "./taxonomy";
import { now,websiteUrl } from "./validation";
import { readPublicPage,websiteVisit,WebsiteNetworkFailure,type Visit } from "./website-check";

type Outcome=PageAssessment["outcome"]|"existing"|"unavailable";
type Entry={candidate_id:number;lease_until:string;registrable:string;pipeline:Pipeline};
type PageFinding={url:string;finalUrl?:string;status?:number;outcome:Outcome;reason:string;assessment?:PageAssessment;retryable?:boolean;retry?:boolean;followup?:boolean};
type Finding={outcome:Outcome;reason:string;proofUrl?:string;pages:PageFinding[];evidence?:PageAssessment;existing?:number};
type Reader=(url:string)=>Promise<LeadPage>;
type ReviewMode="lead"|"basic"|"backlog";
type History={outcome:Outcome;reason:string;proof_url:string|null;pages:string};

const referenceHosts=new Set(["raw.githubusercontent.com","gist.githubusercontent.com","web.archive.org","archive.org"]);
const privatePage=/\/(?:auth|login|sign-?in|signup|sign-up|register|account|checkout|pay|dashboard|console|token|redeem|subscribe)(?:[/.]|$)/i;

function urlsFor(db:DatabaseSync,row:Entry,mode:ReviewMode,history?:History) {
  const refs=all<{url:string}>(db,`SELECT DISTINCT url FROM (
    SELECT url FROM merchant_source_links WHERE candidate_id=? AND filter_reason=''
    UNION SELECT url FROM merchant_urls WHERE candidate_id=?) LIMIT 160`,row.candidate_id,row.candidate_id);
  const home=new Map<string,number>();
  const paths=new Map<string,number>();
  const historicalPages=history ? JSON.parse(history.pages) as PageFinding[] : [];
  for (const ref of [...refs.map(item=>item.url),...historicalPages.flatMap(page=>[page.finalUrl??page.url,page.assessment?.detail].filter((url):url is string=>!!url))]) {
    try {
      const {target}=merchantSearchLead(ref);
      if (target.registrable!==row.registrable) continue;
      const landing=new URL(target.homepage);
      const prior=home.get(target.homepage);
      const preferred=(landing.protocol==="https:"?4:0)+(landing.hostname===row.registrable||landing.hostname===`www.${row.registrable}`?9:0);
      home.set(target.homepage,prior===undefined?preferred+1:prior+1);
      const path=new URL(target.url).pathname;
      if (privatePage.test(path)||path==="/") continue;
      const rank=mode==="lead"?preferredLeadDetail(path):preferredBasicDetail(path);
      if (rank>=2) paths.set(target.url,rank);
    } catch { /* Malformed or protected leads stay in discovery history. */ }
  }
  if (mode==="backlog"&&!home.size) {
    try { home.set(merchantSearchLead("https://"+row.registrable+"/").target.homepage,1); } catch { /* An invalid domain remains out of scope. */ }
  }
  const homes=[...home].sort((a,b)=>b[1]-a[1]).map(([url])=>url);
  const references=[...paths].sort((a,b)=>b[1]-a[1]).map(([url])=>url);
  return {home:homes[0],details:references,alternate:homes[1]};
}

const ranking:Record<Outcome,number>={existing:10,merchant:9,non_merchant:8,redirect:7,possible:6,restricted:5,unavailable:4,insufficient:3};

function failure(error:unknown,url:string):PageFinding {
  const message=error instanceof Error?error.message:"公开页面请求未完成";
  const cross=message.match(/跳往其他注册域（([a-z\d.-]+)）/i);
  if (cross) return {url,outcome:"redirect",reason:`${message.startsWith("robots")?"robots.txt":"公开页面"}跳往 ${cross[1]}，尚不能确认同一主体`};
  if (error instanceof WebsiteNetworkFailure) {
    if (["address_policy","proxy_policy"].includes(error.failure.code)) return {url,outcome:"restricted",reason:error.message};
    return {url,outcome:"unavailable",reason:error.message,
      retryable:retryableNetworkCodes.has(error.failure.code)||["total_timeout","network","proxy_connect"].includes(error.failure.code)};
  }
  if (/^无法确认 robots\.txt（HTTP (408|500|502|503|504)）/.test(message)) {
    return {url,outcome:"unavailable",reason:message.slice(0,170),retryable:true};
  }
  if (/^robots\.txt 禁止|^无法确认 robots\.txt|^公开入口转到登录|^公开页面要求访问验证|HTTP (401|402|403|407|429|451)\b/.test(message)) {
    return {url,outcome:"restricted",reason:message.slice(0,170)};
  }
  if (/^公开页面返回 HTTP \d{3}|^同域跳转次数达到上限/.test(message)) {
    return {url,outcome:"unavailable",reason:message.slice(0,170),retryable:/^公开页面返回 HTTP (408|500|502|503|504)\b/.test(message)};
  }
  return {url,outcome:"insufficient",reason:"公开网址未通过访问检查，未取得经营证据"};
}

const focusTerms=/ChatGPT|Claude|Gemini|Grok|Codex|Cursor|订阅|代充|商城|店铺|卡密|套餐|节点|机场|\bVPN\b|API.{0,12}(?:中转|聚合|网关)|(?:AI|LLM).{0,25}(?:gateway|routing|router)/i;
function reuseHistory(history:History) {
  if (["restricted","unavailable","non_merchant"].includes(history.outcome)) return true;
  if (history.outcome!=="insufficient") return false;
  const pages=JSON.parse(history.pages) as PageFinding[];
  return !pages.some(page=>page.assessment&&(focusTerms.test(page.assessment.title+" "+page.assessment.description)||
    page.assessment.detail&&preferredBasicDetail(new URL(page.assessment.detail).pathname)>=5));
}

export function limitedBacklogVisit(request:Visit,perSecond=12,perDomainMs=650):Visit {
  const domainSpots=new Map<string,number>();
  const robots=new Map<string,Awaited<ReturnType<Visit>>>();
  let globalSpot=0;
  return async (url,signal,maxBytes)=>{
    if (signal.aborted) throw new NetworkFailure("total_timeout","connect");
    const isRobots=url.pathname==="/robots.txt"&&!url.search;
    const cached=isRobots?robots.get(url.origin):undefined;
    if (cached) return cached;
    const domain=websiteUrl(url.href).registrable;
    for (;;) {
      const start=performance.now();
      const wait=Math.max(globalSpot,domainSpots.get(domain)??0)-start;
      if (wait<=0) {
        globalSpot=start+1000/perSecond;
        domainSpots.set(domain,start+perDomainMs);
        break;
      }
      try { await delay(Math.ceil(wait),undefined,{signal}); }
      catch { throw new NetworkFailure("total_timeout","connect"); }
    }
    const page=await request(url,signal,maxBytes);
    if (isRobots&&([404,410].includes(page.status)||(page.status>=200&&page.status<300&&!page.truncated))) robots.set(url.origin,page);
    return page;
  };
}

function backlogReader(mode:ReviewMode):Reader {
  const rate=Number(process.env.MERCHANT_BACKLOG_RATE??12);
  const transport=websiteVisit(parseProxy(process.env.MERCHANT_PROXY));
  const request=mode==="backlog"?limitedBacklogVisit(transport,Number.isInteger(rate)&&rate>=1&&rate<=20?rate:12):transport;
  return url=>readPublicPage(url,(target,signal,max)=>{
    if (privatePage.test(target.pathname)) throw new Error("公开入口转到登录或账户页面");
    return request(target,signal,max);
  },190_000,15_000,0);
}

async function inspectBacklog(url:string,read:Reader,pipeline:Pipeline):Promise<PageFinding> {
  try {
    const page=await read(url);
    const assessment=assessAutomatedAdmission(pipeline,page);
    return {url,finalUrl:page.url,status:page.status,outcome:assessment.outcome,reason:assessment.reason,assessment};
  } catch (error) { return failure(error,url); }
}

const historicalBlock=/robots\.txt (?:禁止|不允许)|无法确认 robots\.txt（HTTP 200）|公开页面要求访问验证|账户页面|公开入口转到登录|\[(?:address|proxy)_policy\]|HTTP (?:401|402|403|407|429|451)\b/i;

async function checkBacklog(targets:ReturnType<typeof urlsFor>,read:Reader,pipeline:Pipeline):Promise<Finding> {
  const pages:PageFinding[]=[];
  const visited=new Set<string>();
  const urls=[targets.home,...targets.details,targets.alternate].filter((url):url is string=>!!url);
  let retriesLeft=1;
  for (let i=0;i<urls.length&&visited.size<3;i++) {
    const url=urls[i];
    if (visited.has(url)||pages.some(page=>page.finalUrl===url)) continue;
    visited.add(url);
    let page=await inspectBacklog(url,read,pipeline);
    pages.push(page);
    if (page.retryable&&retriesLeft>0) {
      retriesLeft--;
      await delay(650);
      page={...await inspectBacklog(url,read,pipeline),retry:true};
      pages.push(page);
    }
    if (page.outcome==="merchant"||page.outcome==="restricted"||page.reason.startsWith("robots.txt 跳往")) break;
    if (page.outcome==="unavailable"&&page.reason.startsWith("robots.txt")&&
      !urls.slice(i+1).some(other=>new URL(other).origin!==new URL(url).origin)) break;
    const next=page.assessment?.detail;
    if (next&&!visited.has(next)) urls.splice(i+1,0,next);
  }
  const prefer=(page:PageFinding)=>page.outcome==="merchant"?9:page.outcome==="restricted"?8:page.status&&page.status>=200&&page.status<300?
    page.outcome==="non_merchant"?7:page.outcome==="redirect"?6:5:page.outcome==="redirect"?4:page.outcome==="unavailable"?3:1;
  const found=pages.reduce((best,page)=>prefer(page)>prefer(best)?page:best);
  return {outcome:found.outcome,reason:found.reason,pages,proofUrl:found.finalUrl??found.url,evidence:found.assessment};
}

async function checkLead(db:DatabaseSync,row:Entry,read:Reader,mode:ReviewMode,history?:History):Promise<Finding> {
  const existing=one<{site_id:number}>(db,`SELECT d.site_id FROM site_domains d JOIN sites s ON s.id=d.site_id
    WHERE d.registrable=? AND s.publication='published' LIMIT 1`,row.registrable);
  if (existing) return {outcome:"existing",reason:"注册域已关联现有公开档案",pages:[],existing:existing.site_id};
  if (referenceHosts.has(row.registrable)) return {outcome:"non_merchant",reason:"该域是公共代码文件或网页存档托管服务，搜索路径仅为引用材料",pages:[]};
  if (history&&(mode==="backlog"?history.outcome==="restricted"&&historicalBlock.test(history.reason):reuseHistory(history))) {
    return {outcome:history.outcome,reason:"沿用已有页面观察。"+history.reason,proofUrl:history.proof_url??undefined,pages:[]};
  }
  const {home,details,alternate}=urlsFor(db,row,mode,history);
  if (!home) return {outcome:"insufficient",reason:"只找到不可作经营证据的登录、下载或无效路径",pages:[]};
  if(mode==="backlog") return checkBacklog({home,details,alternate},read,row.pipeline);
  const pages:PageFinding[]=[];
  const visit=async(url:string)=>{
    try {
      const page=await read(url);
      const assessment=mode==="basic"?assessBasicAdmission(row.pipeline,page):assessLeadPage(row.pipeline,page);
      return {url,finalUrl:page.url,status:page.status,outcome:assessment.outcome,reason:assessment.reason,assessment} satisfies PageFinding;
    } catch (error) { return failure(error,url); }
  };
  const first=await visit(home);
  pages.push(first);
  const stop=mode==="basic"
    ?["restricted","non_merchant","redirect","merchant"].includes(first.outcome)
    :["restricted","non_merchant","redirect"].includes(first.outcome);
  if (!stop &&
      !(first.outcome==="unavailable"&&/^robots\.txt|\[dns\]|\[tls\]|\[connect_timeout\]/.test(first.reason))) {
    const next=[first.assessment?.detail,...details,alternate].find(url=>url&&url!==home&&url!==first.finalUrl);
    if (next) {
      const second=await visit(next);
      pages.push(second);
      if (mode==="basic"&&second.outcome==="insufficient") {
        const other=[second.assessment?.detail,...details,alternate].find(url=>url&&!pages.some(page=>page.url===url||page.finalUrl===url));
        if (other) pages.push(await visit(other));
      }
    }
  }
  const best=pages.reduce((prev,next)=>ranking[next.outcome]>ranking[prev.outcome]?next:prev);
  const outcome=best.outcome==="non_merchant"&&best!==first?"insufficient":best.outcome;
  const reason=outcome!==best.outcome?"子页面属于比较或资料内容，首页仍缺少经营主体证据":best.reason;
  return {outcome,reason,pages,proofUrl:best.finalUrl??best.url,evidence:best.assessment};
}

export function leadReviewReport(db:DatabaseSync,run:number,mode:ReviewMode="lead") {
  const progress=one<{total:number;checked:number;active:number}>(db,`SELECT count(*) total,count(r.checked_at) checked,
    count(CASE WHEN r.outcome IS NULL AND r.lease_until>? THEN 1 END) active
    FROM merchant_admission_decisions a LEFT JOIN merchant_lead_reviews r ON r.admission_run_id=a.run_id AND r.candidate_id=a.candidate_id
    WHERE a.run_id=? AND (a.outcome='lead' OR (?<>'lead' AND a.outcome='conflict'))
      AND (?<>'backlog' OR a.resolved_as IS NULL)`,now(),run,mode,mode)!;
  return {run,...progress,outcomes:all<{outcome:Outcome;n:number}>(db,`SELECT r.outcome,count(*) n FROM merchant_lead_reviews r
    JOIN merchant_admission_decisions a ON a.run_id=r.admission_run_id AND a.candidate_id=r.candidate_id
    WHERE r.admission_run_id=? AND r.outcome IS NOT NULL AND (a.outcome='lead' OR (?<>'lead' AND a.outcome='conflict'))
      AND (?<>'backlog' OR a.resolved_as IS NULL) GROUP BY r.outcome ORDER BY n DESC`,run,mode,mode)};
}

export async function reviewMerchantLeads(db:DatabaseSync,run:number,limit=5000,reader?:Reader,mode:ReviewMode="lead") {
  if (!Number.isSafeInteger(limit)||limit<1||limit>5000) throw new Error("线索复核批次须为 1 至 5,000 条。");
  if (!one(db,`SELECT 1 FROM merchant_admission_runs a JOIN merchant_campaigns c ON c.id=a.campaign_id
    WHERE a.id=? AND c.state='paused'`,run)) throw new Error("收录批次不存在或对应采集任务仍在运行。");
  const read=reader??backlogReader(mode);
  const rawWorkers=Number(process.env.MERCHANT_VERIFY_WORKERS??18);
  const workers=Number.isSafeInteger(rawWorkers)&&rawWorkers>=1&&rawWorkers<=24?rawWorkers:18;
  const enabled=db.prepare(`INSERT OR IGNORE INTO merchant_lead_reviews(admission_run_id,candidate_id)
    SELECT run_id,candidate_id FROM merchant_admission_decisions WHERE run_id=? AND (outcome='lead' OR (?<>'lead' AND outcome='conflict'))
      AND (?<>'backlog' OR resolved_as IS NULL)`);
  enabled.run(run,mode,mode);
  const historic=db.prepare(`SELECT outcome,reason,proof_url,pages FROM merchant_lead_reviews
    WHERE candidate_id=? AND admission_run_id<? AND checked_at IS NOT NULL ORDER BY admission_run_id DESC LIMIT 1`);
  const claim=db.prepare(`UPDATE merchant_lead_reviews SET lease_until=? WHERE admission_run_id=? AND candidate_id=(
    SELECT r.candidate_id FROM merchant_lead_reviews r JOIN merchant_admission_decisions a ON a.run_id=r.admission_run_id AND a.candidate_id=r.candidate_id
    WHERE r.admission_run_id=? AND r.outcome IS NULL AND r.lease_until<=? AND (a.outcome='lead' OR ?<>'lead')
      AND (?<>'backlog' OR a.resolved_as IS NULL) ORDER BY r.candidate_id LIMIT 1)
    RETURNING candidate_id,lease_until,(SELECT registrable FROM merchant_candidates WHERE id=candidate_id) registrable,
      (SELECT pipeline FROM merchant_candidates WHERE id=candidate_id) pipeline`);
  const store=db.prepare(`UPDATE merchant_lead_reviews SET lease_until='',checked_at=?,outcome=?,reason=?,proof_url=?,pages=?,evidence=?,existing_site=?
    WHERE admission_run_id=? AND candidate_id=? AND lease_until=? AND outcome IS NULL`);
  let taken=0,completed=0;
  await Promise.all(Array.from({length:Math.min(workers,limit)},async()=>{
    while (taken<limit) {
      const row=claim.get(new Date(Date.now()+90_000).toISOString(),run,run,now(),mode,mode) as Entry|undefined;
      if (!row) return;
      taken++;
      const started=performance.now();
      const history=mode!=="lead"?historic.get(row.candidate_id,run) as History|undefined:undefined;
      const checked=await checkLead(db,row,read,mode,history);
      const checkedAt=now();
      transaction(db,()=>{
        const saved=store.run(checkedAt,checked.outcome,checked.reason,checked.proofUrl??null,JSON.stringify(checked.pages),
          checked.evidence?JSON.stringify(checked.evidence):null,checked.existing??null,run,row.candidate_id,row.lease_until);
        if (saved.changes&&checked.outcome==="merchant"&&checked.proofUrl&&(checked.evidence?.basis||checked.evidence?.official)) {
          db.prepare(`INSERT INTO merchant_verification_attempts(candidate_id,checked_at,outcome,reason,elapsed_ms,proof_url)
            VALUES (?,?,?,?,?,?)`).run(row.candidate_id,checkedAt,checked.evidence.basis?"identity":"ready",checked.reason,Math.round(performance.now()-started),checked.proofUrl);
        }
      });
      if (++completed%100===0) console.error(`收录批次 #${run} 本次已复核 ${completed} 条线索`);
    }
  }));
  return leadReviewReport(db,run,mode);
}

const specificService=/自助发卡|卡密商城|AI.{0,10}会员代充|(?:ChatGPT|Claude|Gemini|Grok).{0,24}(?:会员|充值|月卡|年卡|共享席位)|(?:机场订阅|节点订阅|VPN套餐|VPS托管).{0,30}(?:购买|流量|月付|试用)|(?:提供|购买|开始使用).{0,30}(?:订阅|代充|聚合 API|API中转)|(?:LLM|model).{0,25}(?:gateway|API relay)/i;
const editorialEvidence=/评测|实测|排行|导航|百科|博客|文章|笔记|推荐汇总|price tracker|price ranking|directory|\bblog\b/i;
type Followup={candidate_id:number;registrable:string;pipeline:Pipeline;outcome:Outcome;reason:string;proof_url:string|null;pages:string;evidence:string|null};

function followupTargets(row:Followup) {
  const pages=JSON.parse(row.pages) as PageFinding[];
  if (pages.some(page=>page.followup)) return [];
  if (row.outcome==="merchant"&&row.proof_url) return [row.proof_url];
  const relevant=pages.filter(page=>page.status&&page.status>=200&&page.status<300&&page.assessment&&
    specificService.test(page.assessment.title+" "+page.assessment.description)&&!editorialEvidence.test(page.assessment.title)&&
    !catalogSourceDisposition(page.assessment.title,page.assessment.description));
  const attempted=new Set(pages.flatMap(page=>page.finalUrl?[page.url,page.finalUrl]:[page.url]));
  return [...new Set(relevant.flatMap(page=>{
    const detail=page.assessment?.detail;
    const original=page.finalUrl??page.url;
    const choices=detail&&!attempted.has(detail)?[detail,original]:[original];
    return choices.filter(value=>{
      try {
        const {target}=merchantSearchLead(value);
        const path=new URL(target.url).pathname;
        return target.registrable===row.registrable&&!privatePage.test(path)&&(path==="/"||preferredBasicDetail(path)>0);
      } catch { return false; }
    });
  }))].slice(0,2);
}

export async function refineMerchantBacklog(db:DatabaseSync,run:number,reader?:Reader) {
  const progress=leadReviewReport(db,run,"backlog");
  if (progress.checked!==progress.total) return {selected:0,completed:0,active:progress.active,ready:false};
  const observations=all<Followup>(db,`SELECT r.*,c.registrable,c.pipeline FROM merchant_lead_reviews r
    JOIN merchant_candidates c ON c.id=r.candidate_id JOIN merchant_admission_runs a ON a.id=r.admission_run_id
    JOIN merchant_campaigns m ON m.id=a.campaign_id WHERE r.admission_run_id=? AND m.state='paused' AND r.outcome IN ('insufficient','merchant')
    AND NOT EXISTS(SELECT 1 FROM merchant_admission_runs p WHERE p.reviewed_run_id=a.id) ORDER BY r.candidate_id`,run);
  const work=observations.map(row=>({row,urls:followupTargets(row)})).filter(item=>item.urls.length);
  const take=db.prepare(`UPDATE merchant_lead_reviews SET lease_until=? WHERE admission_run_id=? AND candidate_id=?
    AND lease_until<=? AND pages=?`);
  const save=db.prepare(`UPDATE merchant_lead_reviews SET checked_at=?,outcome=?,reason=?,proof_url=?,pages=?,evidence=?,lease_until=''
    WHERE admission_run_id=? AND candidate_id=? AND lease_until=?`);
  const add=db.prepare(`INSERT INTO merchant_verification_attempts(candidate_id,checked_at,outcome,reason,elapsed_ms,proof_url)
    VALUES (?,?,'identity',?,?,?)`);
  const read=reader??backlogReader("backlog");
  let cursor=0,completed=0;
  await Promise.all(Array.from({length:Math.min(work.length,14)},async()=>{
    while(cursor<work.length) {
      const {row,urls}=work[cursor++];
      const lease=new Date(Date.now()+60_000).toISOString();
      if(!take.run(lease,run,row.candidate_id,now(),row.pages).changes) continue;
      const start=performance.now();
      const pages=JSON.parse(row.pages) as PageFinding[];
      let next:PageFinding|undefined;
      for(const url of urls) {
        const snapshot={...await inspectBacklog(url,read,row.pipeline),followup:true};
        pages.push(snapshot);
        if (snapshot.status||snapshot.outcome==="restricted"||snapshot.outcome==="redirect") next=snapshot;
        if (snapshot.outcome==="merchant"||snapshot.outcome==="restricted") break;
      }
      const at=now(),source=next?.finalUrl??next?.url??row.proof_url;
      transaction(db,()=>{
        const recorded=save.run(at,next?.outcome??row.outcome,next?.reason??row.reason,source,JSON.stringify(pages),
          next?(next.assessment?JSON.stringify(next.assessment):null):row.evidence,run,row.candidate_id,lease);
        if(recorded.changes&&next?.outcome==="merchant"&&next.assessment?.basis&&source) {
          add.run(row.candidate_id,at,next.reason,Math.round(performance.now()-start),source);
        }
      });
      if(++completed%30===0) console.error("补充核对已完成 "+completed+" 条");
    }
  }));
  return {selected:work.length,completed,ready:completed===work.length};
}
