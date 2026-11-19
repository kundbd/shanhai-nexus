import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { priceMemoProductStorefront, storefrontIdentity } from "../lib/directory/storefront-identity";
import type { StorefrontObservation } from "../lib/directory/storefront-import";
import { offerText as string,priceMemoCodexVerificationOffer,priceMemoVisibleOffer,visibleAiProduct } from "../lib/directory/storefront-product-evidence";

const args=process.argv.slice(2);
const codexVerification=args.includes("--codex-verification");
const allProducts=args.includes("--all-products")||codexVerification;
const [database,input,output,productLinks]=args.filter(arg=>arg!=="--all-products"&&arg!=="--codex-verification");
if (!database || !input || !output) throw new Error("用法 prepare-pricememo-storefronts <数据库> <PriceMemo 静态快照> <观测结果 JSON> [商品链接 JSON] [--all-products | --codex-verification]");

type ObjectRow = Record<string,unknown>;
const object = (value:unknown):ObjectRow|undefined => value && typeof value==="object" && !Array.isArray(value)?value as ObjectRow:undefined;
const list = (value:unknown):unknown[] => Array.isArray(value)?value:[];

type Rated = { row:StorefrontObservation; score:number; checked:number; key:string };
const sourceText = readFileSync(input,"utf8");
if (Buffer.byteLength(sourceText)>64_000_000) throw new Error("快照超过 64 MB。");
const snapshot=object(JSON.parse(sourceText.replace(/^\ufeff/,"")));
const sourceUrl=string(snapshot?.snapshot_url);
const published=Date.parse(string(snapshot?.published_at));
const clock=Date.now();
if (snapshot?.schema_version!=="price-radar.v1" || !/^https:\/\/ai\.pricememo\.cn\/data\/v1\/snapshots\/\d+\.json$/.test(sourceUrl) ||
  !Number.isFinite(published) || published>clock) throw new Error("需要带发布时间的有效 PriceMemo 公开快照。");

const db = new DatabaseSync(database,{readOnly:true});
const known = new Set((db.prepare("SELECT storefront_key FROM merchant_storefronts").all() as {storefront_key:string}[]).map(row=>row.storefront_key));
const publishedShops="s.publication='published' AND s.category_slug IN ('ai-topup','ai-card') AND s.lifecycle<>'closed'";
const publishedLinks=db.prepare(`SELECT sf.storefront_key FROM merchant_storefronts sf JOIN sites s ON s.id=sf.site_id WHERE ${publishedShops}`).all() as {storefront_key:string}[];
const active=new Set(publishedLinks.map(row=>row.storefront_key));
for (const row of db.prepare(`SELECT website, (${publishedShops}) active FROM sites s`).all() as {website:string;active:number}[]) {
  try {
    const key=storefrontIdentity(row.website)?.key;
    if (key) {
      known.add(key);
      if(row.active) active.add(key);
    }
  } catch { /* A legacy address may no longer match the active URL validator. */ }
}
db.close();

const requested=productLinks ? new Set(list(JSON.parse(readFileSync(productLinks,"utf8").replace(/^\ufeff/,""))).map(string).filter(Boolean)) : null;
const candidateKeys=new Set<string>(), duplicates=new Set<string>();
const byProduct = new Map<string, Rated[]>();
const productOwners = new Map<string,Set<string>>();
for (const item of list(snapshot?.products)) {
  const product=object(item);
  const plan=string(product?.display_name);
  const selected=codexVerification?product?.product_type==="service"&&plan==="手机接码":visibleAiProduct(product?.product_type,plan);
  if (!selected) continue;
  for (const raw of list(product?.offers)) {
    const offer=object(raw);
    const token=string(offer?.shop_token);
    const reportedItemUrl=string(offer?.source_url);
    if (!offer || offer.currency!=="CNY" || (requested&&!requested.has(reportedItemUrl))) continue;
    const storefront=priceMemoProductStorefront(string(offer.source_platform),token,reportedItemUrl);
    if (!storefront) continue;
    const key=storefront.key;
    const owners=productOwners.get(reportedItemUrl)??new Set<string>();
    owners.add(key);
    productOwners.set(reportedItemUrl,owners);
    if (allProducts&&!active.has(key)) continue;
    candidateKeys.add(key);
    if (!allProducts&&known.has(key)) {
      duplicates.add(key);
      continue;
    }
    const handle=key.slice(key.indexOf("/")+1);
    const evidence=codexVerification?priceMemoCodexVerificationOffer(offer,handle,clock):priceMemoVisibleOffer(plan,offer,handle,clock);
    if (!evidence) continue;
    const row:StorefrontObservation = {
      name:evidence.name,
      website:storefront.url,
      sourceUrl,discoveryUrl:sourceUrl,reportedItemUrl,
      observedAt:new Date(evidence.checked).toISOString(),
      category:evidence.category,
      offers:[evidence.offer],
    };
    const candidates=byProduct.get(reportedItemUrl)??[];
    candidates.push({row,score:evidence.score,checked:evidence.checked,key});
    byProduct.set(reportedItemUrl,candidates);
  }
}
const outcomes = new Map<string, Rated>();
const productConflicts=new Set<string>();
let conflictingProductLinks=0;
for(const [product,candidates] of byProduct) {
  if (productOwners.get(product)?.size!==1) {
    conflictingProductLinks++;
    for (const {key} of candidates) productConflicts.add(key);
    continue;
  }
  for(const candidate of candidates) {
    const {key,score,checked}=candidate;
    const identity=allProducts?product:key;
    const best=outcomes.get(identity);
    if (!best || (allProducts?checked>best.checked || (checked===best.checked && score>best.score):score>best.score || (score===best.score && checked>best.checked))) {
      outcomes.set(identity,candidate);
    }
  }
}
const includedShops=new Set([...outcomes.values()].map(item=>item.key));
for(const key of includedShops) productConflicts.delete(key);
const rows=[...outcomes.values()].map(outcome=>outcome.row);
const byPlatform:Record<string,number> = {};
for (const row of rows) {
  const platform=new URL(row.website).hostname.replace(/^www\./,"");
  byPlatform[platform]=(byPlatform[platform]??0)+1;
}
writeFileSync(output,JSON.stringify(rows,null,2));
console.log(JSON.stringify({sourceUrl,mode:codexVerification?"codex-verification":allProducts?"all-products":"new-shops",productLinks:productOwners.size,requestedLinks:requested?.size,
  conflictingProductLinks,candidateStorefronts:candidateKeys.size,knownSkipped:duplicates.size,identityReview:productConflicts.size,
  reportable:rows.length,shopsWithProducts:includedShops.size,missingProductPrice:candidateKeys.size-duplicates.size-productConflicts.size-includedShops.size,byPlatform},null,2));
