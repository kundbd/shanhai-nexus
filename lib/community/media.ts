import { randomUUID } from "node:crypto";
import { mkdir,unlink,writeFile } from "node:fs/promises";
import { dirname,join,resolve } from "node:path";
import sharp from "sharp";
import { CommunityError,maxPhotos,photoBytes,requestBytes,videoBytes } from "./limits";

export type MediaType="image/webp"|"video/mp4"|"video/webm";
export type MediaFile={id:string;mime:MediaType;bytes:number};
const mediaId=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const invalid="支持 JPG、PNG、WebP 图片，以及 MP4 或 WebM 视频。";

export function communityMediaPath(id:string) {
  if (!mediaId.test(id)) return undefined;
  return join(dirname(resolve(process.env.DB_PATH||"data/directory.sqlite")),"community-media",id);
}

export async function readPostForm(request:Request) {
  const type=request.headers.get("content-type")??"";
  if (!/^multipart\/form-data\s*;/i.test(type)||!request.body) throw new CommunityError("发帖表单格式无效。");
  if (Number(request.headers.get("content-length"))>requestBytes) throw new CommunityError("附件总大小超过 24 MB。",413);
  let received=0;
  const bounded=request.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
    transform(chunk,controller) {
      received+=chunk.byteLength;
      if (received>requestBytes) throw new CommunityError("附件总大小超过 24 MB。",413);
      controller.enqueue(chunk);
    },
  }));
  try { return await new Response(bounded,{headers:{"Content-Type":type}}).formData(); }
  catch (error) { if (error instanceof CommunityError) throw error; throw new CommunityError("发帖表单格式无效。"); }
}

type Box={type:string;start:number;end:number};
function* boxes(data:Buffer,start=0,end=data.length):Generator<Box> {
  for(let n=0;n<4096&&start+8<=end;n++) {
    const size=data.readUInt32BE(start);
    const type=data.toString("ascii",start+4,start+8);
    const header=size===1?16:8;
    if(start+header>end)return;
    const length=size===1?Number(data.readBigUInt64BE(start+8)):size===0?end-start:size;
    if(!Number.isSafeInteger(length)||length<header||length>end-start)return;
    yield {type,start:start+header,end:start+length};
    start+=length;
  }
}

function isMp4Video(data:Buffer) {
  if (data.length<20||data.toString("ascii",4,8)!=="ftyp"||data.toString("ascii",8,12)==="qt  ") return false;
  const topLevel=[...boxes(data)];
  if(!topLevel.some(box=>box.type==="mdat"&&box.end>box.start))return false;
  for(const box of topLevel) {
    if(box.type!=="moov")continue;
    for(const track of boxes(data,box.start,box.end)) {
      if(track.type!=="trak")continue;
      for(const media of boxes(data,track.start,track.end)) {
        if(media.type!=="mdia")continue;
        for(const handler of boxes(data,media.start,media.end)) {
          if(handler.type==="hdlr"&&handler.start+12<=handler.end&&data.toString("ascii",handler.start+8,handler.start+12)==="vide") return true;
        }
      }
    }
  }
  return false;
}

function videoType(data:Buffer):MediaType|undefined {
  if(data.length>32&&data.readUInt32BE(0)===0x1a45dfa3&&
     data.subarray(4,256).includes(Buffer.from([0x42,0x82,0x84,0x77,0x65,0x62,0x6d]))&&
     data.subarray(0,65_536).includes(Buffer.from([0x83,0x81,0x01]))&&
     data.includes(Buffer.from([0x1f,0x43,0xb6,0x75]))) return "video/webm";
  if(isMp4Video(data))return "video/mp4";
}

export async function discardCommunityFiles(ids:readonly string[]) {
  await Promise.all(ids.map(id=>{const path=communityMediaPath(id);return path?unlink(path).catch(()=>{}):undefined;}));
}

export async function saveCommunityFiles(files:readonly File[]) {
  if (files.length>maxPhotos) throw new CommunityError("每条帖子最多附 4 张图片或 1 段视频。");
  const saved:MediaFile[]=[];
  try {
    for (const file of files) {
      if (!file.size||file.size>videoBytes) throw new CommunityError("附件为空或超过 24 MB。",413);
      const source=Buffer.from(await file.arrayBuffer());
      const video=videoType(source);
      if(video&&files.length!==1)throw new CommunityError("视频需单独上传。");
      let data=source;
      const mime=video??"image/webp";
      if(!video) {
        if(source.length>photoBytes)throw new CommunityError("每张图片最大 5 MB。",413);
        try {
          const image=sharp(source,{limitInputPixels:20_000_000});
          const {format}=await image.metadata();
          if(!format||!["jpeg","png","webp"].includes(format))throw new Error("format");
          data=await image.rotate().resize({width:1600,height:1600,fit:"inside",withoutEnlargement:true}).webp({quality:84}).toBuffer();
        } catch { throw new CommunityError(invalid); }
      }
      const id=randomUUID();
      const path=communityMediaPath(id)!;
      await mkdir(dirname(path),{recursive:true,mode:0o750});
      // Register the file for cleanup even if a failed write leaves a partial file.
      saved.push({id,mime,bytes:data.byteLength});
      await writeFile(path,data,{flag:"wx",mode:0o640});
    }
    return saved;
  } catch (error) {
    await discardCommunityFiles(saved.map(file=>file.id));
    throw error;
  }
}

export function mediaRange(value:string|null,length:number) {
  if(!value)return undefined;
  const match=/^bytes=(\d*)-(\d*)$/.exec(value);
  if(!match||(!match[1]&&!match[2]))return null;
  const start=match[1]?Number(match[1]):Math.max(0,length-Number(match[2]));
  const end=match[1]&&match[2]?Math.min(length-1,Number(match[2])):length-1;
  return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<length&&start<=end?{start,end}:null;
}
