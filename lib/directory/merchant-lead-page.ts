import { assessMerchant,cleanTitle,merchantSearchLead } from "./discovery-rules";
import { externalSalesLink,parseMerchantMetadata } from "./discovery-providers";
import { merchantNameKey,merchantProof } from "./merchant-evidence";
import type { Pipeline } from "./taxonomy";
import { websiteUrl } from "./validation";

export type LeadPage={url:string;status:number;body:string;contentType:string;truncated:boolean};
export type PageAssessment={outcome:"merchant"|"possible"|"non_merchant"|"redirect"|"restricted"|"insufficient";reason:string;title:string;description:string;
  name?:string;category?:string;detail?:string;official?:boolean;destination?:string;basis?:"retail"|"subscription"|"gateway"|"other";checkout?:string};

const commercialPath=/\/(?:pricing|prices?|plans?|products?|store|shop|services?|memberships?|billing|packages?)(?:[/.-]|$)/i;
const evidencePath=/\/(?:api-reference|model-list|models?|docs?|documentation|features|ai-gateway)(?:[/.-]|$)/i;
const editorialPath=/\/(?:blogs?|news|posts?|articles?|tags?|guides?|review|reviews|compare|ranking|recommend|wiki|forums?|threads?|categories)(?:[/.-]|$)/i;
const accountPath=/\/(?:login|sign-?in|signup|sign-up|register|account|register\.php|console|panel|dashboard)(?:[/.]|$)/i;
const commerceLabel=/购买|下单|开通|套餐|充值|定价|自助开通|查询订单|马上订阅|查看商品|order now|buy now|pricing|plans|subscription plans|view products/i;
const loginLabel=/^(?:控制台|登录|注册|免费注册|用户中心|获取 API Key|login|log in|sign in|register|sign up|dashboard|console|get (?:an? )?api key)$/i;
const park=/^(?:domain (?:for sale|parking)|this domain (?:is |may be )?(?:for sale|parked)|buy this domain|域名出售|域名停放|sedo domain parking|afternic|hugedomains\.com|dan\.com)(?:\b|\s|$)|(?:Buy this domain|this domain is for sale).{0,70}(?:Afternic|Sedo|GoDaddy|Namecheap)/i;
const noSales=/本站(?:仅|只)提供(?:导航|资讯|信息)|本站(?:不提供|不销售|不经营).{0,25}(?:代充|VPN|代理服务|任何商品|交易)|不参与(?:商家)?交易|independent (?:comparison|directory)|we do not (?:sell|provide|operate).{0,45}(?:any vpn|proxy service|reseller|products)/i;
const directoryWords=/导航|排行榜|评测(?:与推荐)?|比价|收录平台|服务商大全|比较工具|affiliate disclosure|directory|reviews? and comparisons|benchmark(?:s|ing)?/i;
const comparesVendors=/(?:整理|收录|监测|比较|对比)\s*(?:\d+\s*(?:个|家)?|多家|各家)\s*(?:[^。！？]{0,24})(?:品牌|商家|服务商|供应商)|(?:compare|track|monitor)\b.{0,70}\b(?:across|between)\b.{0,32}\b(?:providers|vendors|merchants)\b/i;
const comparisonHeading=/\d+\s*(?:家|个)?\s*品牌(?:套餐|价格|资料)|(?:price|plan) (?:comparison|directory)/i;
const suspended=/^(?:account suspended|website suspended|this website has been suspended|网站暂停|站点已停用|网站已关闭|default (?:web ?site|server) page)$/i;
const instructions=/^(?:教程|指南|帮助中心|使用教程|文档|documentation|docs|blog|home|login|register|dashboard|welcome|new api|one api|购买|商品列表|自动发卡|llm api|api 中转站)$/i;
const processor=new Set(["stripe.com","paypal.com","paddle.com","lemonsqueezy.com","2checkout.com"]);

function visible(fragment:string) {
  return cleanTitle(fragment.replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi," ").replace(/<[^>]+>/g," ")
    // Strip embedded control characters from public page text before it enters the review ledger.
    // eslint-disable-next-line no-control-regex
    .replace(/&(?:nbsp|amp|quot|lt|gt);/gi," ").replace(/[\u0000-\u001f\u007f]/g," "));
}

export const publicMerchantText=(page:LeadPage)=>visible(page.body).slice(0,5600);

function sameSiteLinks(page:LeadPage) {
  const domain=websiteUrl(page.url).registrable;
  const result:{url:string;path:string;label:string}[]=[];
  for (const [,href,label] of page.body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'<>]{1,1200})["'][^>]*>([\s\S]{0,400}?)<\/a>/gi)) {
    try {
      const link=websiteUrl(new URL(href.replace(/&amp;/g,"&"),page.url).href);
      if (link.registrable!==domain) continue;
      const url=new URL(link.url);
      url.search="";
      result.push({url:url.href,path:url.pathname,label:visible(label).slice(0,80)});
    } catch { /* The ordinary lead URL guard excludes local and malformed links. */ }
    if (result.length>=180) break;
  }
  return result;
}

export function preferredLeadDetail(path:string) {
  if (editorialPath.test(path)) return 0;
  if (commercialPath.test(path)) return 5;
  if (evidencePath.test(path)) return 3;
  if (/^\/(?:zh(?:-[a-z]+)?|cn|en)(?:\.html|\/)?$/i.test(path)) return 2;
  return path==="/"?0:1;
}

const branded=(value:string)=>value.length>=2&&value.length<=56&&!instructions.test(value)&&!directoryWords.test(value)&&!/^\d+\s*(?:USD|CNY|元)$|[?？]|^最(?:新|好|全|便宜)/i.test(value);

export function assessLeadPage(pipeline:Pipeline,page:LeadPage):PageAssessment {
  const metadata=parseMerchantMetadata(page.body);
  const title=visible(metadata.title).slice(0,150);
  const description=visible(metadata.description).slice(0,300);
  const base={title,description};
  if (!/html|xhtml/i.test(page.contentType)) return {...base,outcome:"insufficient",reason:"公开地址返回非 HTML 文档，未证明商家服务"};
  const url=new URL(page.url);
  if (accountPath.test(url.pathname)) return {...base,outcome:"restricted",reason:"公开入口转到登录或账户页面，未读取需登录内容"};
  const canonical=[...page.body.matchAll(/<link\b[^>]{1,1200}>/gi)].find(match=>/\brel\s*=\s*["']canonical["']/i.test(match[0]))?.[0]
    .match(/\bhref\s*=\s*["']([^"']{1,1100})["']/i)?.[1];
  if (canonical) {
    try {
      const destination=websiteUrl(new URL(canonical,url).href).registrable;
      if (destination!==websiteUrl(url.href).registrable) return {...base,outcome:"redirect",reason:`规范网址指向 ${destination}，尚不能确认同一主体`,destination};
    } catch { /* Invalid canonical metadata has no evidentiary value. */ }
  }
  const heading=visible(/<h1\b[^>]*>([\s\S]{0,800}?)<\/h1>/i.exec(page.body)?.[1]??"").slice(0,180);
  const text=visible(page.body).slice(0,9_000);
  const navigations=sameSiteLinks(page);
  const ownOffers=navigations.filter(link=>!editorialPath.test(link.path)&&(commercialPath.test(link.path)||commerceLabel.test(link.label)));
  const ownAccount=navigations.some(link=>accountPath.test(link.path)||loginLabel.test(link.label));
  const detail=navigations.filter(link=>preferredLeadDetail(link.path)>=3&&link.url!==page.url).sort((a,b)=>preferredLeadDetail(b.path)-preferredLeadDetail(a.path)).find(link=>{
    try { return !!merchantSearchLead(link.url).target; } catch { return false; }
  })?.url;
  if (park.test(`${title} ${heading}`.trim())||park.test(text.slice(0,230))) return {...base,outcome:"non_merchant",reason:"可公开读取的页面是域名停放或出售页面"};
  if (suspended.test(title||heading)) return {...base,outcome:"insufficient",reason:"服务器返回暂停或默认页面，当前无法确认经营主体"};
  const caption=`${title} ${description} ${heading}`;
  const headingDirectory=directoryWords.test(`${title} ${heading}`)||comparisonHeading.test(`${title} ${heading}`);
  const thirdParty=externalSalesLink(page.body,page.url);
  if (noSales.test(caption)||(!ownOffers.length&&headingDirectory&&noSales.test(text))) {
    return {...base,outcome:"non_merchant",reason:"页面明确说明仅作导航、比较或展示，未经营所列服务"};
  }
  if (headingDirectory&&comparesVendors.test(caption)) {
    return {...base,outcome:"insufficient",reason:"该页整理多个商家资料，须另行取得该域的自营证据"};
  }
  const contentOnly=editorialPath.test(url.pathname)||headingDirectory;
  if (thirdParty&&!processor.has(thirdParty)&&(!ownOffers.length||contentOnly)) {
    return {...base,outcome:"redirect",reason:"页面的购买或官网入口指向其他注册域，归属需单独确认",destination:thirdParty,detail};
  }
  const sourceName=visible(metadata.siteName??"");
  const domainLabel=merchantNameKey(websiteUrl(url.href).registrable.split(".")[0]);
  const titleParts=title.split(/\s+[|–—-]\s+|[｜·]/).map(part=>part.trim());
  const matchingPart=titleParts.find(part=>branded(part)&&domainLabel.length>=3&&merchantNameKey(part).includes(domainLabel));
  const name=branded(sourceName)?sourceName:matchingPart;
  const proof=contentOnly?null:merchantProof(pipeline,page);
  if (proof && branded(proof.name) && (!thirdParty||processor.has(thirdParty))) {
    return {...base,outcome:"merchant",reason:"同域公开页具备品牌、产品和服务经营证据",name:proof.name,category:proof.category,official:true,detail};
  }

  const publicContext=`${description} ${heading} ${text.slice(0,2_600)}`;
  const kinds=[...new Set([pipeline,"ai-retail","ai-relay","connections","vps","payments"] as Pipeline[])];
  for (const kind of kinds) {
    const signal=assessMerchant(kind,{title,description:publicContext,siteName:name,language:metadata.language});
    if (!signal.accepted) continue;
    if (name&&!contentOnly&&(ownOffers.length>0||(ownAccount&&detail))) {
      return {...base,outcome:"possible",reason:"同域页面提供具体服务和自营入口，待复核品牌及服务范围",name,category:signal.category,detail};
    }
    if (detail||name) return {...base,outcome:"possible",reason:"公开页提到目标服务，商家身份或自营证据不足",name,category:signal.category,detail};
  }
  if (url.pathname==="/"&&headingDirectory&&!ownOffers.length&&navigations.filter(link=>editorialPath.test(link.path)).length>=3) {
    return {...base,outcome:"non_merchant",reason:"主页和站内栏目均为资讯、比较或导航，未发现该站经营所列服务"};
  }
  return {...base,outcome:"insufficient",reason:"公开页面未能证明该域是相应服务的经营主体",detail};
}

const demoPage=/^(?:welcome to nginx[!.]?|it works[!.]?|hello world[!.]?|index of \/.*|test(?:ing)? (?:site|page|store)|(?:sample|demo) (?:site|store|website)|测试(?:页面|网站|店铺|商城|站点)|演示(?:站点|网站|商城|店铺))$/i;
const documentationOnly=/\/(?:terms|tos|legal|privacy|polic(?:y|ies)|refunds?|agreement|support|help|faq)(?:[/.-]|$)/i;
const showcase=/(?:测评|评测|比价|排行榜|导航|机场推荐|(?:购买|购前|选购|服务|使用|充值|开通|入门)指南|教程|推广网站|个人博客|笔记|资讯平台|资源分享|知识库|工具箱|价格查询|affiliate|price comparison|comparison site|directory|buyer.s guide|review site|tutorial)/i;
const guideOnly=/^(?:(?:购前|选购|开通|激活|使用|配置|上手|接入|安装|下载|订阅)?(?:指南|教程)|文章|心得|常见问题|帮助中心|博客|guide|tutorial|blog|faq)$/i;
const aiBrand=/Chat\s*GPT|\bGPT(?:[- ]?(?:Plus|Pro|Go))?\b|Claude|Gemini|Grok|Codex|Cursor|Perplexity|Windsurf|Copilot|Suno|Notion\s+AI|Google\s+AI|Midjourney|AI\s*(?:会员|订阅|权益|卡密)/i;
const retailOffer=/(?:会员|订阅|账号|成品号|独享号|席位|卡密|礼品卡|数字权益|monthly plan|gift cards?).{0,20}(?:代充|购买|续费|充值|自动发货|交付)|代充|卡密商城|卡密发货|发卡商城|卡密自助|在售商品|购物车|自助下单|自助充值|会员充值|订阅商城|购买(?:[^\s]{0,16})会员|add to cart|buy(?:.{0,20})subscription|selling(?:.{0,30})(?:account|gift card)/i;
const retailCard=/卡网|卡密|发卡|成品号|独享(?:号|账号)|礼品卡|共享(?:账号|席位)|gift card/i;
const airportProduct=/节点.{0,8}(?:订阅|套餐|流量)|订阅.{0,8}(?:节点|流量|套餐)|机场(?:订阅|套餐|服务)|(?:Clash|Shadowrocket|Mihomo|V2Ray|Hysteria).{0,32}(?:订阅|套餐)|(?:subscription|monthly data).{0,30}(?:proxy|clash|traffic)/i;
const vpnProduct=/\bVPN\b|虚拟专用网络|网络加速器|回国加速器/i;
const gatewayProduct=/(?:API|接口).{0,12}(?:中转|聚合|网关|统一接入|按量)|(?:中转|统一|聚合|兼容).{0,14}(?:API|接口)|(?:AI|LLM|model|OpenAI.compatible).{0,20}(?:API|gateway|routing|router)|multi.model.{0,28}(?:API|gateway)/i;
const plans=/套餐|流量包|月付|季付|年付|试用方案|免费试用|用量计费|模型目录|模型广场|计费规则|subscription|pricing|monthly|pricing plans?|choose.{0,10}plan|pay.as.you.go/i;
const activeOffer=/本店|本站(?:提供|销售|支持|经营|开通|接入)|提供.{0,40}(?:会员|代充|订阅|加速|节点|API)|自营|下单后|在售|立即(?:购买|下单|订阅|开通)|查看(?:套餐|商品)|购买(?:会员|套餐|订阅)|充值成功|开始(?:使用|试用)|get started|start (?:free|trial)|we (?:sell|offer|provide)|our (?:store|VPN|plans|gateway|subscription)|purchase|buy now|add to cart/i;

export function preferredBasicDetail(path:string) {
  if (documentationOnly.test(path)||editorialPath.test(path)||accountPath.test(path)) return 0;
  if (/\/(?:catalog|goods|items?|offers?|packages?|prods?|buy)(?:[/.-]|$)/i.test(path)) return 5;
  return preferredLeadDetail(path);
}

export function assessBasicAdmission(pipeline:Pipeline,page:LeadPage):PageAssessment {
  const legacy=assessLeadPage(pipeline,page);
  const {title,description,detail}=legacy;
  const base={title,description};
  const url=new URL(page.url);
  if (page.status<200||page.status>=300||!/(?:html|xhtml)/i.test(page.contentType)) {
    return {...base,outcome:"insufficient",reason:"没有取得可读的公开服务页面。"};
  }
  if (legacy.outcome==="restricted"||legacy.outcome==="non_merchant"||
      (legacy.outcome==="redirect"&&legacy.reason.startsWith("规范网址指向"))) return legacy;
  const headings=[...page.body.matchAll(/<h[1-4]\b[^>]*>([\s\S]{0,480}?)<\/h[1-4]>/gi)].slice(0,28).map(match=>visible(match[1]));
  if (demoPage.test(title)||headings.some(heading=>demoPage.test(heading))) {
    return {...base,outcome:"non_merchant",reason:"公开页面表明这是测试、演示或默认站点。"};
  }
  const caption=[title,description,...headings].join(" ").slice(0,2600);
  const body=visible(page.body).slice(0,7800);
  const links=sameSiteLinks(page);
  const productLink=links.find(link=>preferredBasicDetail(link.path)>=5&&link.url!==url.href);
  const next=productLink?.url??(detail&&preferredBasicDetail(new URL(detail).pathname)>=2?detail:undefined);
  const shelf=links.some(link=>aiBrand.test(link.label)&&retailOffer.test(link.label)&&
    /\/(?:products?|goods|items?|store|shop|catalog)\/[^/]{2,}/i.test(link.path)&&!editorialPath.test(link.path)&&!showcase.test(link.label));
  const hasAction=activeOffer.test(caption+" "+body)||links.some(link=>activeOffer.test(link.label)&&!editorialPath.test(link.path));
  const isGuide=showcase.test(title)||editorialPath.test(url.pathname)||guideOnly.test(headings[0]??"");
  const comparesOtherProviders=(comparesVendors.test(caption)||/仅.{0,8}(?:分享|推荐|汇总|评测)|优惠码.{0,15}(?:汇总|比价)|整理.{0,20}(?:官网入口|比较)|转发|参与推广|仅供参考|第三方服务边界/i.test(caption))
    && (showcase.test(title)||legacy.outcome==="redirect");
  if (comparesOtherProviders) return {...base,outcome:"non_merchant",reason:"页面是对其他商家的推广、比较或资料整理。"};
  if (documentationOnly.test(url.pathname)||isGuide&&!shelf) {
    return {...base,outcome:"insufficient",reason:"当前页面是教程或帮助内容，待取得公开商品或服务页。",detail:next};
  }
  const content=caption+" "+body;
  const ownedOffer=hasAction||!!productLink||legacy.outcome==="merchant";
  const renderedStore=/购物|商品|店铺|商城|checkout|store|shop/i.test(title)&&!showcase.test(title)&&
    [/\bChatGPT\b/i,/\bClaude\b/i,/\bGemini\b/i,/\bGrok\b/i].filter(pattern=>pattern.test(body)).length>=2;
  const modelAccess=gatewayProduct.test(caption)&&/\bAPI\b|模型接口|模型网关/.test(content)&&
    ((ownedOffer&&plans.test(content))||legacy.category==="ai-relay");
  const membership=/会员代充|订阅代充|卡密|礼品卡|成品号|共享席位|(?:ChatGPT|Claude|Gemini|Grok).{0,15}会员/i.test(caption);
  let category:string|undefined;
  let basis:PageAssessment["basis"];
  if (modelAccess&&!membership) {
    category="ai-relay";
    basis="gateway";
  } else if ((aiBrand.test(caption)||shelf||renderedStore)&&retailOffer.test(content)&&ownedOffer&&
      (retailOffer.test(caption)||shelf||legacy.category==="ai-topup"||legacy.category==="ai-card")) {
    category=/代充|代充值|人工.{0,5}充值/.test(caption)&&!/(?:卡密|账号)(?:商城|分类|发货|中心)/.test(title)
      ?"ai-topup":retailCard.test(content)?"ai-card":"ai-topup";
    basis="retail";
  } else if ((airportProduct.test(caption)||vpnProduct.test(caption))&&plans.test(content)&&
      (ownedOffer||plans.test(caption))) {
    const standardClients=/(?:Clash|Shadowrocket|Mihomo|V2Ray|Hysteria|机场)/i.test(caption);
    category=airportProduct.test(caption)&&(standardClients||!/VPN|网络加速器/i.test(title))&&!/(?:回国|游戏)加速器/.test(title)?"airport":"vpn";
    basis="subscription";
  } else if (modelAccess) {
    category="ai-relay";
    basis="gateway";
  }
  if (!category||!basis) {
    return {...base,outcome:"insufficient",reason:"公开页面可读，现有内容尚未展示明确的目标商品、服务或套餐。",detail:next};
  }
  const meta=parseMerchantMetadata(page.body);
  const label=[meta.siteName,...title.split(/\s+[|-]\s+|\s*[—–]{1,2}\s*|[｜·]/).reverse(),legacy.name].map(part=>visible(part??""))
    .find(part=>branded(part)&&part.length<=40&&!guideOnly.test(part)&&!showcase.test(part)&&
      !/^(?:购物|商店|商城|商品广场|网站首页)$|官方|购买|试用|套餐|教程|账号安全|自助下单|会员续费|月付|全球节点/i.test(part));
  const name=label||websiteUrl(url.href).registrable;
  const reason={retail:"同域公开页面展示 AI 会员商品或可办理的订阅服务。",subscription:"同域公开页面展示网络订阅服务及对应套餐或入口。",
    gateway:"同域公开页面展示模型 API 接入及其服务产品。",other:"同域公开页面展示目标服务及其套餐或入口。"}[basis];
  return {...base,outcome:"merchant",name,category,basis,reason,detail:next};
}

const buyAction=/^(?:立即|马上|现在|在线|自助)(?:购买|下单|开通|订阅).{0,45}$|^(?:购买|下单|开通|订阅|购买套餐|购买会员|购买订阅|添加至购物车|加入购物车|开通使用|免费试用|开始试用|开始使用)(?:[！!→↗\s].*)?$|^(?:buy(?: now)?|subscribe(?: now)?|add to cart|order now|start (?:a )?trial|get started)(?:[!→↗\s].*)?$/i;
const productDetail=/\/(?:products?|goods|items?|store|shop|catalog|buy|merchandise)\/[^/.][^/]+/i;
const actualPlan=/(?:基础|入门|标准|进阶|专业|旗舰|轻量|商务|体验|试用|月付|年付|月度|年度|流量包).{0,10}(?:版|档|套餐|订阅|方案|会员)|(?:\d+(?:\.\d+)?)\s*(?:Gi?B|Ti?B|GB|TB)\b|(?:starter|standard|premium|unlimited|monthly|yearly|business|enterprise)\s+(?:plan|subscription)|[$¥￥€]\s*\d|\d+(?:\.\d+)?\s*(?:元|USD|CNY|EUR|USDT)\s*(?:[/／]|每|monthly|起)/i;
const sourceOnly=/仅作为|仅供学习|只做资讯|不提供.{0,14}(?:代充|节点|交易|订阅|接口)|(?:教程|指南|资料|导购|评测|收录).{0,30}(?:自媒体|第三方站|其他商家|各家)|compare.{0,40}(?:providers|companies|other websites)|聚合.{0,20}(?:推荐|公开报价)|汇总.{0,20}(?:官网|公开报价|套餐|优惠)/i;
const editorialTitle=/指南|评测|测评|实测|横评|博客|笔记|排行|比价|对比|导航|百科|开源项目|配置教程|资料库|目录雷达|directory|articl(?:es|e)|\bblog\b|comparison|benchmark/i;
const developerProject=/开源.{0,20}(?:自部署|自建|本地部署|客户端|源码)|self.hosted.{0,24}(?:gateway|router|directory)|(?:免费)?(?:节点|配置).{0,15}(?:分享|收集|转换)|仅提供.{0,20}(?:配置|软件下载|客户端)/i;
const directOffer=/本(?:店|站|平台)(?:为您)?(?:经营|提供|销售|推出)|我们(?:提供|销售|运营)|由本站.{0,10}(?:提供|交付)|we (?:sell|provide|operate|offer)|our (?:store|catalog|network|gateway|hosting|plans)/i;
const explicitRetail=/代充|卡网|卡密|发卡|成品号|共享席位|会员.{0,10}(?:商品|套餐|充值)|(?:ChatGPT|Claude|Gemini|Grok).{0,18}(?:订阅|会员|充值|代充|卡密|月卡|季卡|年卡)|subscription reseller|buy.{0,24}(?:credits|subscription|gift card)/i;
const foreignMarketplace=new Set(["paypal.com","stripe.com","lemonsqueezy.com","paddle.com","alipay.com","wxpay.com","wechat.com","weixin.qq.com","apps.apple.com","play.google.com"]);
const catalogAggregation=/不卖货|未提供交易|平台仅作展示|中转站汇总|机场推荐汇总|订阅比价|工程向订阅比价|(?:独立|第三方|客观).{0,6}(?:评测|测评)|价格.{0,8}每日雷达|(?:比较|追踪|汇总|整理).{0,24}(?:各家|多家|多个站点).{0,16}(?:报价|套餐|商家)|(?:compare prices|price ranking).{0,55}(?:\d{2,}[,.]?\d*\s+(?:sites|providers)|across (?:multiple |different )?providers)|lorem ipsum|acerbo datus maxime/i;

export function catalogSourceDisposition(title:string,description:string) {
  if (catalogAggregation.test(title+" "+description)) return {outcome:"non_merchant" as const,reason:"公开资料明确为比价、站点汇总、模板或第三方内容。"};
  if (/self.hosted VPN/i.test(title)&&/open.source|deploy|自部署|开源/i.test(description)) {
    return {outcome:"non_merchant" as const,reason:"页面展示自行部署的 VPN 软件，未见商家运营的 VPN 服务。"};
  }
  if (/免费.{0,18}节点(?:订阅|分享)|clash tun/i.test(title)&&/每日更新.{0,18}(?:免费)?节点|(?:分享|收集).{0,18}(?:免费)?节点/i.test(description)) {
    return {outcome:"non_merchant" as const,reason:"公开内容为免费节点合集与客户端资料，未见自营订阅服务。"};
  }
  if (/分享.{0,22}(?:前沿|行业).{0,14}资讯.{0,16}(?:技巧|指南)/.test(description)&&!directOffer.test(description)) {
    return {outcome:"insufficient" as const,reason:"公开简介仅提供资讯或使用技巧，缺少可归为该站自营的服务证据。"};
  }
  if (/coming soon|under construction|即将上线|尚未开放|正在建设/i.test(title)) {
    return {outcome:"insufficient" as const,reason:"页面标注正在建设或尚未开放，未见当前可用服务。"};
  }
}

function catalogLinks(page:LeadPage) {
  const links:{url:string;own:boolean;label:string;path:string}[]=[];
  const root=websiteUrl(page.url).registrable;
  for (const [,href,body] of page.body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'<>]{1,1000})["'][^>]*>([\s\S]{0,450}?)<\/a>/gi)) {
    try {
      const url=new URL(href.replace(/&amp;/g,"&"),page.url);
      const target=websiteUrl(url.href);
      url.search="";url.hash="";
      links.push({url:url.href,own:target.registrable===root,label:visible(body).slice(0,130),path:url.pathname});
    } catch { /* Non-web and protected link values are not evidence. */ }
    if (links.length>=240) break;
  }
  return links;
}

export function assessAutomatedAdmission(pipeline:Pipeline,page:LeadPage):PageAssessment {
  const basic=assessBasicAdmission(pipeline,page);
  if (["non_merchant","redirect","restricted"].includes(basic.outcome)||!/html|xhtml/i.test(page.contentType)||
    page.status<200||page.status>=300) return basic;
  const disposition=catalogSourceDisposition(basic.title,basic.description);
  if (disposition) return {...basic,...disposition,basis:undefined};
  const url=new URL(page.url);
  const headings=[...page.body.matchAll(/<h[1-5]\b[^>]*>([\s\S]{0,400}?)<\/h[1-5]>/gi)].slice(0,28).map(item=>visible(item[1]));
  const buttons=[...page.body.matchAll(/<button\b[^>]*>([\s\S]{0,300}?)<\/button>/gi)].slice(0,44).map(item=>visible(item[1]));
  const main=visible(page.body.slice(0,150_000)).slice(0,6500);
  const caption=[basic.title,basic.description,...headings].join(" ").slice(0,3200);
  const headingsText=headings.join(" ");
  const links=catalogLinks(page);
  const products=links.filter(link=>link.own&&productDetail.test(link.path)&&!editorialPath.test(link.path)&&!editorialTitle.test(link.label));
  const productShelf=products.some(link=>aiBrand.test(link.label)&&explicitRetail.test(link.label));
  const commercialControls=buttons.some(label=>buyAction.test(label))||links.some(link=>buyAction.test(link.label));
  const scheduledPlan=actualPlan.test(headingsText)||actualPlan.test(main);
  const publicSale=directOffer.test(caption+" "+main.slice(0,1600))||commercialControls;
  const affiliate=links.filter(link=>!link.own&&buyAction.test(link.label)&&!foreignMarketplace.has(websiteUrl(link.url).registrable));
  const distinctCheckout=new Set(affiliate.map(link=>link.url));
  const checkout=distinctCheckout.size===1?[...distinctCheckout][0]:undefined;
  const docs=editorialPath.test(url.pathname)||documentationOnly.test(url.pathname)||/^blog\./i.test(url.hostname)&&!productDetail.test(url.pathname);
  const editorial=editorialTitle.test([basic.title,headings[0]].join(" "));
  const firstParty=directOffer.test(caption+" "+main.slice(0,1300));
  if ((editorial||affiliate.length>0)&&sourceOnly.test(caption)) {
    return {...basic,outcome:"non_merchant",basis:undefined,reason:"公开页面定位为资料、比较或其他商家的介绍。"};
  }
  if ((docs||editorial)&&!productShelf&&(!productDetail.test(url.pathname)||!firstParty||!commercialControls)) {
    return {...basic,outcome:"insufficient",basis:undefined,reason:"当前页面是资讯、教程或文档，尚未取得可收录的商品或服务入口。"};
  }
  if (developerProject.test(caption)&&!commercialControls&&!productShelf) {
    return {...basic,outcome:"non_merchant",basis:undefined,reason:"公开页面提供自建软件、配置或资源分享，缺少经营服务。"};
  }
  const structured=merchantProof(pipeline,page);
  const actionable=scheduledPlan||commercialControls||publicSale&&products.length>0;
  let category:string|undefined;
  let basis=basic.basis;
  if (productShelf||(basis==="retail"||!basis&&publicSale)&&actionable&&aiBrand.test(caption)&&explicitRetail.test(caption)) {
    category=basis==="retail"?basic.category:retailCard.test(caption)?"ai-card":"ai-topup";
    basis="retail";
  } else if (basis==="subscription"&&(scheduledPlan&&(publicSale||actualPlan.test(headingsText)||!!structured)||commercialControls&&plans.test(caption))) {
    category=basic.category;
  } else if (basis==="gateway"&&(actionable||products.length>0||!!structured||/\b(?:API Reference|Model Catalog)\b|模型目录|在线接入/.test(headingsText))) {
    category="ai-relay";
  } else if (structured&&["vps","virtual-card","u-card","payment-accounts","subscription-payment","proxy-services","residential"].includes(structured.category)&&
      (scheduledPlan||commercialControls||products.length>0)) {
    category=structured.category;
    basis="other";
  }
  if (!category||!basis) {
    return {...basic,outcome:"insufficient",basis:undefined,reason:"公开页面可访问，尚未取得目标商品、套餐或可用服务的直接证据。"};
  }
  const root=websiteUrl(url.href).registrable;
  const name=basic.name&&basic.name.length<=45&&!editorialTitle.test(basic.name)?basic.name:
    structured?.name&&structured.name.length<=45?structured.name:root;
  return {...basic,outcome:"merchant",name,category,basis,checkout,
    reason:"同注册域公开页面可访问，已识别实际商品、套餐或服务入口。"};
}
