import { type NextRequest } from "next/server";
import { adminActor,sessionCookie } from "@/lib/directory/auth";
import { all,directory } from "@/lib/directory/db";

export function GET(request:NextRequest) {
  if (!adminActor(request.cookies.get(sessionCookie)?.value)) return new Response("请登录",{status:401});
  const params=request.nextUrl.searchParams;
  const category=(params.get("category")??"").slice(0,90);
  const requested=params.get("kind");
  const kind=requested==="campaign"||requested==="candidates"?requested:"sites";
  const after=Math.max(0,Number.parseInt(params.get("after")??"",10)||0);
  const campaign=Number(params.get("campaign"));
  if (kind==="campaign"&&(!Number.isSafeInteger(campaign)||campaign<1)) return new Response("请选择采集任务",{status:400});
  const db=directory();
  const rows=kind==="sites"?all<Record<string,unknown>>(db,`SELECT s.id,s.name,s.website url,s.category_slug category,s.status,s.lifecycle,s.website_language,
    s.verified_at,s.updated_at,(SELECT group_concat(src.url,char(10)) FROM sources src WHERE src.site_id=s.id) source_urls
    FROM sites s WHERE s.publication='published' AND (?='' OR s.category_slug=?) AND s.id>? ORDER BY s.id LIMIT 5000`,category,category,after):kind==="campaign"?
    all<Record<string,unknown>>(db,`SELECT c.id,c.registrable,c.pipeline,c.state,c.reason,c.checked_at,c.details,
      i.state review_state, (SELECT group_concat(DISTINCT q.query) FROM merchant_urls u JOIN merchant_requests r ON r.id=u.request_id
      JOIN merchant_queries q ON q.id=r.query_id WHERE u.candidate_id=c.id) search_queries,
      (SELECT group_concat(DISTINCT u.url) FROM merchant_urls u WHERE u.candidate_id=c.id) urls,
      (SELECT group_concat(DISTINCT l.evidence_url) FROM merchant_source_links l WHERE l.candidate_id=c.id) source_urls,
      (SELECT count(*) FROM merchant_verification_attempts a WHERE a.candidate_id=c.id) verification_attempts
      FROM merchant_candidates c LEFT JOIN import_items i ON i.id=c.item_id WHERE c.campaign_id=? AND c.id>? ORDER BY c.id LIMIT 5000`,campaign,after):
    all<Record<string,unknown>>(db,`SELECT i.id,i.domain,json_extract(i.payload,'$.name') name,json_extract(i.payload,'$.url') url,
    json_extract(i.payload,'$.category') category,i.state,i.reachability,i.checked_at,json_extract(i.payload,'$.source_url') source_url
    FROM import_items i WHERE (?='' OR json_extract(i.payload,'$.category')=?) AND i.id>? ORDER BY i.id LIMIT 5000`,category,category,after);
  const headers:Record<string,string>={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow",
    "X-Next-Id":rows.length===5000?String(rows.at(-1)?.id):""};
  const csv=params.get("format")==="csv";
  headers["Content-Type"]=csv?"text/csv; charset=utf-8":"application/json; charset=utf-8";
  headers["Content-Disposition"]=`attachment; filename="shanhai-${kind}.${csv?"csv":"json"}"`;
  if (!csv) return new Response(JSON.stringify(rows,null,2),{headers});
  const fields=Object.keys(rows[0]??{id:null,name:null,url:null,category:null});
  const cell=(value:unknown)=>{
    const text=String(value??"");
    return `"${(/^[\t\r\n]|^\s*[=+\-@]/.test(text)?"'":"") + text.replaceAll('"','""')}"`;
  };
  return new Response("\ufeff"+[fields.map(cell).join(","),...rows.map(row=>fields.map(field=>cell(row[field])).join(","))].join("\r\n"),{headers});
}
