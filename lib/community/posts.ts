import { all,directory,one,transaction } from "@/lib/directory/db";
import type { DatabaseSync } from "node:sqlite";
import { reviewBlockedWords } from "@/lib/directory/reviews";
import { matchingReviewWords } from "@/lib/directory/review-word-rules";
import { audit } from "@/lib/directory/write";
import { mutedWriting } from "@/lib/moderation/policy";
import { writingMuted } from "@/lib/moderation/store";
import { CommunityError,postLength,type ReactionKind } from "./limits";
import type { MediaFile,MediaType } from "./media";

export const feedSize=20;
const diskBudget=1024*1024*1024;
const memberBudget=256*1024*1024;
const visible=`p.hidden=0 AND p.ai_pending=0 AND (p.thread_id IS NULL OR EXISTS (
  SELECT 1 FROM community_posts root WHERE root.id=p.thread_id AND root.hidden=0 AND root.ai_pending=0
))`;

type Reactions={likes:number;reposts:number;liked:0|1;reposted:0|1;bookmarked:0|1};
const reactionColumns=`(SELECT count(*) FROM community_reactions r WHERE r.post_id=p.id AND r.kind='like') likes,
  (SELECT count(*) FROM community_reactions r WHERE r.post_id=p.id AND r.kind='repost') reposts,
  EXISTS(SELECT 1 FROM community_reactions r WHERE r.post_id=p.id AND r.kind='like' AND r.account_id=viewer.id) liked,
  EXISTS(SELECT 1 FROM community_reactions r WHERE r.post_id=p.id AND r.kind='repost' AND r.account_id=viewer.id) reposted,
  EXISTS(SELECT 1 FROM community_reactions r WHERE r.post_id=p.id AND r.kind='bookmark' AND r.account_id=viewer.id) bookmarked`;

type PostRow=Reactions&{
  id:number;author_id:number;username:string;body:string;created_at:number;reply_to:number|null;thread_id:number|null;reply_author:string|null;replies:number;visitors:number;
};
export type CommunityPost=PostRow&{media:Pick<MediaFile,"id"|"mime">[]};
type FeedRow=PostRow&{reposter:string|null;reposter_id:number|null;event_at:number};

const postColumns=`p.id,p.author_id,a.username,p.body,p.created_at,p.reply_to,p.thread_id,p.visitor_count visitors,parent_author.username reply_author,
  CASE WHEN p.thread_id IS NULL THEN (SELECT count(*) FROM community_posts r WHERE r.thread_id=p.id AND r.hidden=0 AND r.ai_pending=0)
       ELSE (SELECT count(*) FROM community_posts r WHERE r.reply_to=p.id AND r.hidden=0 AND r.ai_pending=0) END replies,${reactionColumns}`;
const authors=`JOIN member_accounts a ON a.id=p.author_id
  LEFT JOIN community_posts parent ON parent.id=p.reply_to AND parent.hidden=0 AND parent.ai_pending=0
  LEFT JOIN member_accounts parent_author ON parent_author.id=parent.author_id`;

function attachMedia<T extends PostRow>(db:DatabaseSync,rows:T[]) {
  if(!rows.length)return [] as (T&{media:CommunityPost["media"]})[];
  const ids=[...new Set(rows.map(row=>row.id))];
  const media=all<{post_id:number;id:string;mime:MediaType}>(db,`SELECT post_id,id,content_type mime FROM community_media
    WHERE post_id IN (${ids.map(()=>"?").join(",")}) ORDER BY post_id,position`,...ids);
  const lists=new Map<number,CommunityPost["media"]>();
  for(const {post_id,id,mime} of media) {
    const list=lists.get(post_id)??[];
    list.push({id,mime});
    lists.set(post_id,list);
  }
  return rows.map(row=>({...row,media:lists.get(row.id)??[]}));
}

export function communityFeed(page:number,viewer:number|undefined,saved=false,db=directory()) {
  const stream=saved?`SELECT post_id,created_at event_at,NULL reposter_id FROM community_reactions WHERE kind='bookmark' AND account_id=(SELECT id FROM viewer)`:
    `SELECT id post_id,created_at event_at,NULL reposter_id FROM community_posts WHERE thread_id IS NULL AND hidden=0
     UNION ALL SELECT post_id,created_at event_at,account_id reposter_id FROM community_reactions WHERE kind='repost'`;
  const rows=all<FeedRow>(db,`WITH viewer(id) AS (VALUES (?)), stream AS (${stream})
    SELECT ${postColumns},stream.event_at,stream.reposter_id,reposter.username reposter FROM stream
    JOIN community_posts p ON p.id=stream.post_id ${authors}
    LEFT JOIN member_accounts reposter ON reposter.id=stream.reposter_id CROSS JOIN viewer
    WHERE ${visible} ORDER BY stream.event_at DESC,stream.post_id DESC,stream.reposter_id DESC LIMIT ? OFFSET ?`,
    viewer??null,feedSize+1,(page-1)*feedSize);
  return attachMedia(db,rows);
}

export function communityPost(id:number,viewer?:number,db=directory()) {
  const row=one<PostRow>(db,`WITH viewer(id) AS (VALUES (?))
    SELECT ${postColumns} FROM community_posts p ${authors} CROSS JOIN viewer WHERE p.id=? AND ${visible}`,viewer??null,id);
  return row?attachMedia(db,[row])[0]:undefined;
}

export function publicPostMatches(db: DatabaseSync, topic: string) {
  return all<Pick<PostRow, "id" | "body" | "created_at">>(db, `SELECT p.id,p.body,p.created_at FROM community_posts p
    WHERE p.thread_id IS NULL AND ${visible} AND (?='' OR instr(lower(p.body), lower(?))>0)
    ORDER BY p.created_at DESC,p.id DESC LIMIT 5`, topic, topic);
}

export function communityPostVisitors(db:DatabaseSync,id:number) {
  return one<{visitors:number}>(db,`SELECT visitor_count visitors FROM community_posts p WHERE p.id=? AND ${visible}`,id);
}

// Called in the same transaction as the traffic counter.
export function recordCommunityPostVisitor(db:DatabaseSync,id:number,visitorHash:Buffer) {
  const row=communityPostVisitors(db,id);
  if(!row)return;
  const result=db.prepare("INSERT INTO community_post_visitors(post_id,visitor_hash) VALUES (?,?) ON CONFLICT DO NOTHING")
    .run(id,visitorHash);
  if(result.changes)db.prepare("UPDATE community_posts SET visitor_count=visitor_count+1 WHERE id=?").run(id);
  return {visitors:row.visitors+Number(result.changes)};
}

export function communityReplies(root:number,page:number,viewer?:number,db=directory(),direct=false) {
  const rows=all<PostRow>(db,`WITH viewer(id) AS (VALUES (?))
    SELECT ${postColumns} FROM community_posts p ${authors} CROSS JOIN viewer WHERE p.${direct?"reply_to":"thread_id"}=? AND ${visible}
    ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?`,viewer??null,root,feedSize+1,(page-1)*feedSize);
  return attachMedia(db,rows);
}

export function cleanPostBody(db:DatabaseSync,value:string) {
  const body=value.trim();
  const characters=Array.from(body);
  if(characters.length>postLength||characters.some(character=>{
    const code=character.charCodeAt(0);
    return code===127||(code<32&&code!==9&&code!==10&&code!==13);
  })) throw new CommunityError("帖子文字最多 500 字，请检查输入。");
  if(body&&matchingReviewWords(body,reviewBlockedWords(db)).length) throw new CommunityError("内容包含屏蔽词，请修改后再提交。",422);
  return body;
}

export function postWriteAllowed(db:DatabaseSync,author:number,time:number) {
  if(writingMuted(db,author,time))throw new CommunityError(mutedWriting,403);
  const recent=one<{n:number}>(db,"SELECT count(*) n FROM community_posts WHERE author_id=? AND created_at>=?",author,time-600_000)!.n;
  if(recent>=12)throw new CommunityError("发帖或回复过于频繁，请稍后再试。",429);
}

export function targetPost(db:DatabaseSync,id:number) {
  const row=one<{thread_id:number|null}>(db,`SELECT thread_id FROM community_posts p WHERE id=? AND ${visible}`,id);
  if(!row)throw new CommunityError("这个帖子已不存在或已隐藏。",404);
  return row;
}

export function writeCommunityPost(db:DatabaseSync,author:number,text:string,files:readonly MediaFile[],replyTo?:number,time=Date.now()) {
  return transaction(db,()=>{
    postWriteAllowed(db,author,time);
    const body=cleanPostBody(db,text);
    if(!body&&!files.length)throw new CommunityError("请写点内容或添加附件。");
    const root=replyTo?(targetPost(db,replyTo).thread_id??replyTo):null;
    if(files.length) {
      const bytes=files.reduce((total,file)=>total+file.bytes,0);
      const totals=one<{all_bytes:number;member_bytes:number}>(db,`SELECT COALESCE(sum(m.size_bytes),0) all_bytes,
        COALESCE(sum(CASE WHEN p.author_id=? THEN m.size_bytes END),0) member_bytes
        FROM community_media m JOIN community_posts p ON p.id=m.post_id`,author)!;
      if(totals.all_bytes+bytes>diskBudget||totals.member_bytes+bytes>memberBudget) throw new CommunityError("附件空间已满，可继续发布文字。",413);
    }
    const id=Number(db.prepare("INSERT INTO community_posts(author_id,body,thread_id,reply_to,created_at,ai_pending) VALUES (?,?,?,?,?,1)")
      .run(author,body,root,replyTo??null,time).lastInsertRowid);
    const insert=db.prepare("INSERT INTO community_media(id,post_id,position,content_type,size_bytes) VALUES (?,?,?,?,?)");
    for(const [position,file] of files.entries())insert.run(file.id,id,position,file.mime,file.bytes);
    return {id,root};
  });
}

export function setCommunityReaction(db:DatabaseSync,id:number,member:number,kind:ReactionKind,active:boolean,time=Date.now()) {
  return transaction(db,()=>{
    if(kind==="repost"&&active&&writingMuted(db,member,time))throw new CommunityError(mutedWriting,403);
    targetPost(db,id);
    if(active)db.prepare("INSERT INTO community_reactions(post_id,account_id,kind,created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING").run(id,member,kind,time);
    else db.prepare("DELETE FROM community_reactions WHERE post_id=? AND account_id=? AND kind=?").run(id,member,kind);
    return one<Reactions>(db,`WITH viewer(id) AS (VALUES (?)) SELECT ${reactionColumns} FROM community_posts p CROSS JOIN viewer WHERE p.id=?`,member,id)!;
  });
}

export function removeCommunityPost(db:DatabaseSync,id:number,owner?:number,editor?:string) {
  return transaction(db,()=>{
    const row=one<{author_id:number;thread_id:number|null;hidden:number}>(db,"SELECT author_id,thread_id,hidden FROM community_posts WHERE id=?",id);
    if(!row||(!editor&&row.author_id!==owner))throw new CommunityError("无法删除这条帖子。",404);
    const files=all<{id:string}>(db,"SELECT id FROM community_media WHERE post_id=?",id);
    db.prepare("UPDATE community_posts SET hidden=1 WHERE id=?").run(id);
    db.prepare("DELETE FROM community_media WHERE post_id=?").run(id);
    db.prepare("DELETE FROM community_post_visitors WHERE post_id=?").run(id);
    if(editor&&!row.hidden)audit(db,editor,"hide","community_posts",id,{hidden:0},{hidden:1});
    return {root:row.thread_id,files:files.map(file=>file.id)};
  });
}

export function publicCommunityMedia(id:string,db=directory()) {
  return one<{content_type:MediaType;size_bytes:number}>(db,`SELECT m.content_type,m.size_bytes FROM community_media m
    JOIN community_posts p ON p.id=m.post_id WHERE m.id=? AND ${visible}`,id);
}

export function pendingCommunityMedia(id:string,db=directory()) {
  return one<{content_type:MediaType;size_bytes:number}>(db,`SELECT m.content_type,m.size_bytes FROM community_media m
    JOIN community_posts p ON p.id=m.post_id WHERE m.id=? AND p.hidden=0 AND p.ai_pending=1`,id);
}

export function communityModeration(page:number,db=directory()) {
  return all<{id:number;username:string;body:string;created_at:number;thread_id:number|null;media_count:number}>(db,`
    SELECT p.id,a.username,p.body,p.created_at,p.thread_id,(SELECT count(*) FROM community_media m WHERE m.post_id=p.id) media_count
    FROM community_posts p JOIN member_accounts a ON a.id=p.author_id WHERE ${visible}
    ORDER BY p.id DESC LIMIT ? OFFSET ?`,feedSize+1,(page-1)*feedSize);
}
