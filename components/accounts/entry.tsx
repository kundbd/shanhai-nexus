import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentMember } from "@/lib/accounts/current";
import { accountDestination,accountEntryHref,accountMessages } from "@/lib/accounts/paths";
import { memberRegistrationPolicy } from "@/lib/accounts/provider";
import { memberSessionsEnabled } from "@/lib/accounts/store";
import { RegisterForm } from "./register-form";

export type MemberEntryProps={searchParams:Promise<{next?:string|string[];error?:string|string[];created?:string|string[]}>};

export async function MemberEntry({mode,input}:{mode:"login"|"register";input:Awaited<MemberEntryProps["searchParams"]>}) {
  const t = await getTranslations();
  const next=accountDestination(typeof input.next==="string"?input.next:undefined);
  if (await currentMember()) redirect(next);
  const creating=mode==="register";
  const available=memberSessionsEnabled();
  const policy=creating&&available?await memberRegistrationPolicy().catch(()=>undefined):undefined;
  const error=typeof input.error==="string"&&Object.hasOwn(accountMessages,input.error)?accountMessages[input.error as keyof typeof accountMessages]:undefined;
  return <div className="frame page narrow account-page">
    <div className="catalog-heading"><h1>{creating?t("注册账号"):t("登录山海知序")}</h1>
      <p>{creating?t("通过 FILEBOX 统一账号服务注册。"):t("使用现有 FILEBOX 账号登录，登录后即可评论、打分和回复。")}</p></div>
    {error&&<p className="form-error" role="alert">{t(error)}</p>}
    {!creating&&input.created==="1"&&<p className="form-notice" role="status">{t("注册成功，请登录。")}</p>}
    {!available?<p className="plain-empty">{t("账号服务暂时不可用。")}</p>:creating?
      policy?.enabled?<RegisterForm next={next} verification={policy.emailVerificationRequired}/>:<p className="plain-empty">{t("当前暂无法注册，请稍后再试。")}</p>:
      <form className="field-stack account-form" action="/api/account" method="post">
        <input type="hidden" name="action" value="login"/>
        <input type="hidden" name="next" value={next}/>
        <label>{t("用户名或邮箱")}<input name="identifier" required maxLength={254} autoComplete="username" autoCapitalize="none" spellCheck={false}/></label>
        <label>{t("密码")}<input name="password" type="password" required maxLength={128} autoComplete="current-password"/></label>
        <button type="submit" className="button primary">{t("登录")}</button>
      </form>}
    <p className="account-alternate">{creating?t("已有账号？"):t("还没有账号？")} <Link className="text-link" href={accountEntryHref(creating?"login":"register",next)}>{creating?t("去登录"):t("立即注册")}</Link></p>
  </div>;
}
