import { lookup } from "node:dns/promises";
import { Agent as HttpAgent, request as http } from "node:http";
import { Agent as HttpsAgent, request as https } from "node:https";
import { createConnection, type Socket } from "node:net";
import { connect as tls } from "node:tls";
import { createGunzip } from "node:zlib";
import ipaddr from "ipaddr.js";
import { SocksClient } from "socks";

export type NetworkCode="dns_timeout"|"connect_timeout"|"headers_timeout"|"read_timeout"|"total_timeout"|"dns"|"tls"|"network"|"reset"|"proxy_connect"|"proxy_policy"|"config"|"address_policy";
type FailureStage="dns"|"connect"|"headers"|"read";
export class NetworkFailure extends Error {
  constructor(readonly code:NetworkCode,readonly stage:FailureStage,readonly status?:number) {
    super(`[${code}] ${code.endsWith("_timeout")?"超时":code}${status===undefined?"":` HTTP ${status}`}`);
  }
}

export type ProxyRoute={scheme:"http"|"https"|"socks5";host:string;port:number;username:string;password:string};
export function parseProxy(value:string|undefined):ProxyRoute|undefined {
  if (!value?.trim()) return undefined;
  try {
    const url=new URL(value.trim());
    const scheme=url.protocol.slice(0,-1);
    if ((scheme!=="http"&&scheme!=="https"&&scheme!=="socks5")||!url.hostname||url.search||url.hash||(url.pathname&&url.pathname!=="/")) {
      throw new Error("unsupported proxy URL");
    }
    const port=Number(url.port||({http:80,https:443,socks5:1080} as const)[scheme]);
    if (port<1) throw new Error("invalid proxy port");
    return {scheme,host:plainHost(url.hostname),port,username:decodeURIComponent(url.username),password:decodeURIComponent(url.password)};
  } catch { throw new NetworkFailure("config","connect"); }
}

const plainHost=(value:string)=>value.replace(/^\[|\]$/g,"");
const authority=(host:string,port:number)=>`${host.includes(":")?`[${host}]`:host}:${port}`;
const timeoutCode:Record<FailureStage,NetworkCode>={dns:"dns_timeout",connect:"connect_timeout",headers:"headers_timeout",read:"read_timeout"};
const deadlines={dns:2800,connect:4500,headers:6500,read:4500};
export const retryableNetworkCodes=new Set<NetworkCode>(["dns_timeout","connect_timeout","headers_timeout","read_timeout","reset"]);

function phaseError(error:unknown,stage:FailureStage,overall:AbortSignal,phase:AbortSignal):NetworkFailure {
  if (error instanceof NetworkFailure) return error;
  if (overall.aborted) return new NetworkFailure("total_timeout",stage);
  const code=error && typeof error==="object" && "code" in error?String(error.code):"";
  if (phase.aborted||code==="ETIMEDOUT") return new NetworkFailure(timeoutCode[stage],stage);
  if (stage==="dns") return new NetworkFailure("dns",stage);
  if (/CERT|TLS|SSL|SELF_SIGNED|VERIFY_LEAF_SIGNATURE/.test(code)) return new NetworkFailure("tls",stage);
  return new NetworkFailure(code==="ECONNRESET"?"reset":"network",stage);
}

function bounded<T>(promise:Promise<T>,signal:AbortSignal):Promise<T> {
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason);
    if (signal.aborted) abort(); else signal.addEventListener("abort",abort,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));
  });
}

function isPublic(value:string) {
  const addr=ipaddr.process(value);
  return addr.range()==="unicast" && (!(addr instanceof ipaddr.IPv6)||addr.match(ipaddr.IPv6.parse("2000::"),3));
}

async function resolvePublic(host:string,overall:AbortSignal) {
  const phase=AbortSignal.timeout(deadlines.dns);
  try {
    const addresses=await bounded(lookup(host,{all:true}),AbortSignal.any([overall,phase]));
    if (!addresses.length||addresses.some(({address})=>!isPublic(address))) throw new NetworkFailure("address_policy","dns");
    return (addresses.find(address=>address.family===4)??addresses[0]).address;
  } catch (err) { throw phaseError(err,"dns",overall,phase); }
}

function readySocket<T extends Socket>(socket:T,event:"connect"|"secureConnect",signal:AbortSignal) {
  return new Promise<T>((resolve,reject)=>{
    const cleanup=()=>{signal.removeEventListener("abort",abort); socket.off(event,connected);socket.off("error",failed);};
    const failed=(error:unknown)=>{cleanup();socket.destroy();reject(error);};
    const abort=()=>failed(signal.reason);
    const connected=()=>{cleanup();resolve(socket);};
    socket.once("error",failed);
    socket.once(event,connected);
    if (signal.aborted) abort();else signal.addEventListener("abort",abort,{once:true});
  });
}

function httpTunnel(proxy:ProxyRoute,address:string,port:number,signal:AbortSignal) {
  return new Promise<Socket>((resolve,reject)=>{
    const target=authority(address,port);
    const credentials=proxy.username||proxy.password?`Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`:undefined;
    const req=(proxy.scheme==="https"?https:http)({host:proxy.host,port:proxy.port,method:"CONNECT",path:target,agent:false,signal,rejectUnauthorized:true,
      headers:{Host:target,...(credentials?{"Proxy-Authorization":credentials}:{})}});
    req.once("connect",(response,socket,head)=>{
      if (response.statusCode!==200) {
        socket.destroy();reject(new NetworkFailure("proxy_policy","connect",response.statusCode));return;
      }
      if (head.length) socket.unshift(head);
      resolve(socket);
    });
    req.once("error",reject);
    req.end();
  });
}

async function socksTunnel(proxy:ProxyRoute,address:string,port:number,signal:AbortSignal) {
  const tcp=await readySocket(createConnection({host:proxy.host,port:proxy.port}),"connect",signal);
  try {
    const negotiated=await bounded(SocksClient.createConnection({proxy:{host:proxy.host,port:proxy.port,type:5,userId:proxy.username,password:proxy.password},
      destination:{host:address,port},command:"connect",timeout:deadlines.connect,existing_socket:tcp}),signal);
    return negotiated.socket;
  } catch {
    tcp.destroy();
    signal.throwIfAborted();
    throw new NetworkFailure("proxy_policy","connect");
  }
}

async function connectOrigin(url:URL,address:string,proxy:ProxyRoute|undefined,overall:AbortSignal) {
  const phase=AbortSignal.timeout(deadlines.connect);
  const signal=AbortSignal.any([overall,phase]);
  const secure=url.protocol==="https:";
  const port=Number(url.port||(secure?443:80));
  let socket;
  try {
    socket=proxy?(proxy.scheme==="socks5"?await socksTunnel(proxy,address,port,signal):await httpTunnel(proxy,address,port,signal))
      :await readySocket(createConnection({host:address,port}),"connect",signal);
  } catch (error) {
    const failure=phaseError(error,"connect",overall,phase);
    if (proxy && (failure.code==="network"||failure.code==="reset")) throw new NetworkFailure("proxy_connect","connect");
    throw failure;
  }
  if (!secure) return socket;
  try { return await readySocket(tls({socket,servername:plainHost(url.hostname),host:plainHost(url.hostname),rejectUnauthorized:true}),"secureConnect",signal); }
  catch (error) { throw phaseError(error,"connect",overall,phase); }
}

type Options={method?:"GET"|"POST";body?:string;headers?:Record<string,string>;maxBytes:number;signal:AbortSignal;proxy?:ProxyRoute;compressed?:boolean};
type NetworkResponse<T> = {status:number;location?:string;body:T;contentType:string;truncated:boolean};
export function requestPublicNetwork(url:URL,options:Options&{binary:true}):Promise<NetworkResponse<Buffer>>;
export function requestPublicNetwork(url:URL,options:Options&{binary?:false}):Promise<NetworkResponse<string>>;
export async function requestPublicNetwork(url:URL,options:Options&{binary?:boolean}) {
  const {signal:overall,proxy,maxBytes}=options;
  if (!(["https:","http:"].includes(url.protocol))||url.username||url.password) throw new NetworkFailure("address_policy","dns");
  const address=await resolvePublic(plainHost(url.hostname),overall);
  const socket=await connectOrigin(url,address,proxy,overall);
  const secure=url.protocol==="https:";
  const agent=secure?new HttpsAgent({keepAlive:false}):new HttpAgent({keepAlive:false});
  agent.createConnection=()=>socket;
  const decode=(body:Buffer)=>options.binary?body:body.toString("utf8");
  return new Promise<NetworkResponse<string|Buffer>>((resolve,reject)=>{
    let stage:FailureStage="headers";
    let timedOut=false;
    let timer:ReturnType<typeof setTimeout>;
    let finished=false;
    const finish=(error?:unknown,result?:Parameters<typeof resolve>[0])=>{
      if (finished) return;
      finished=true;clearTimeout(timer);
      if (error) reject(timedOut?new NetworkFailure(timeoutCode[stage],stage):overall.aborted?new NetworkFailure("total_timeout",stage):phaseError(error,stage,overall,overall));
      else resolve(result!);
      agent.destroy();
    };
    const arm=()=>{
      clearTimeout(timer);
      timer=setTimeout(()=>{timedOut=true;req.destroy(new Error("phase timeout"));},deadlines[stage as "headers"|"read"]);
      timer.unref();
    };
    const req=(secure?https:http)(url,{agent,signal:overall,method:options.method??"GET",
      headers:{...options.headers,"Accept-Encoding":options.compressed?"gzip":"identity",...(options.body?{"Content-Length":String(Buffer.byteLength(options.body))}:{})}},res=>{
      const info={status:res.statusCode??0,location:res.headers.location,contentType:res.headers["content-type"]??""};
      if (info.status<200||info.status>=300) {finish(undefined,{...info,body:decode(Buffer.alloc(0)),truncated:false});return;}
      stage="read";arm();
      const decoder=options.compressed&&res.headers["content-encoding"]==="gzip"?createGunzip():null;
      const body=decoder?res.pipe(decoder):res;
      const chunks:Buffer[]=[];
      let bytes=0;
      res.on("data",arm);
      body.on("data",(data:Buffer)=>{
        const chunk=data.subarray(0,maxBytes-bytes);
        chunks.push(chunk);bytes+=chunk.length;
        if (chunk.length<data.length) {
          finish(undefined,{...info,body:decode(Buffer.concat(chunks)),truncated:true});
          decoder?.destroy();
        }
      });
      body.once("end",()=>finish(undefined,{...info,body:decode(Buffer.concat(chunks)),truncated:false}));
      decoder?.once("error",finish);
      res.once("error",error=>{decoder?.destroy();finish(error);});
      res.once("aborted",()=>{decoder?.destroy();finish(new NetworkFailure("reset","read"));});
    });
    req.once("error",finish);
    arm();
    req.end(options.body);
  });
}
