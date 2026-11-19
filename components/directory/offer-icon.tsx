import { Clapperboard, CodeXml, KeyRound, Layers, Package, RefreshCw, UserRound, Users } from "lucide-react";
import { offerAiBrand } from "@/lib/directory/ai-product";
import type { Price, Site } from "@/lib/directory/types";
import { AiProductIcon } from "./ai-product-icon";
import { categoryIcons } from "./category-icon";

const retailIcons = [
  [/组合|合集|[二三四]合一|多模型|bundle/i, Layers],
  [/卡密|兑换码|礼品卡|\b(?:CDK|redeem code|gift card)\b/i, KeyRound],
  [/共享|合租|席位|车位|拼车|\bshared\b/i, Users],
  [/成品号|成品[账帐]号|独享号|[账帐]号|\baccount\b/i, UserRound],
  [/代充|直充|续费|充值|\b(?:top[ -]?up|recharge)\b/i, RefreshCw],
  [/即梦|视频生成/i, Clapperboard],
] as const;

export function OfferIcon({ price, site }: {
  price: Pick<Price, "product_title" | "plan">;
  site: Pick<Site, "category_slug" | "slug">;
}) {
  const { category_slug:category,slug }=site;
  const brand=offerAiBrand(price.product_title,price.plan,category,slug);
  const retailIcon=(category==="ai-topup"||category==="ai-card")
    ?retailIcons.find(([pattern])=>pattern.test(`${price.product_title??""} ${price.plan}`.normalize("NFKC")))?.[1]:undefined;
  const icon=Object.hasOwn(categoryIcons,category)?categoryIcons[category as keyof typeof categoryIcons]:Package;
  const Fallback=brand==="Copilot"?CodeXml:retailIcon??icon;
  return <AiProductIcon product={brand??""} fallback={<Fallback className="ai-product-icon" size={16} aria-hidden="true"/>}/>;
}
