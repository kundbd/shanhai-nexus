import type { NextRequest } from "next/server";
import { sendCommunityMedia,unavailableCommunityMedia } from "@/lib/community/media-response";
import { pendingCommunityMedia } from "@/lib/community/posts";
import { adminActor,sessionCookie } from "@/lib/directory/auth";

type Context={params:Promise<{id:string}>};

export async function GET(request:NextRequest,{params}:Context) {
  if(!adminActor(request.cookies.get(sessionCookie)?.value))return unavailableCommunityMedia();
  const {id}=await params;
  return sendCommunityMedia(request,id,pendingCommunityMedia(id));
}
export const HEAD=GET;
