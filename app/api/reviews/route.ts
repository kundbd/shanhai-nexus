import { NextResponse,type NextRequest } from "next/server";
import { formFields } from "@/lib/directory/admin-request";
import { directory } from "@/lib/directory/db";
import { discussionId,prepareReview,reviewMessages,reviewRequestAllowed,submitReview } from "@/lib/directory/reviews";
import { screenContent } from "@/lib/moderation/service";
import { accountEntryHref } from "@/lib/accounts/paths";
import { memberCookie,memberSession } from "@/lib/accounts/store";
import { discussionHref } from "@/lib/directory/community";
import { siteHref } from "@/lib/directory/types";

export async function POST(request:NextRequest) {
  const headers={"Cache-Control":"no-store"};
  const acceptsJson=request.headers.get("accept")?.includes("application/json");
  const errorResponse=(message:string,status:number)=>acceptsJson
    ? NextResponse.json({ok:false,message},{status,headers})
    : new Response(message,{status,headers});
  if (!reviewRequestAllowed(request)) return errorResponse("请求来源无效。",403);
  let fields:Record<string,string>;
  try { fields=await formFields(request,16_000); }
  catch { return errorResponse("评价格式无效。",400); }
  const slug=fields.site;
  if (!slug || slug.length>90 || !/^[a-z\d]+(?:-[a-z\d]+)*$/.test(slug)) return errorResponse("商家不存在。",404);
  const thread=discussionId(fields.thread);
  const target=thread?discussionHref(thread):siteHref(slug);
  const anchor=thread?"#thread":"#reviews";
  const token=request.cookies.get(memberCookie)?.value;
  function signIn() {
    const loginHref=accountEntryHref("login",target+anchor);
    return acceptsJson
      ? NextResponse.json({ok:false,message:"请登录后再提交。",loginHref},{status:401,headers})
      : new NextResponse(null,{status:303,headers:{...headers,Location:loginHref}});
  }
  if (!token) return signIn();
  try {
    const db=directory();
    const member=await memberSession(db,token,{verify:true});
    if (!member) return signIn();
    if(fields.company)return response("submitted");
    const candidate=prepareReview(db,slug,member.id,fields);
    if (candidate==="missing") return errorResponse("商家不存在。",404);
    if (typeof candidate==="string") return response(candidate);
    const assessment=await screenContent(db,member.id,"review",candidate.body);
    const outcome=submitReview(db,slug,member.id,fields,Date.now(),assessment);
    return outcome==="missing"?errorResponse("商家不存在。",404):response(outcome);
  } catch {
    return response("unavailable");
  }

  function response(outcome:keyof typeof reviewMessages) {
    const ok=outcome==="submitted";
    const status=ok?201:outcome==="muted"?403:outcome==="limited"?429:outcome==="duplicate"||outcome==="reply_duplicate"?409:outcome==="unavailable"?503:422;
    return acceptsJson
      ? NextResponse.json({ok,message:reviewMessages[outcome]}, {status,headers})
      : new NextResponse(null,{status:303,headers:{...headers,Location:`${target}?review=${outcome}${anchor}`}});
  }
}
