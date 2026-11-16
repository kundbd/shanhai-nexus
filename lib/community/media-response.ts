import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { communityMediaPath,mediaRange,type MediaType } from "./media";

const cacheControl="private, no-store";
export const unavailableCommunityMedia=()=>new Response(null,{status:404,headers:{"Cache-Control":cacheControl}});

export async function sendCommunityMedia(request:Request,id:string,media:{content_type:MediaType;size_bytes:number}|undefined) {
  const file=communityMediaPath(id);
  if(!file||!media)return unavailableCommunityMedia();
  const info=await stat(file).catch(()=>undefined);
  if(!info?.isFile()||info.size!==media.size_bytes)return unavailableCommunityMedia();
  const headers={
    "Content-Type":media.content_type,"Cache-Control":cacheControl,"Accept-Ranges":"bytes","X-Content-Type-Options":"nosniff",
    "Content-Security-Policy":"default-src 'none'; sandbox",
  };
  const range=mediaRange(request.headers.get("range"),info.size);
  if(range===null)return new Response(null,{status:416,headers:{...headers,"Content-Range":`bytes */${info.size}`}});
  const responseHeaders=new Headers({...headers,"Content-Length":String(range?range.end-range.start+1:info.size)});
  if(range)responseHeaders.set("Content-Range",`bytes ${range.start}-${range.end}/${info.size}`);
  const body=request.method==="HEAD"?null:Readable.toWeb(createReadStream(file,range)) as ReadableStream<Uint8Array>;
  return new Response(body,{status:range?206:200,headers:responseHeaders});
}
