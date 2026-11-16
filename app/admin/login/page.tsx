import type { Metadata } from "next";
import { adminEnabled } from "@/lib/directory/auth";
import { Notice } from "@/components/directory/admin";
import type { Params } from "@/components/directory/catalog-page";

export const dynamic = "force-dynamic";
export const metadata:Metadata = {title:"编辑登录",robots:{index:false,follow:false}};
export default async function Login({searchParams}:{searchParams:Promise<Params>}) {
  const input=await searchParams;
  return <div className="frame page article admin-page"><div className="catalog-heading"><h1>编辑登录</h1></div><Notice input={input}/>
    {adminEnabled() ? <form className="field-stack" action="/api/admin/session" method="post">
      <label>用户名<input name="username" required maxLength={80} autoComplete="username"/></label>
      <label>密码<input name="password" type="password" required maxLength={400} autoComplete="current-password"/></label>
      <button type="submit" className="button primary">登录后台</button></form> : <p className="plain-empty">编辑后台尚未配置。请通过服务端环境变量启用。</p>}
  </div>;
}
