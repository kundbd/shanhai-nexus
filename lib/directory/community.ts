import type { DatabaseSync } from "node:sqlite";
import { all,directory,one } from "./db";
import { reviewPageSize } from "./reviews";
import { siteVisibility, type ContentVisibility } from "../geo/visibility";

type Thread = {id:number;slug:string;site_name:string;score:number|null;body:string;submitted_at:string;reply_count:number};
type Reply = {id:number;body:string;submitted_at:string;reply_to:number;target_public:number};

const threadQuery=`SELECT r.id,s.slug,s.name site_name,r.score,r.body,r.submitted_at,
  (SELECT count(*) FROM user_reviews c WHERE c.thread_id=r.id AND c.moderation='accepted') reply_count
  FROM user_reviews r JOIN sites s ON s.id=r.site_id AND s.publication='published'
  WHERE r.thread_id IS NULL AND r.body<>'' AND r.moderation='accepted'`;

export function publicThreads(page:number,db=directory(),visibility?:ContentVisibility) {
  const region=siteVisibility(visibility);
  return all<Thread>(db,`${threadQuery} AND ${region.clause} ORDER BY r.submitted_at DESC,r.id DESC LIMIT ? OFFSET ?`,
    ...region.bindings,reviewPageSize+1,(page-1)*reviewPageSize);
}

export function publicThread(id:number,db=directory(),visibility?:ContentVisibility) {
  const region=siteVisibility(visibility);
  return one<Thread>(db,`${threadQuery} AND r.id=? AND ${region.clause}`,id,...region.bindings);
}

export function publicThreadMatches(db: DatabaseSync, visibility: ContentVisibility, topic: string) {
  const region = siteVisibility(visibility);
  return all<Thread>(db, `${threadQuery} AND ${region.clause} AND (?='' OR instr(lower(s.name),lower(?))>0 OR instr(lower(r.body),lower(?))>0)
    ORDER BY r.submitted_at DESC,r.id DESC LIMIT 5`, ...region.bindings, topic, topic, topic);
}

export function threadReplies(id:number,options:{page:number}|{preview:true},db=directory(),visibility?:ContentVisibility) {
  const preview="preview" in options;
  const region=siteVisibility(visibility);
  const result=all<Reply>(db,`SELECT r.id,r.body,r.submitted_at,r.reply_to,(parent.moderation='accepted') target_public
    FROM user_reviews r JOIN user_reviews parent ON parent.id=r.reply_to
    JOIN user_reviews root ON root.id=r.thread_id AND root.site_id=r.site_id AND root.moderation='accepted' AND root.body<>'' AND root.thread_id IS NULL
    JOIN sites s ON s.id=r.site_id AND s.publication='published' WHERE r.thread_id=? AND r.moderation='accepted' AND ${region.clause}
    ORDER BY ${preview?"r.submitted_at DESC,r.id DESC":"r.submitted_at,r.id"} LIMIT ? OFFSET ?`,id,...region.bindings,preview?3:reviewPageSize,preview?0:(options.page-1)*reviewPageSize);
  return preview?result.reverse():result;
}

export const discussionHref=(id:number)=>`/community/${id}`;
