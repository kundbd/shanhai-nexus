import type { StorefrontObservation } from "./storefront-import";
import { codexVerificationProduct,mentionsCodex } from "./ai-product";

const deliveryLabels: Record<string,string> = {
  subscription_recharge:"代充",card_code:"卡密",finished_account:"成品号",
  semi_finished_account:"半成品账号",trial_account:"试用账号",team_seat:"团队席位",shared_pool:"共享",
};
const periods:Record<string,string> = {
  one_day:"1天",one_week:"1周",fifteen_days:"15天",one_month:"1个月",three_months:"3个月",six_months:"6个月",one_year:"1年",
};
const relevantBrands=/ChatGPT|Claude|Gemini|Google AI|Grok|Cursor|Perplexity|Windsurf|Codex|Kiro|Midjourney|Suno|Runway|DeepSeek|NotebookLM|Copilot|Muse AI|反重力/i;
const excludedGoods=/补差价|差价款|补款|押金|咨询客服|反代(?:专用|购买)|接码|接马服务|代过.{0,4}KYC|退款专用|(?:API.{0,6}(?:余额|中转|额度))/i;
const excludedDelivery=new Set(["verification_service","session_token","relay_api"]);

export const offerText=(value:unknown)=>typeof value==="string"?value.trim():"";

export function visibleAiProduct(productType:unknown,plan:string) {
  return (productType==="subscription"||productType==="account")&&plan.length<=100&&relevantBrands.test(plan);
}

function storefrontPrice(row:Record<string,unknown>,shopHandle:string,clock:number) {
  const original=offerText(row.original_name);
  const price=String(row.price??"");
  const delivery=offerText(row.delivery_type);
  const checked=Date.parse(offerText(row.observed_at));
  if (row.currency!=="CNY"||!original||
    !/^\d{1,6}(?:\.\d{1,2})?$/.test(price)||Number(price)<=0||!Number.isFinite(checked)||checked>clock) return;
  const name=offerText(row.shop_name).replace(/\s+/g," ");
  const label=name&&name.length<=100&&name!==row.shop_token&&name!==shopHandle?name:`店铺 ${shopHandle}`;
  const unavailable=row.stock_status==="out_of_stock";
  const flaggedLow=Array.isArray(row.risk_flags)&&row.risk_flags.includes("abnormal_low_price");
  const notes=(unavailable?"观测时缺货。":"")+(flaggedLow?"来源将该标价标记为异常低价。":"");
  return {original,delivery,checked,name:label,cnyMinor:Math.round(Number(price)*100),notes};
}

export function priceMemoVisibleOffer(plan:string,row:Record<string,unknown>,shopHandle:string,clock=Date.now()) {
  const evidence=storefrontPrice(row,shopHandle,clock);
  if(!evidence||excludedGoods.test(evidence.original)||excludedDelivery.has(evidence.delivery))return;
  const {original,delivery,checked,name,cnyMinor,notes}=evidence;
  const timing=offerText(row.service_period);
  const period=Object.hasOwn(periods,timing)?periods[timing]:"周期未注明";
  const form=Object.hasOwn(deliveryLabels,delivery)?deliveryLabels[delivery]:undefined;
  const offer:StorefrontObservation["offers"][number]={
    plan:form?`${plan} · ${form}`:plan,cnyMinor,period,productTitle:original.replace(/\s+/g," ").slice(0,180),
    ...(notes?{notes}:{}),
  };
  const category:StorefrontObservation["category"]=delivery==="subscription_recharge"||(!form&&/代充|直充|续费/.test(original))?"ai-topup":"ai-card";
  return {name,checked,offer,category,score:4*Number(row.stock_status==="in_stock")+2*Number(Boolean(form))+Number(period!=="周期未注明")};
}

export function priceMemoCodexVerificationOffer(row:Record<string,unknown>,shopHandle:string,clock=Date.now()) {
  const evidence=storefrontPrice(row,shopHandle,clock);
  if(!evidence||evidence.delivery!=="verification_service"||!mentionsCodex(evidence.original)||
    !/接[码马碼🐎]|短信验证|手机号验证|sms verification/iu.test(evidence.original)||
    /已接[码马]|未接[码马]|免(?:手机|短信)?验证|补差价|退款专用|押金/.test(evidence.original))return;
  const single=/单次|一次性|限一次|(?:^|\D)1\s*次/.test(evidence.original)&&!/包月|月卡|年卡|\d+\s*次套餐/.test(evidence.original);
  const offer:StorefrontObservation["offers"][number]={plan:codexVerificationProduct,cnyMinor:evidence.cnyMinor,
    period:single?"每次":"计价单位未注明",...(evidence.notes?{notes:evidence.notes}:{})};
  return {name:evidence.name,checked:evidence.checked,offer,category:"ai-card" as const,score:Number(single)};
}
