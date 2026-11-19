import type { NextRequest } from "next/server";
import { boundedText } from "@/lib/directory/imports";
import { directory,one } from "@/lib/directory/db";
import { choice,now,textValue,websiteUrl } from "@/lib/directory/validation";
import { isRetiredCategory,pipelineForCategory } from "@/lib/directory/taxonomy";

export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded") || request.headers.get("sec-fetch-site") === "cross-site") {
    return new Response("请求格式或来源无效。",{status:403});
  }
  function redirect(result: string) {
    return new Response(null,{status:303,headers:{Location:`/contact?${new URLSearchParams({result})}`,"Cache-Control":"no-store"}});
  }
  try {
    const form = new URLSearchParams(await boundedText(request,36_000));
    if (form.get("company")) return redirect("ok");
    const kind = choice(form.get("kind"),["site","correction","response"],"类型");
    const merchant = kind==="site" && form.get("merchant")==="1";
    const merchantName=merchant?textValue(form.get("merchant_name"),100,"商家名称"):null;
    const category=merchant?textValue(form.get("merchant_category"),90,"商家分类"):null;
    const contact=merchant?textValue(form.get("merchant_contact"),180,"联系方式",false)||null:null;
    const offers=merchant?textValue(form.get("merchant_offers"),800,"套餐信息",false)||null:null;
    const operations=merchant?textValue(form.get("merchant_operations"),300,"运营说明",false)||null:null;
    if (merchant&&(!pipelineForCategory(category!)||isRetiredCategory(category!)||form.get("publication_consent")!=="1")) throw new Error("商家分类或授权无效");
    const body = textValue(form.get("body"),1600,"说明");
    if (body.length < 15) throw new Error("正文过短");
    const raw = textValue(form.get("url"),1500,"来源网址",kind === "site");
    const parsed = raw ? websiteUrl(raw) : null;
    const url=parsed?.url??null;
    const registrable=merchant?parsed?.registrable??null:null;
    const db = directory();
    if (registrable&&one(db,"SELECT 1 FROM site_domains WHERE registrable=?",registrable)) return redirect("limited");
    const site = one<{ id:number }>(db,"SELECT id FROM sites WHERE slug=? AND publication='published'",form.get("site") ?? "");
    const recent = now();
    const result = db.prepare(`INSERT INTO submissions(site_id,kind,url,body,submitted_at,merchant_name,merchant_category,publication_consent,
      merchant_contact,merchant_offers,merchant_operations,merchant_registrable)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM submissions WHERE submitted_at>=?)<35
      AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM submissions WHERE merchant_registrable=? AND moderation='pending'))
      AND NOT EXISTS(SELECT 1 FROM submissions WHERE kind=? AND body=? AND url IS ? AND submitted_at>=?)`)
      .run(site?.id ?? null,kind,url,body,recent,merchantName,category,Number(merchant),contact,offers,operations,registrable,
        new Date(Date.now()-3_600_000).toISOString(),registrable,registrable,kind,body,url,new Date(Date.now()-86_400_000).toISOString());
    return redirect(result.changes ? "ok" : "limited");
  } catch {
    return redirect("invalid");
  }
}
