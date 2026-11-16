import Link from "next/link";
import { Cpu, Wallet } from "lucide-react";
import { exchangeRateReference } from "@/lib/directory/exchange-rates";
import { canonicalAiTier,orderAiTiers } from "@/lib/directory/ai-subscription-tier";
import { codexVerificationProduct } from "@/lib/directory/ai-product";
import { featuredAiProducts,priceCategories,publicPriceBoard,type PricedInCny } from "@/lib/directory/price-board";
import { directoryRefreshStatus } from "@/lib/directory/refresh-state";
import { groupRelayModels, relayModelKey, relayVersionLabel } from "@/lib/directory/relay-models";
import { isRelayTokenPeriod,relayTokenPeriods } from "@/lib/directory/relay-quote-units";
import { siteHref } from "@/lib/directory/types";
import { External,day,priceLabel,quoteDetailLabel } from "./display";
import { param,type Params } from "./catalog-page";
import { AiProductIcon } from "./ai-product-icon";
import { priorityCategoryTabs } from "./priority-category-tabs";

const yuan=new Intl.NumberFormat("zh-CN",{style:"currency",currency:"CNY"});
const rateYuan=new Intl.NumberFormat("zh-CN",{style:"currency",currency:"CNY",maximumFractionDigits:4});
const localUpdate=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
const networkTabs=["airport","vpn"] as const;

export function HomePrices({input}:{input:Params}) {
  const view=param(input.price);
  const active=Object.hasOwn(priceCategories,view)?view as keyof typeof priceCategories:"ai";
  const {groups,rateDay,missingExchange}=publicPriceBoard();
  const network=active==="airport"||active==="vpn";
  const brands=[...new Set<string>([...featuredAiProducts,...groups.flatMap(group=>group.product?[group.product]:[]),codexVerificationProduct])];
  const product=brands.includes(param(input.product))?param(input.product):brands[0];
  const verification=active==="ai"&&product===codexVerificationProduct;
  const matches=groups.filter(group=>group.category===active&&(active!=="ai"||group.product===product));
  const relay=active==="ai-relay";
  const relayModels=relay?[...new Set(matches.flatMap(match=>isRelayTokenPeriod(match.period)&&match.subcategory?[match.subcategory]:[]))]:[];
  const otherRelayRates=relay&&matches.some(match=>!isRelayTokenPeriod(match.period));
  const selectedModel=relayModelKey(param(input.model));
  const matchingModel=relayModels.find(model=>relayModelKey(model)===selectedModel);
  const relayModel=selectedModel==="other"&&otherRelayRates?"other":matchingModel??relayModels[0]??"other";
  const relayBrands=groupRelayModels(relayModels);
  const activeRelayBrand=relayBrands.find(({versions})=>versions.includes(relayModel));
  const visible=relay?matches.filter(match=>relayModel==="other"?!isRelayTokenPeriod(match.period):match.subcategory===relayModel)
    .sort((a,b)=>Number(b.period===relayTokenPeriods[0])-Number(a.period===relayTokenPeriods[0])):matches;
  const observedTiers=[...new Set(matches.flatMap(item=>item.tier?[item.tier]:[]))];
  const tiers=orderAiTiers(product,observedTiers);
  const requestedTier=canonicalAiTier(product,param(input.tier));
  const tier=requestedTier&&tiers.includes(requestedTier)?requestedTier:observedTiers[0];
  const plans=matches.filter(item=>item.tier===tier);
  const requestedBilling=param(input.billing);
  const billingFilter=requestedBilling==="month"||requestedBilling==="year"?requestedBilling:undefined;
  const billing=billingFilter??(plans.some(item=>item.period==="月")?"month":"year");
  const period=billing==="month"?"月":"年";
  const group=active==="ai"&&!verification?plans.find(item=>item.period===period):visible.find(item=>item.key===param(input.range))??visible[0];
  const {latest,completed}=directoryRefreshStatus();
  const list=group?.quotes??[];
  const low=list[0], high=list.at(-1);
  const storefrontQuotes=list.filter(quote=>quote.storefront_observed).length;
  const localTime=completed?.finishedAt ? localUpdate.format(new Date(completed.finishedAt)) : null;
  function url(category:string,filters:Record<string,string>={}) {
    const params=new URLSearchParams({price:category,...filters});
    return `/?${params}#home-prices`;
  }

  return <section id="home-prices" className="home-prices" aria-labelledby="price-title">
    <div className="directory-section"><h2 id="price-title">公开报价区间<span className="price-unit">人民币</span></h2></div>
    <p className="section-note">{verification?"以下为明确标注单次计价的公开报价。":active==="ai"?"比较同产品、同等级、同周期的公开标价。交付方式和地区请看报价详情。":relay?"按同一模型分别查看输入和输出单价。缓存、渠道及附加费请看商家的原始价目。":"金额按公开价目记录。"}</p>
    <nav className="filter-pills price-tabs" aria-label="报价分类">{priorityCategoryTabs.map(({key,item:{label},Icon})=><Link key={key}
      href={url(key)} scroll={false} aria-current={(key===active||(key==="airport"&&network))?"page":undefined}>
      <Icon size={16} aria-hidden="true"/>{label}
    </Link>)}</nav>
    {network&&<nav className="filter-pills price-tabs" aria-label="机场与 VPN 子类">{networkTabs.map(key=><Link key={key}
      href={url(key)} scroll={false} aria-current={key===active?"page":undefined}>{priceCategories[key]}</Link>)}</nav>}
    {!!relayBrands.length&&<>
      <nav className="filter-pills price-tabs ai-product-tabs" aria-label="中转品牌">{relayBrands.map(({brand,versions})=><Link key={brand}
        href={url(active,{model:versions.includes(relayModel)?relayModel:versions[0]})} scroll={false} aria-current={brand===activeRelayBrand?.brand?"page":undefined}>
        {brand==="其他模型"?<Cpu className="ai-product-icon" size={16} aria-hidden="true"/>:<AiProductIcon product={brand}/>} {brand}
      </Link>)}
        {otherRelayRates&&<Link href={url(active,{model:"other"})} scroll={false} aria-current={relayModel==="other"?"page":undefined}>
          <Wallet className="ai-product-icon" size={16} aria-hidden="true"/>月费与充值
        </Link>}
      </nav>
      {activeRelayBrand&&<nav className="filter-pills price-tabs" aria-label="中转模型">
        <span className="price-filter-label">模型版本</span>
        {activeRelayBrand.versions.map(name=><Link key={name} href={url(active,{model:name})} scroll={false} aria-current={name===relayModel?"page":undefined}>
          {relayVersionLabel(name,activeRelayBrand.brand)}
        </Link>)}
      </nav>}
    </>}
    {active==="ai"?<>
      <nav className="filter-pills price-tabs ai-product-tabs" aria-label="AI 产品">{brands.map(name=><Link key={name} href={url(active,{product:name})} scroll={false} aria-current={name===product?"page":undefined}>
        <AiProductIcon product={name}/>{name}
      </Link>)}</nav>
      {!!tiers.length&&<>
        <nav className="filter-pills price-tabs" aria-label="订阅等级"><span className="price-filter-label">订阅等级</span>{tiers.map(name=><Link key={name} href={url(active,{product,tier:name,...(billingFilter?{billing:billingFilter}:{})})} scroll={false} aria-current={name===tier?"page":undefined}>{name}</Link>)}</nav>
        <nav className="filter-pills price-tabs" aria-label="订阅周期"><span className="price-filter-label">订阅周期</span>{[["month","月付"],["year","年付"]].map(([key,label])=><Link key={key} href={url(active,{product,tier,billing:key})} scroll={false} aria-current={key===billing?"page":undefined}>{label}</Link>)}</nav>
      </>}
    </>:visible.length>1&&<nav className="filter-pills price-tabs" aria-label={relay&&relayModel!=="other"?"Token 计费方向":"计费周期与地区"}>{visible.map(item=><Link key={item.key}
      href={url(active,{range:item.key,...(relay&&{model:relayModel})})} scroll={false} aria-current={group?.key===item.key?"page":undefined}>
      {relay&&relayModel!=="other"?item.period:
        [item.subcategory,quoteDetailLabel(item.period),quoteDetailLabel(item.region)].filter(Boolean).join(" · ")||"其他报价"}
    </Link>)}</nav>}
    {group&&low&&high?<>
      <p className="section-note price-scope">{verification?`${codexVerificationProduct} · 每次`:group.product?`${group.product} ${group.tier} · ${group.period}付`:
        [relay&&group.subcategory?priceCategories[active]:null,group.subcategory??priceCategories[active],
          quoteDetailLabel(group.period),quoteDetailLabel(group.region)].filter(Boolean).join(" · ")} · {group.quotes.length} 项报价，{group.merchants} 家商家</p>
      {storefrontQuotes>0&&<p className="section-note">含 {storefrontQuotes} 项店铺公开标价。</p>}
      <div className="price-pair">
        <QuoteTile title={list.length===1?"现有报价":"价格最低"} quote={low} showRegion={active==="ai"}/>
        {list.length>1&&<QuoteTile title="价格最高" quote={high} showRegion={active==="ai"}/>}
      </div>
      {list.length===1&&<p className="section-note">目前只有一项报价可比。</p>}
    </>:<p className="plain-empty boxed-empty">{verification?`${codexVerificationProduct}暂无明确单次标价。`:active==="ai"?`${tier?`${product} ${tier} · ${period}付`:`${product} AI 订阅`}暂无可比报价。`:`${priceCategories[active]}暂无可比的公开报价。`}</p>}
    <p className="section-note price-updated">{relay?"模型和套餐报价以各条的记录日期为准。":"每 5 小时核查一轮。"}{!relay&&localTime&&<>{`最近一轮 ${localTime} 完成，核实 ${completed!.quotesChecked} 项报价。`}</>}
      {latest&&!latest.finishedAt&&`正在核查 ${latest.done}/${latest.targets} 个档案或报价来源。`}
      {storefrontQuotes>0&&"店铺标价以各自的观察日期为准。"}
      {rateDay&&<>外币按 <External href={exchangeRateReference}>欧洲央行 {rateDay} 参考汇率</External> 折算。 </>}
      {!!missingExchange&&"缺少参考汇率的外币报价暂未纳入。"}
    </p>
  </section>;
}

function QuoteTile({title,quote,showRegion}:{title:string;quote:PricedInCny;showRegion:boolean}) {
  const foreign=quote.currency!=="CNY";
  const billing=[foreign?priceLabel(quote):"",foreign||showRegion?quoteDetailLabel(quote.period):""].filter(Boolean).join(" / ");
  const context=[billing,showRegion?quoteDetailLabel(quote.region):"",
    `${quote.storefront_observed?"观察日期 ":""}${day(quote.recorded_at)}`].filter(Boolean).join(" · ");
  return <article className="quote-tile">
    <h3>{title}</h3>
    <p className="quote-amount">{quote.currency!=="CNY"&&quote.cny_amount!==0&&"约 "}{isRelayTokenPeriod(quote.period)?rateYuan.format(quote.cny_amount):yuan.format(quote.cny_minor/100)}</p>
    <p><Link href={`${siteHref(quote.site_slug)}#prices`}>{quote.site_name}</Link> · {quote.plan}</p>
    <p className="section-note">{context} · <External href={quote.source_url}>{quote.reported_item_url?"第三方报价快照":"报价来源"}</External>{quote.reported_item_url&&<> · <External href={quote.reported_item_url}>原商品页</External></>}</p>
  </article>;
}
