import { offerAiBrand } from "./ai-product";
import { merchantNameKey } from "./merchant-evidence";
import type { LeadPage } from "./merchant-lead-page";
import { retailPeriod } from "./public-product-quote";
import { amountMinor } from "./refresh-quotes";
import type { StorefrontObservation } from "./storefront-import";
import { websiteUrl } from "./validation";
import { readPublicPage,type Visit } from "./website-check";

const catalogPath="/api/v1/public/products";
const configPath="/api/v1/public/config";
const pageSize=20;
const object=(value:unknown)=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const text=(value:unknown)=>typeof value==="string"?value.trim().replace(/\s+/gu," "):"";

function localized(value:unknown) {
  const labels=object(value);
  return text(value)||text(labels?.["zh-CN"])||text(labels?.["zh-TW"])||text(labels?.["en-US"]);
}

export async function readDujiaoStorefront(home:LeadPage,visit:Visit) {
  // The public storefront may be rendered entirely in the browser.
  if (!/<div\b[^>]*\bid=["']app["']/i.test(home.body)||!/<script\b[^>]*\btype=["']module["']/i.test(home.body)) return;
  const origin=new URL(home.url).origin;
  async function read(path:string,page?:number) {
    const response=await readPublicPage(origin+path,(url,signal,maxBytes)=>{
      if (page&&url.origin===origin&&url.pathname===catalogPath) {
        url=new URL(url);
        url.searchParams.set("page",String(page));
        url.searchParams.set("page_size",String(pageSize));
      }
      return visit(url,signal,maxBytes);
    },1_200_000,10_000,0);
    if (response.truncated||new URL(response.url).origin!==origin||new URL(response.url).pathname!==path||
        !/json/i.test(response.contentType)) return;
    const result=object(JSON.parse(response.body));
    return result?.status_code===0?result:undefined;
  }
  const settings=object((await read(configPath))?.data);
  const brand=object(settings?.brand);
  const name=localized(brand?.site_name);
  if (!settings||!name||name.length>100||!merchantNameKey(name)||
      typeof settings.storefront_template!=="string"||typeof settings.currency!=="string") return;
  if (brand?.site_url&&websiteUrl(String(brand.site_url)).registrable!==websiteUrl(origin).registrable) return;
  const first=await read(catalogPath,1);
  if (!Array.isArray(first?.data)) return;
  const totalPages=Number(object(first.pagination)?.total_page??1);
  const products=first.data.slice(0,pageSize);
  for (let page=2;page<=Math.min(totalPages,3);page++) {
    const next=await read(catalogPath,page);
    if (!Array.isArray(next?.data)) return;
    products.push(...next.data.slice(0,pageSize));
  }
  const titles:string[]=[];
  const offers=new Map<string,StorefrontObservation["offers"][number]>();
  const conflicts=new Set<string>();
  for (const entry of products) {
    const item=object(entry);
    const title=localized(item?.title);
    if (!item||item.is_active===false||!title||title.length>150||!offerAiBrand(title,title,"ai-card","")||
        /补差价|补款|押金|退款专用|(?:教程|演示|测试)(?:专用|商品)?$/i.test(title)) continue;
    titles.push(title);
    const price=amountMinor(item.price_amount,"CNY");
    if (settings.currency!=="CNY"||!price) continue;
    const availability=item.stock_status==="out_of_stock"?"unavailable":
      ["in_stock","low_stock"].includes(String(item.stock_status))?"available":undefined;
    const prior=offers.get(title);
    if (prior&&(prior.cnyMinor!==price||prior.availability!==availability)) conflicts.add(title);
    offers.set(title,{plan:title,productTitle:title,cnyMinor:price,period:retailPeriod(title),
      ...(availability?{availability}:{}),...(availability==="unavailable"?{notes:"官网标记缺货。"}:{})});
  }
  const icon=text(brand?.site_logo)||text(brand?.site_icon);
  return {name,icon,titles:[...new Set(titles)],offers:[...offers.values()].filter(offer=>!conflicts.has(offer.plan)).slice(0,50)};
}

export async function readDujiaoObservation(page:LeadPage,shop:{name:string;website:string;category_slug:StorefrontObservation["category"]},
  stamp:string,visit:Visit):Promise<StorefrontObservation|undefined> {
  const catalog=await readDujiaoStorefront(page,visit).catch(()=>undefined);
  if (!catalog?.offers.length||merchantNameKey(catalog.name)!==merchantNameKey(shop.name)) return;
  return {name:shop.name,website:shop.website,sourceUrl:page.url,observedAt:stamp,category:shop.category_slug,offers:catalog.offers};
}
