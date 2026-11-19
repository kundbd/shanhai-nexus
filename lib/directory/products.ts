import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { one } from "./db";
import { latestPrices,priceIdentity,publicPrices } from "./read";
import type { Price } from "./types";

export const productKey=(price:Price)=>createHash("sha256").update(priceIdentity(price)).digest("hex").slice(0,32);
export const productHref=(price:Price)=>`/products/${price.site_id}/${productKey(price)}`;
export const productName=(price:Price)=>price.product_title||price.plan;

export function currentPublicProducts(db:DatabaseSync,siteId:number) {
  return new Map(latestPrices(publicPrices(siteId,db)).map(price=>[productKey(price),price]));
}

export function getPublicProduct(db:DatabaseSync,siteId:number,key:string) {
  const active=one(db,"SELECT 1 FROM sites WHERE id=? AND publication='published' AND lifecycle<>'closed'",siteId);
  return active?currentPublicProducts(db,siteId).get(key):undefined;
}
