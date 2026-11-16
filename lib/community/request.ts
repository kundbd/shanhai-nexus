import type { NextRequest } from "next/server";
import { memberCookie,memberSession } from "@/lib/accounts/store";
import { directory } from "@/lib/directory/db";
import { sameOriginBrowserRequest } from "@/lib/site-request";
import { CommunityError } from "./limits";

const headers={"Cache-Control":"no-store"};

export async function requireCommunityMember(request:NextRequest) {
  if(!sameOriginBrowserRequest(request))throw new CommunityError("请求来源无效。",403);
  const token=request.cookies.get(memberCookie)?.value;
  if(!token)throw new CommunityError("请登录后再操作。",401);
  const db=directory();
  const member=await memberSession(db,token,{verify:true});
  if(!member)throw new CommunityError("请登录后再操作。",401);
  return {db,member};
}

export function communityResponse(data:Record<string,unknown>,status=200) {
  return Response.json(data,{status,headers});
}

export function communityFailure(error:unknown) {
  return error instanceof CommunityError
    ? communityResponse({message:error.message},error.status)
    : communityResponse({message:"暂时无法完成操作，请稍后重试。"},503);
}
