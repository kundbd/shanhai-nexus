import { all,directory,one } from "./db";
import type { Entity } from "./write";

export type AdminRow = Record<string,string | number | null>;
const titles = {sites:"name",categories:"label",sources:"title",editorials:"title",price_records:"plan",incidents:"title",submissions:"kind"} as const;
export const adminLabels = { traffic:"访问统计",sites:"服务商",categories:"分类",sources:"来源",editorials:"山海观察",price_records:"价格记录",incidents:"事件记录",submissions:"投稿审核",reviews:"评价审核",imports:"批量导入",discovery:"商家发现",campaigns:"批量采集",audit:"修改历史" } as const;
export const submissionStates = {pending:"待审核",accepted:"已接受",rejected:"已拒绝"} as const;
export type SubmissionState = keyof typeof submissionStates;

type AdminOverview = { merchants:number; prices:number; observations:number; drafts:number; reviews:number; submissions:number; imports:number };

export function adminOverview(db=directory()) {
  return one<AdminOverview>(db,`SELECT
    (SELECT count(*) FROM sites WHERE publication='published') merchants,
    (SELECT count(*) FROM price_records WHERE publication='published') prices,
    (SELECT count(*) FROM editorials e WHERE e.publication='published' AND (e.site_id IS NULL OR EXISTS(SELECT 1 FROM sites s WHERE s.id=e.site_id AND s.publication='published'))) observations,
    (SELECT count(*) FROM sites WHERE publication='draft') drafts,
    (SELECT count(*) FROM user_reviews r JOIN sites s ON s.id=r.site_id WHERE r.moderation='pending' AND s.publication='published') reviews,
    (SELECT count(*) FROM submissions WHERE moderation='pending') submissions,
    (SELECT count(*) FROM import_items WHERE state='ready') imports`)!;
}

export function adminRows(entity: Entity, search = "", page = 1, state: SubmissionState | "" = "") {
  const title = titles[entity];
  const sort = entity === "categories" ? "position,label" : "id DESC";
  const filter = entity === "submissions" ? "body" : title;
  const moderation=entity==="submissions"&&state ? " AND moderation=?" : "";
  return all<AdminRow>(directory(),`SELECT *,${title} display FROM ${entity} WHERE (?='' OR instr(lower(${filter}),lower(?))>0)${moderation} ORDER BY ${sort} LIMIT 51 OFFSET ?`,search,search,...(moderation?[state]:[]),(page-1)*50);
}

export function adminRecord(entity: Entity, id: string) {
  const db = directory();
  const row = one<AdminRow>(db,`SELECT * FROM ${entity} WHERE ${entity==="categories"?"slug":"id"}=?`,id);
  if (!row) return undefined;
  if (entity==="sites") {
    Object.assign(row,JSON.parse(String(row.merchant_details)));
    row.aliases = (JSON.parse(String(row.aliases)) as string[]).join("\n");
    const domains = all<{domain:string;kind:string}>(db,"SELECT domain,kind FROM site_domains WHERE site_id=?",id);
    row.domain_aliases = domains.filter((domain)=>domain.kind==="alias").map(({domain})=>domain).join("\n");
    row.historical_domains = domains.filter((domain)=>domain.kind==="historical").map(({domain})=>domain).join("\n");
  }
  if (entity==="editorials") row.claims = JSON.stringify(all(db,"SELECT label,statement,nature,source_id FROM editorial_claims WHERE editorial_id=? ORDER BY id",id),null,2);
  return row;
}
