import { getSiteLanguage, getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { Cpu, Plane, Wallet } from "lucide-react";
import { canonicalAiTier,orderAiTiers } from "@/lib/directory/ai-subscription-tier";
import { codexVerificationProduct } from "@/lib/directory/ai-product";
import { aiPriceDeliveryLabels,featuredAiProducts,priceCategories,publicPriceBoard,type AiPriceDelivery,type PricedInCny } from "@/lib/directory/price-board";
import { directoryRefreshStatus } from "@/lib/directory/refresh-state";
import { groupRelayModels, relayModelKey, relayVersionLabel } from "@/lib/directory/relay-models";
import { isRelayTokenPeriod,relayTokenPeriods } from "@/lib/directory/relay-quote-units";
import { siteHref } from "@/lib/directory/types";
import { External,day,priceLabel,quoteDetailLabel } from "./display";
import { param,type Params } from "./catalog-page";
import { AiProductIcon } from "./ai-product-icon";
import { MerchantAvatar } from "./merchant-avatar";
import { OfferIcon } from "./offer-icon";
import { visiblePriorityCategoryTabs } from "./priority-category-tabs";
import type { ContentVisibility } from "@/lib/geo/visibility";

const yuan=new Intl.NumberFormat("zh-CN",{style:"currency",currency:"CNY"});
const rateYuan=new Intl.NumberFormat("zh-CN",{style:"currency",currency:"CNY",maximumFractionDigits:4});
const updateTimeOptions = { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" } satisfies Intl.DateTimeFormatOptions;

export async function HomePrices({input,visibility}:{input:Params;visibility:ContentVisibility}) {
  const t = await getTranslations();
  const localUpdate = new Intl.DateTimeFormat(await getSiteLanguage(), updateTimeOptions);
  const generalTabs=visiblePriorityCategoryTabs(visibility);
  const networkTabs=(["airport","vpn"] as const).filter(category=>visibility.categoryAllowed(category));
  const networkDefault=networkTabs[0];
  const networkTabIndex=generalTabs.findLastIndex(tab=>tab.key==="ai"||tab.key==="ai-relay")+1;
  const tabs=networkDefault?[
    ...generalTabs.slice(0,networkTabIndex),
    {key:networkDefault,item:{label:"机场与 VPN"},Icon:Plane},
    ...generalTabs.slice(networkTabIndex),
  ]:generalTabs;
  if (!tabs.length) return null;
  const view=param(input.price);
  const active=networkTabs.find(key=>key===view)??(tabs.find(tab=>tab.key===view)??tabs[0]).key;
  const network=active==="airport"||active==="vpn";
  const {groups}=publicPriceBoard(undefined,undefined,false,visibility);
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
  const aiSubscription=active==="ai"&&!verification;
  const requestedDelivery=param(input.delivery);
  const deliveryFilter=aiSubscription&&Object.hasOwn(aiPriceDeliveryLabels,requestedDelivery)
    ?requestedDelivery as AiPriceDelivery:undefined;
  const periodGroups=plans.filter(item=>item.period===period);
  const deliveries=(Object.keys(aiPriceDeliveryLabels) as AiPriceDelivery[])
    .filter(kind=>kind===deliveryFilter||periodGroups.some(item=>item.delivery===kind));
  const delivery=deliveryFilter??deliveries.find(kind=>periodGroups.some(item=>item.delivery===kind&&item.quotes.length))??deliveries[0];
  const group=aiSubscription?periodGroups.find(item=>item.delivery===delivery):visible.find(item=>item.key===param(input.range))??visible[0];
  const deliveryParams:Record<string,string>=deliveryFilter?{delivery:deliveryFilter}:{};
  const aiScope=tier?[`${t(product)} ${tier}`, t(`${period}付`), delivery && t(aiPriceDeliveryLabels[delivery])].filter(Boolean).join(" · ") : t("{product} AI 订阅", { product: t(product) });
  const {completed}=directoryRefreshStatus();
  const updatedAt=completed?.finishedAt;
  const list=group?.quotes??[];
  const low=list[0], high=list.at(-1);
  function url(category:string,filters:Record<string,string>={}) {
    const params=new URLSearchParams({price:category,...filters});
    return `/?${params}#home-prices`;
  }

  return <section id="home-prices" className="home-prices" aria-labelledby="price-title">
    <div className="directory-section"><h2 id="price-title">{t("公开报价区间")}<span className="price-unit">{t("人民币")}</span></h2></div>
    <p className="section-note">{verification?t("以下为明确标注单次计价的公开报价。"):active==="ai"?t("同一产品、等级和周期内，按交付方式计算报价区间。店铺标价采用近期原页核对或第三方有货观测。"):relay?t("按同一模型分别查看输入和输出单价。缓存、渠道及附加费请看商家的原始价目。"):t("金额按公开价目记录。")}</p>
    <nav className="filter-pills price-tabs" aria-label={t("报价分类")}>{tabs.map(({key,item:{label},Icon})=><Link key={key}
      href={url(key)} scroll={false} aria-current={key===active||(network&&key===networkDefault)?"page":undefined}>
      <Icon size={16} aria-hidden="true"/>{t(label)}
    </Link>)}</nav>
    {network&&networkTabs.length>1&&<nav className="filter-pills price-tabs" aria-label={t("机场与 VPN 子类")}>{networkTabs.map(key=><Link key={key}
      href={url(key)} scroll={false} aria-current={key===active?"page":undefined}>{t(priceCategories[key])}</Link>)}
    </nav>}
    {!!relayBrands.length&&<>
      <nav className="filter-pills price-tabs ai-product-tabs" aria-label={t("中转品牌")}>{relayBrands.map(({brand,versions})=><Link key={brand}
        href={url(active,{model:versions.includes(relayModel)?relayModel:versions[0]})} scroll={false} aria-current={brand===activeRelayBrand?.brand?"page":undefined}>
        {brand==="其他模型"?<Cpu className="ai-product-icon" size={16} aria-hidden="true"/>:<AiProductIcon product={brand}/>} {t(brand)}
      </Link>)}
        {otherRelayRates&&<Link href={url(active,{model:"other"})} scroll={false} aria-current={relayModel==="other"?"page":undefined}>
          <Wallet className="ai-product-icon" size={16} aria-hidden="true"/>{t("月费与充值")}
        </Link>}
      </nav>
      {activeRelayBrand&&<nav className="filter-pills price-tabs" aria-label={t("中转模型")}>
        <span className="price-filter-label">{t("模型版本")}</span>
        {activeRelayBrand.versions.map(name=><Link key={name} href={url(active,{model:name})} scroll={false} aria-current={name===relayModel?"page":undefined}>
          {t(relayVersionLabel(name,activeRelayBrand.brand))}
        </Link>)}
      </nav>}
    </>}
    {active==="ai"?<>
      <nav className="filter-pills price-tabs ai-product-tabs" aria-label={t("AI 产品")}>{brands.map(name=><Link key={name} href={url(active,{product:name,...(name!==codexVerificationProduct?deliveryParams:{})})} scroll={false} aria-current={name===product?"page":undefined}>
        <AiProductIcon product={name}/>{t(name)}
      </Link>)}</nav>
      {!!tiers.length&&<>
        <nav className="filter-pills price-tabs" aria-label={t("订阅等级")}><span className="price-filter-label">{t("订阅等级")}</span>{tiers.map(name=><Link key={name} href={url(active,{product,tier:name,...(billingFilter?{billing:billingFilter}:{}),...deliveryParams})} scroll={false} aria-current={name===tier?"page":undefined}>{t(name)}</Link>)}</nav>
        <nav className="filter-pills price-tabs" aria-label={t("订阅周期")}><span className="price-filter-label">{t("订阅周期")}</span>{[["month","月付"],["year","年付"]].map(([key,label])=><Link key={key} href={url(active,{product,tier,billing:key,...deliveryParams})} scroll={false} aria-current={key===billing?"page":undefined}>{t(label)}</Link>)}</nav>
      </>}
      {aiSubscription&&!!deliveries.length&&<nav className="filter-pills price-tabs" aria-label={t("交付方式")}>
        <span className="price-filter-label">{t("交付方式")}</span>
        {deliveries.map(kind=><Link key={kind} href={url(active,{product,tier,billing,delivery:kind})} scroll={false} prefetch={false}
          aria-current={kind===delivery?"page":undefined}>{t(aiPriceDeliveryLabels[kind])}</Link>)}
      </nav>}
    </>:visible.length>1&&<nav className="filter-pills price-tabs" aria-label={relay&&relayModel!=="other"?t("Token 计费方向"):t("计费周期与地区")}>{visible.map(item=><Link key={item.key}
      href={url(active,{range:item.key,...(relay&&{model:relayModel})})} scroll={false} aria-current={group?.key===item.key?"page":undefined}>
      {relay&&relayModel!=="other"?t(item.period):
        [item.subcategory, quoteDetailLabel(item.period), quoteDetailLabel(item.region)].filter(Boolean).map(label => t(label!)).join(" · ")||t("其他报价")}
    </Link>)}</nav>}
    {group&&low&&high?<>
      <div className="price-pair">
        <QuoteTile title={list.length===1?t("现有报价"):t("价格最低")} quote={low} showRegion={active==="ai"||network}/>
        {list.length>1&&<QuoteTile title={t("价格最高")} quote={high} showRegion={active==="ai"||network}/>}
      </div>
      {list.length===1&&<p className="section-note">{t("目前只有一项报价可比。")}</p>}
    </>:<p className="plain-empty boxed-empty">{group?.unconfirmedStorefronts
      ? t("{scope} 暂无近期确认在售的报价。", { scope: verification ? t(codexVerificationProduct) : aiScope })
      : verification ? t("{product}暂无明确单次标价。", { product: t(codexVerificationProduct) })
      : active === "ai" ? t("{scope} 暂无可比报价。", { scope: aiScope })
      : t("{category}暂无可比的公开报价。", { category: t(priceCategories[active]) })}</p>}
    <p className="section-note price-updated">{t("每 5 小时更新一次")}{updatedAt&&<>{" "}{t("· 最近更新")}{" "}<time dateTime={updatedAt}>{localUpdate.format(new Date(updatedAt))}</time></>}</p>
  </section>;
}

async function QuoteTile({title,quote,showRegion}:{title:string;quote:PricedInCny;showRegion:boolean}) {
  const t = await getTranslations();
  const localUpdate = new Intl.DateTimeFormat(await getSiteLanguage(), updateTimeOptions);
  const site={slug:quote.site_slug,category_slug:quote.category_slug,avatar_digest:quote.avatar_digest};
  const foreign=quote.currency!=="CNY";
  const billing=[foreign?priceLabel(quote):"",foreign||showRegion?t(quoteDetailLabel(quote.period)):""].filter(Boolean).join(" / ");
  const context=[billing,showRegion?t(quoteDetailLabel(quote.region)):"",
    quote.feed_observed_at?t("有货观测 {date}", { date: localUpdate.format(new Date(quote.feed_observed_at)) }):
      quote.stock_checked_at?t("在售核对 {date}", { date: localUpdate.format(new Date(quote.stock_checked_at)) }):day(quote.recorded_at)].filter(Boolean).join(" · ");
  const amount = isRelayTokenPeriod(quote.period) ? rateYuan.format(quote.cny_amount) : yuan.format(quote.cny_minor / 100);
  return <article className="quote-tile">
    <h3>{title}</h3>
    <p className="quote-amount">{foreign && quote.cny_amount !== 0 ? t("约 {price}", { price: amount }) : amount}</p>
    <p className="quote-offer">
      <Link href={`${siteHref(site.slug)}#prices`} className="quote-offer-label"><MerchantAvatar site={site} size={20}/><span>{quote.site_name}</span></Link>
      <span className="quote-offer-label"><OfferIcon price={quote} site={site}/><span>{quote.plan}</span></span>
    </p>
    <p className="section-note">{context} · <External href={quote.source_url}>{quote.feed_observed_at?t("第三方观测来源"):t("报价来源")}</External>{quote.reported_item_url&&<> · <External href={quote.reported_item_url}>{t("原商品页")}</External></>}</p>
  </article>;
}
