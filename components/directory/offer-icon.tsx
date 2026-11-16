import { Cloud, CreditCard, Layers, Network, Notebook, Package, Plane, Server, Shield } from "lucide-react";
import { offerAiBrand } from "@/lib/directory/ai-product";
import type { Price, Site } from "@/lib/directory/types";
import { AiProductIcon } from "./ai-product-icon";

const categoryIcons = {
  "ai-relay": Network,
  "ai-platforms": Layers,
  airport: Plane,
  vpn: Shield,
  "proxy-services": Network,
  residential: Network,
  "network-infrastructure": Network,
  "u-card": CreditCard,
  "virtual-card": CreditCard,
  "payment-accounts": CreditCard,
  "subscription-payment": CreditCard,
  vps: Server,
  "cloud-storage": Cloud,
};

export function OfferIcon({ price, site }: {
  price: Pick<Price, "product_title" | "plan">;
  site: Pick<Site, "category_slug" | "slug">;
}) {
  const { category_slug:category,slug }=site;
  const brand=offerAiBrand(price.product_title,price.plan,category,slug);
  const categoryIcon=Object.hasOwn(categoryIcons,category)?categoryIcons[category as keyof typeof categoryIcons]:Package;
  const Fallback=brand==="Notion AI"?Notebook:categoryIcon;
  return <AiProductIcon product={brand??""} fallback={<Fallback className="ai-product-icon" size={16} aria-hidden="true"/>}/>;
}
