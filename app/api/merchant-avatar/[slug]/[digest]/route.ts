import { directory } from "@/lib/directory/db";
import { findMerchantAvatar } from "@/lib/directory/merchant-avatar";

export async function GET(request:Request,{params}:{params:Promise<{slug:string;digest:string}>}) {
  const {slug,digest}=await params;
  const avatar=/^[a-z0-9-]{1,90}$/.test(slug)&&/^[0-9a-f]{64}$/.test(digest)
    ?findMerchantAvatar(directory(),slug,digest):undefined;
  if (!avatar) return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});
  const etag=`"${digest}"`;
  const headers={"Content-Type":avatar.content_type,"Cache-Control":"public, max-age=86400, immutable","ETag":etag,
    "X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"};
  if (request.headers.get("if-none-match")===etag) return new Response(null,{status:304,headers});
  return new Response(new Uint8Array(avatar.image),{headers});
}
