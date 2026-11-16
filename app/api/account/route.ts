import { NextResponse,type NextRequest } from "next/server";
import { accountDestination,accountEntryHref,accountMessages } from "@/lib/accounts/paths";
import { loginProviderMember,ProviderError,providerGuid,registerProviderMember,requestMemberCode,verifyProviderMember } from "@/lib/accounts/provider";
import { createMemberSession,memberCookie,memberSessionsEnabled,revokeMemberSession } from "@/lib/accounts/store";
import { formFields } from "@/lib/directory/admin-request";
import { directory } from "@/lib/directory/db";
import { sameOriginBrowserRequest } from "@/lib/site-request";

const noStore={"Cache-Control":"no-store"};
const redirect=(path:string)=>new NextResponse(null,{status:303,headers:{...noStore,Location:path}});
type Message=keyof typeof accountMessages;

export async function POST(request:NextRequest) {
  if (!sameOriginBrowserRequest(request)) return new Response("请求来源无效。",{status:403,headers:noStore});
  let fields:Record<string,string>;
  try { fields=await formFields(request,4096); }
  catch { return new Response("表单格式无效。",{status:400,headers:noStore}); }
  const {action,username="",password="",confirmation="",identifier="",next}=fields;
  const email=fields.email?.trim()??"";
  const previous=request.cookies.get(memberCookie)?.value;
  const secure=request.nextUrl.protocol==="https:"||request.headers.get("x-forwarded-proto")==="https";
  const cookie={path:"/",httpOnly:true,secure,sameSite:"lax" as const};
  const json=request.headers.get("accept")?.includes("application/json")||action==="email-code";
  if (action==="logout") {
    if (previous) await revokeMemberSession(directory(),previous);
    const response=redirect("/login");
    response.cookies.set(memberCookie,"",{...cookie,maxAge:0});
    return response;
  }
  if (action!=="register"&&action!=="login"&&action!=="email-code") return new Response("操作无效。",{status:400,headers:noStore});
  const resultLocation=(mode:"login"|"register",name:string,value:string)=>{
    const target=new URL(accountEntryHref(mode,next),"http://localhost");
    target.searchParams.set(name,value);
    return target.pathname+target.search;
  };
  const fail=(code:Message,status=400)=>json
    ? NextResponse.json({ok:false,message:accountMessages[code]},{status,headers:noStore})
    : redirect(resultLocation(action==="login"?"login":"register","error",code));
  if (!memberSessionsEnabled()) return fail("unavailable",503);
  if (action!=="login"&&(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return fail("invalid");
  try {
    if (action==="email-code") return NextResponse.json({ok:true,...await requestMemberCode(email)},{status:202,headers:noStore});
    if (action==="register") {
      if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)||password.length<12||password.length>128) return fail("invalid");
      if (password!==confirmation) return fail("mismatch");
      const {challenge,code}=fields;
      if ((challenge||code)&&(!providerGuid.test(challenge??"")||!/^\d{6}$/.test(code??""))) return fail("code");
      await registerProviderMember({username,email,password,...(challenge?{verificationChallengeId:challenge,verificationCode:code}:{})});
      const target=resultLocation("login","created","1");
      return json?NextResponse.json({ok:true,redirect:target},{status:201,headers:noStore}):redirect(target);
    }
    if (!identifier.trim()||identifier.length>254||password.length>128||!password) return fail("credentials",401);
    const tokens=await loginProviderMember(identifier.trim(),password);
    const identity=await verifyProviderMember(tokens.accessToken);
    const db=directory();
    const session=createMemberSession(db,identity,tokens);
    if (previous) await revokeMemberSession(db,previous);
    const response=redirect(accountDestination(next));
    response.cookies.set(memberCookie,session.token,{...cookie,maxAge:session.maxAge});
    return response;
  } catch (error) {
    if (!(error instanceof ProviderError)) return fail("unavailable",503);
    if (error.status===429) return fail("limited",429);
    if (action==="login"&&error.status===401) return fail("credentials",401);
    if (action==="register"&&error.status===409) return fail("taken",409);
    if (error.code==="InvalidVerificationCode"||error.code==="VerificationRequired") return fail("code");
    if (action!=="login"&&error.status===403) return fail("registration",403);
    if (error.status===400||error.status===422) return fail("invalid");
    return fail("unavailable",503);
  }
}
