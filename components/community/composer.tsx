"use client";

import { useTranslations } from "@/components/site/language";

import Link from "next/link";
import { ImagePlus, X } from "lucide-react";
import { useRef,useState,type FormEvent } from "react";
import { maxPhotos,photoBytes,photoFormats,postLength,videoBytes,videoFormats } from "@/lib/community/limits";

export function PostComposer({username,loginHref,replyTo}:{username:string;loginHref:string;replyTo?:number}) {
  const t = useTranslations();
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

  async function submit(event:FormEvent<HTMLFormElement>) {
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
      const result=await response.json().catch(()=>({})) as {message?:string;pending?:boolean;removed?:boolean};
      if(result.pending||result.removed) {
        setBody("");
        setFiles([]);
      }
      if(response.ok&&result.pending) {
        setConfirmation(result.message??"已提交审核。");
        return;
      }
      setExpired(response.status===401);
      setNotice(result.message??(response.status===413?"附件超过上传大小限制。":"暂时无法提交，请稍后重试。"));
    } catch {
      setNotice("网络连接失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return <form className="social-composer field-stack" onSubmit={submit}>
    <label>{replyTo?t("写回复"):t("写帖子")}<textarea value={body} onChange={event=>setBody(event.target.value)}
      placeholder={replyTo?t("说说你的看法"):t("分享你的数字服务使用体验")} rows={3} maxLength={postLength*2} disabled={busy}/></label>
    <p className="section-note">{t("正文和附件审核通过后，将以 {username} 公开发布 · {length}/{limit}", { username, length, limit: postLength })}</p>
    {!!files.length&&<ul className="social-attachments">{files.map((file,index)=><li key={`${index}-${file.name}`}>
      <span>{file.name}</span><button type="button" className="social-action" aria-label={t("移除 {name}", { name: file.name })} disabled={busy}
        onClick={()=>setFiles(files.filter((_,item)=>item!==index))}><X size={15} aria-hidden="true"/></button>
    </li>)}</ul>}
    <div className="social-composer-buttons">
      <input type="file" ref={input} hidden multiple accept={[...photoFormats,...videoFormats].join(",")}
        onChange={event=>{selectFiles(event.target.files);event.target.value="";}}/>
      <button className="button" type="button" disabled={busy} onClick={()=>input.current?.click()}><ImagePlus size={16} aria-hidden="true"/>{" "}{t("照片或视频")}</button>
      <button className="button primary" type="submit" disabled={busy||length>postLength||(!body.trim()&&!files.length)}>{busy?t("提交中…"):replyTo?t("提交回复审核"):t("提交帖子审核")}</button>
    </div>
    <p className="section-note">{t("最多 4 张照片，每张 5 MB，或 1 段 24 MB 视频。")}</p>
    {notice&&<p className="form-error" role="alert">{t(notice)}{expired&&<> <Link className="text-link" href={loginHref}>{t("重新登录")}</Link></>}</p>}
    {confirmation&&<p className="section-note" role="status">{t(confirmation)}</p>}
  </form>;
}
