"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark,Eye,Heart,MessageCircle,Repeat2,Trash2 } from "lucide-react";
import { useState } from "react";
import { postHref,type ReactionKind } from "@/lib/community/limits";
import { usePageView } from "@/components/site/page-traffic";

type Reactions={likes:number;reposts:number;liked:0|1;reposted:0|1;bookmarked:0|1};
const actions=[
  {kind:"like",label:"点赞",Icon:Heart,flag:"liked",count:"likes"},
  {kind:"repost",label:"转发",Icon:Repeat2,flag:"reposted",count:"reposts"},
  {kind:"bookmark",label:"收藏",Icon:Bookmark,flag:"bookmarked",count:null},
] as const;
const number=new Intl.NumberFormat("zh-CN");

export function PostActions({id,initial,replies,views,trackView,loginHref,signedIn,owner}:{id:number;initial:Reactions;replies:number;views:number;trackView?:boolean;loginHref:string;signedIn:boolean;owner:boolean}) {
  const router=useRouter();
  const liveViews=usePageView(trackView?postHref(id):null);
  const [update,setUpdate]=useState<{before:Reactions;after:Reactions}>();
  const reactions=update?.before===initial?update.after:initial;
  const [busy,setBusy]=useState<ReactionKind|"remove"|null>(null);
  const [notice,setNotice]=useState("");
  const [expired,setExpired]=useState(false);

  async function change(kind:ReactionKind|"remove",active=true) {
    if(busy)return;
    if(kind==="remove"&&!window.confirm("确定删除这条帖子？"))return;
    setBusy(kind);
    setNotice("");
    setExpired(false);
    try {
      const response=await fetch("/api/community/actions",{
        method:"POST",body:new URLSearchParams({post:String(id),kind,active:active?"yes":"no"}),
      });
      const result=await response.json() as {href?:string;message?:string;reactions?:Reactions};
      if(!response.ok) {
        setExpired(response.status===401);
        setNotice(result.message??"暂时无法完成操作。");
        return;
      }
      if(result.reactions)setUpdate({before:initial,after:result.reactions});
      if(result.href?.startsWith("/community"))window.location.assign(result.href);
      else router.refresh();
    } catch { setNotice("网络连接失败，请稍后重试。"); }
    finally { setBusy(null); }
  }

  return <><div className="social-actions" aria-label="帖子操作">
    <Link className="social-action" href={`${postHref(id)}#reply`}><MessageCircle size={17} aria-hidden="true"/> 回复 <span>{replies}</span></Link>
    {actions.map(({kind,label,Icon,flag,count})=>{
      const contents=<><Icon size={17} aria-hidden="true"/> {label}{count&&<> <span>{reactions[count]}</span></>}</>;
      return signedIn?<button key={kind} type="button" className="social-action" aria-pressed={!!reactions[flag]} disabled={busy!==null}
        onClick={()=>void change(kind,!reactions[flag])}>{contents}</button>:
        <Link key={kind} className="social-action" prefetch={false} href={loginHref}>{contents}</Link>;
    })}
    <span className="social-views"><Eye size={17} aria-hidden="true"/> 浏览 {number.format(Math.max(views,liveViews??0))}</span>
    {owner&&<button className="social-action social-remove" type="button" aria-label="删除帖子" disabled={busy!==null} onClick={()=>void change("remove")}><Trash2 size={16} aria-hidden="true"/></button>}
  </div>
  {notice&&<p className="form-error" role="alert">{notice}{expired&&<> <Link className="text-link" href={loginHref}>重新登录</Link></>}</p>}</>;
}
