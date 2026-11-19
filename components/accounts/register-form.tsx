"use client";

import { useTranslations } from "@/components/site/language";

import Link from "next/link";
import { useEffect,useRef,useState,type FormEvent } from "react";

type Reply={ok:boolean;message?:string;challengeId?:string;resendAfterSeconds?:number;redirect?:string};
async function request(body:URLSearchParams) {
  const response=await fetch("/api/account",{method:"POST",headers:{Accept:"application/json"},body});
  return await response.json() as Reply;
}

export function RegisterForm({next,verification}:{next:string;verification:boolean}) {
  const t = useTranslations();
  const emailInput=useRef<HTMLInputElement>(null);
  const [challenge,setChallenge]=useState<{id:string;email:string}>();
  const [seconds,setSeconds]=useState(0);
  const [busy,setBusy]=useState<"code"|"register"|null>(null);
  const [notice,setNotice]=useState<{ok:boolean;text:string}>();
  useEffect(()=>{
    if (seconds<=0) return;
    const timer=window.setTimeout(()=>setSeconds(seconds-1),1000);
    return ()=>window.clearTimeout(timer);
  },[seconds]);

  async function sendCode() {
    const input=emailInput.current;
    if (busy||seconds>0||!input?.reportValidity()) return;
    const email=input.value.trim().toLowerCase();
    setBusy("code");
    setNotice(undefined);
    try {
      const result=await request(new URLSearchParams({action:"email-code",email}));
      if (!result.ok||!result.challengeId) {
        setNotice({ok:false,text:result.message??"暂时无法发送验证码。"});
        return;
      }
      setChallenge({id:result.challengeId,email});
      setSeconds(result.resendAfterSeconds??60);
      setNotice({ok:true,text:"验证码发送请求已受理，请查看邮箱。"});
    } catch {
      setNotice({ok:false,text:"暂时无法发送验证码，请稍后重试。"});
    } finally {
      setBusy(null);
    }
  }

  async function register(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form=new FormData(event.currentTarget);
    const body=new URLSearchParams();
    for (const [name,value] of form) if (typeof value==="string") body.set(name,value);
    if (verification) {
      if (!challenge||challenge.email!==body.get("email")?.trim().toLowerCase()) {
        setNotice({ok:false,text:"请先为当前邮箱获取验证码。"});
        return;
      }
      body.set("challenge",challenge.id);
    }
    setBusy("register");
    setNotice(undefined);
    try {
      const result=await request(body);
      if (result.ok&&result.redirect?.startsWith("/login?")) {window.location.assign(result.redirect);return;}
      setNotice({ok:false,text:result.message??"暂时无法注册，请稍后重试。"});
    } catch {
      setNotice({ok:false,text:"暂时无法注册，请稍后重试。"});
    } finally {
      setBusy(null);
    }
  }

  return <form className="field-stack account-form" action="/api/account" method="post" onSubmit={register}>
    <input type="hidden" name="action" value="register"/>
    <input type="hidden" name="next" value={next}/>
    <label>{t("用户名")}<input name="username" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]{3,32}" autoComplete="username" autoCapitalize="none" spellCheck={false}/></label>
    <label>{t("邮箱")}<input type="email" ref={emailInput} name="email" required maxLength={254} autoComplete="email"/></label>
    {verification&&<div className="account-code">
      <label>{t("邮箱验证码")}<input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}/></label>
      <button className="button" type="button" disabled={busy!==null||seconds>0} onClick={sendCode}>{busy==="code"?t("发送中…"):seconds>0?t("{seconds} 秒后重发", { seconds }):t("获取验证码")}</button>
    </div>}
    <label>{t("密码")}<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>
    <label>{t("确认密码")}<input name="confirmation" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>
    <p className="section-note">{t("用户名使用 3–32 位英文字母、数字或下划线。密码至少 12 个字符。")}</p>
    <p className="section-note">{t("评论以匿名用户名义公开。")}<Link className="text-link" href="/policy#privacy">{t("隐私说明")}</Link></p>
    {notice&&<p role={notice.ok?"status":"alert"} className={notice.ok?"form-notice":"form-error"}>{t(notice.text)}</p>}
    <button type="submit" className="button primary" disabled={busy!==null}>{busy==="register"?t("注册中…"):t("注册")}</button>
  </form>;
}
