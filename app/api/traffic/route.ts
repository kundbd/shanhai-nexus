import { directory } from "@/lib/directory/db";
import { recordPageView } from "@/lib/directory/traffic";
import { sameOriginBrowserRequest } from "@/lib/site-request";
import { isTrafficPath,trafficPathLimit } from "@/lib/traffic-path";

const reply=(status:number)=>new Response(null,{status,headers:{"Cache-Control":"no-store"}});
const capacity=1_200;
let currentMinute=-1;
let requests=0;

async function readPage(request:Request) {
  const reader=request.body?.getReader();
  if (!reader) return;
  const decoder=new TextDecoder();
  let size=0;
  let page="";
  try {
    for (;;) {
      const {value,done}=await reader.read();
      if (done) return page+decoder.decode();
      size+=value.byteLength;
      if (size>trafficPathLimit) {
        await reader.cancel();
        return;
      }
      page+=decoder.decode(value,{stream:true});
    }
  } finally { reader.releaseLock(); }
}

export async function POST(request:Request) {
  if (!sameOriginBrowserRequest(request)) return reply(403);
  if (new URL(request.url).search) return reply(400);
  if (request.headers.get("content-type")?.split(";",1)[0].trim()!=="text/plain") return reply(415);
  if (Number(request.headers.get("content-length"))>trafficPathLimit) return reply(413);
  const now=Date.now();
  const minute=Math.floor(now/60_000);
  if (minute!==currentMinute) { currentMinute=minute;requests=0; }
  if (requests>=capacity) return reply(429);
  requests++;
  let page:string|undefined;
  try { page=await readPage(request); } catch { return reply(400); }
  if (!page || !isTrafficPath(page)) return reply(400);
  try {
    const recorded=recordPageView(directory(),page,now);
    if(typeof recorded==="object")return Response.json(recorded,{headers:{"Cache-Control":"no-store"}});
    return reply(recorded?204:404);
  }
  catch { return reply(503); }
}
