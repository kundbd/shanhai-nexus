"use client";

import { useId,useState,type FormEvent } from "react";

export function ReviewForm({slug,reply}:{slug:string;reply?:{thread:number;target:number}}) {
  const privacy=useId();
  const [sending,setSending]=useState(false);
  const [result,setResult]=useState<{ok:boolean;message:string;loginHref?:string}|null>(null);

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const form=event.currentTarget;
    const body=new URLSearchParams();
    for (const [key,value] of new FormData(form)) if (typeof value==="string") body.set(key,value);
    setSending(true);
    setResult(null);
    try {
      const response=await fetch(form.action,{method:"POST",headers:{Accept:"application/json"},body});
      const data=await response.json() as {ok:boolean;message:string;loginHref?:string};
      setResult(data);
      if (data.ok) form.reset();
    } catch {
      setResult({ok:false,message:"暂时无法提交，请稍后重试。"});
    } finally {
      setSending(false);
    }
  }

  return <form className="field-stack review-form" action="/api/reviews" method="post" onSubmit={submit}>
    <input type="hidden" name="site" value={slug}/>
    {reply&&<><input type="hidden" name="thread" value={reply.thread}/><input type="hidden" name="reply_to" value={reply.target}/></>}
    <div hidden><label>公司<input name="company" autoComplete="off" tabIndex={-1}/></label></div>
    {reply ? <p className="section-note">回复 #{reply.target} · 审核通过后公开。</p> : <>
      <p className="section-note">可打分、留言，或同时提交。评价通过审核后匿名公开。</p>
      <label>评分<select name="score" defaultValue=""><option value="">暂不评分</option>{[1,2,3,4,5].map((score)=><option key={score} value={score}>{score} 分</option>)}</select></label>
    </>}
    <label>{reply?"回复内容":"评论"}<textarea name="body" maxLength={1000} rows={reply?3:4} required={!!reply} placeholder={reply?"写下你的回复，最多 1000 字":"分享你的实际使用体验，最多 1000 字"} aria-describedby={privacy}/></label>
    <small id={privacy} className="section-note">请勿填写密码、订单号、联系方式等私人信息。</small>
    <button type="submit" className="button primary" disabled={sending}>{sending?"提交中…":reply?"提交回复":"提交评价"}</button>
    {result&&<p className={result.ok?"form-notice":"form-error"} role={result.ok?"status":"alert"}>{result.message}{result.loginHref&&<> <a className="text-link" href={result.loginHref}>重新登录</a></>}</p>}
  </form>;
}
