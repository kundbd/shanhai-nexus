"use client";

import Link from "next/link";
import { ImagePlus, X } from "lucide-react";
import { useRef,useState,type FormEvent } from "react";
import { maxPhotos,photoBytes,photoFormats,postLength,videoBytes,videoFormats } from "@/lib/community/limits";

export function PostComposer({username,loginHref,replyTo}:{username:string;loginHref:string;replyTo?:number}) {
  const input=useRef<HTMLInputElement>(null);
  const [body,setBody]=useState("");
  const [files,setFiles]=useState<File[]>([]);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [confirmation,setConfirmation]=useState("");
  const [expired,setExpired]=useState(false);
  const length=Array.from(body).length;

  function selectFiles(selected:FileList|null) {
    if(!selected?.length)return;
    const next=[...files,...Array.from(selected)];
    const includesVideo=next.some(file=>videoFormats.includes(file.type));
    if(next.some(file=>![...photoFormats,...videoFormats].includes(file.type))) {
      setNotice("请选择 JPG、PNG、WebP 照片或 MP4、WebM 视频。");
    } else if(next.length>maxPhotos||(includesVideo&&next.length!==1)) {
      setNotice("每条帖子可添加 4 张照片或 1 段视频。");
    } else if(next.some(file=>file.size>(includesVideo?videoBytes:photoBytes))) {
      setNotice("每张照片最多 5 MB，视频最多 24 MB。");
    } else {
      setFiles(next);
      setNotice("");
    }
  }

  async function publish(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(busy||(!body.trim()&&!files.length)||length>postLength)return;
    const form=new FormData();
    form.set("body",body);
    if(replyTo)form.set("replyTo",String(replyTo));
    for(const file of files)form.append("media",file);
    setBusy(true);
    setNotice("");
    setConfirmation("");
    setExpired(false);
    try {
      const response=await fetch("/api/community/posts",{method:"POST",body:form});
      const result=await response.json().catch(()=>({})) as {href?:string;message?:string;pending?:boolean;removed?:boolean};
      if(response.ok&&result.href?.startsWith("/community/posts/")) {
        window.location.assign(result.href);
        return;
      }
      if(result.pending||result.removed) {
        setBody("");
        setFiles([]);
      }
      if(response.ok&&result.pending) {
        setConfirmation(result.message??"已提交人工复核。");
        return;
      }
      setExpired(response.status===401);
      setNotice(result.message??(response.status===413?"附件超过上传大小限制。":"暂时无法发布，请稍后重试。"));
    } catch {
      setNotice("网络连接失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return <form className="social-composer field-stack" onSubmit={publish}>
    <label>{replyTo?"写回复":"写帖子"}<textarea value={body} onChange={event=>setBody(event.target.value)}
      placeholder={replyTo?"说说你的看法":"分享你的数字服务使用体验"} rows={3} maxLength={postLength*2} disabled={busy}/></label>
    <p className="section-note">将以 {username} 公开发布 · {length}/{postLength}</p>
    {!!files.length&&<ul className="social-attachments">{files.map((file,index)=><li key={`${index}-${file.name}`}>
      <span>{file.name}</span><button type="button" className="social-action" aria-label={`移除 ${file.name}`} disabled={busy}
        onClick={()=>setFiles(files.filter((_,item)=>item!==index))}><X size={15} aria-hidden="true"/></button>
    </li>)}</ul>}
    <div className="social-composer-buttons">
      <input type="file" ref={input} hidden multiple accept={[...photoFormats,...videoFormats].join(",")}
        onChange={event=>{selectFiles(event.target.files);event.target.value="";}}/>
      <button className="button" type="button" disabled={busy} onClick={()=>input.current?.click()}><ImagePlus size={16} aria-hidden="true"/> 照片或视频</button>
      <button className="button primary" type="submit" disabled={busy||length>postLength||(!body.trim()&&!files.length)}>{busy?"发布中…":replyTo?"发布回复":"发布帖子"}</button>
    </div>
    <p className="section-note">最多 4 张照片，每张 5 MB，或 1 段 24 MB 视频。</p>
    {notice&&<p className="form-error" role="alert">{notice}{expired&&<> <Link className="text-link" href={loginHref}>重新登录</Link></>}</p>}
    {confirmation&&<p className="section-note" role="status">{confirmation}</p>}
  </form>;
}
