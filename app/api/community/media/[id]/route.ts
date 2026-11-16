import { sendCommunityMedia } from "@/lib/community/media-response";
import { publicCommunityMedia } from "@/lib/community/posts";

type Context={params:Promise<{id:string}>};

export async function GET(request:Request,{params}:Context) {
  const {id}=await params;
  return sendCommunityMedia(request,id,publicCommunityMedia(id));
}
export const HEAD=GET;
