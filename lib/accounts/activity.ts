import { all,directory,one } from "@/lib/directory/db";
import type { ReviewModeration } from "@/lib/directory/reviews";
import { siteVisibility, type ContentVisibility } from "@/lib/geo/visibility";

const size=20;
type Activity={id:number;slug:string;name:string;published:0|1;score:number|null;body:string;submitted_at:string;moderation:ReviewModeration;thread_id:number|null};

export function memberActivity(accountId:number,requestedPage:number,db=directory(),visibility?:ContentVisibility) {
  const region=visibility ? siteVisibility(visibility) : {clause:"1",bindings:[]};
  const totals=one<{total:number;ratings:number;replies:number}>(db,`SELECT count(*) total,count(r.score) ratings,count(r.thread_id) replies
    FROM user_reviews r JOIN sites s ON s.id=r.site_id WHERE r.account_id=? AND ${region.clause}`,accountId,...region.bindings)!;
  const pages=Math.max(1,Math.ceil(totals.total/size));
  const page=Math.max(1,Math.min(pages,requestedPage));
  const rows=all<Activity>(db,`SELECT r.id,s.slug,s.name,(s.publication='published') published,r.score,r.body,r.submitted_at,r.moderation,r.thread_id
    FROM user_reviews r JOIN sites s ON s.id=r.site_id WHERE r.account_id=? AND ${region.clause}
    ORDER BY r.submitted_at DESC,r.id DESC LIMIT ? OFFSET ?`,accountId,...region.bindings,size,(page-1)*size);
  return {totals,page,pages,rows};
}
