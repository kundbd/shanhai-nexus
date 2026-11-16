import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { communityMediaPath,mediaRange } from "@/lib/community/media";
import { publicCommunityMedia } from "@/lib/community/posts";

type Context={params:Promise<{id:string}>};
const missing=()=>new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});

async function send(request:Request,{params}:Context,head:boolean) {
  const {id}=await params;
  const file=communityMediaPath(id);
  if(!file)return missing();
  const media=publicCommunityMedia(id);
  if(!media)return missing();
  const info=await stat(file).catch(()=>undefined);
  if(!info?.isFile()||info.size!==media.size_bytes)return missing();
  const headers={
    "Content-Type":media.content_type,"Cache-Control":"no-store","Accept-Ranges":"bytes","X-Content-Type-Options":"nosniff",
    "Content-Security-Policy":"default-src 'none'; sandbox",
  };
  const range=mediaRange(request.headers.get("range"),info.size);
  if(range===null)return new Response(null,{status:416,headers:{...headers,"Content-Range":`bytes */${info.size}`}});
  const responseHeaders=new Headers({...headers,"Content-Length":String(range?range.end-range.start+1:info.size)});
  if(range)responseHeaders.set("Content-Range",`bytes ${range.start}-${range.end}/${info.size}`);
  const body=head?null:Readable.toWeb(createReadStream(file,range)) as ReadableStream<Uint8Array>;
  return new Response(body,{status:range?206:200,headers:responseHeaders});
}

export function GET(request:Request,context:Context) { return send(request,context,false); }
export function HEAD(request:Request,context:Context) { return send(request,context,true); }
