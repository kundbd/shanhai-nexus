import assert from "node:assert/strict";
import { test } from "node:test";
import { NetworkFailure,parseProxy,requestPublicNetwork } from "../../lib/directory/network-transport";
import { readPublicPage,WebsiteNetworkFailure } from "../../lib/directory/website-check";

test("proxy protocol, port and credentials are parsed without echoing invalid configuration",()=>{
  assert.equal(parseProxy(""),undefined);
  assert.equal(parseProxy("http://127.0.0.1:7897")?.scheme,"http");
  assert.equal(parseProxy("https://proxy.example.net")?.port,443);
  assert.deepEqual(parseProxy("socks5://demo:pass%40word@[::1]"),{scheme:"socks5",host:"::1",port:1080,username:"demo",password:"pass@word"});
  assert.throws(()=>parseProxy("socks5h://name:example-password@localhost:7897"),{message:"[config] config"});
});

test("public-network routing rejects private targets even when a proxy is configured",async()=>{
  await assert.rejects(()=>requestPublicNetwork(new URL("http://127.0.0.1/"),{
    maxBytes:100,signal:AbortSignal.timeout(500),proxy:parseProxy("socks5://127.0.0.1:7897"),
  }),{code:"address_policy",stage:"dns"});
});

test("website transport retries only transient failures on the same permitted URL",async()=>{
  const seen:string[]=[];
  const page=await readPublicPage("https://merchant-test.net/prices",async url=>{
    seen.push(url.pathname);
    if (url.pathname==="/robots.txt") return {status:404,contentType:"text/plain",body:"",truncated:false};
    if (seen.length===2) throw new NetworkFailure("reset","read");
    return {status:200,contentType:"text/html",body:"<title>merchant</title>",truncated:false};
  });
  assert.equal(page.status,200);
  assert.deepEqual(seen,["/robots.txt","/prices","/prices"]);
  let blocked=0;
  await assert.rejects(()=>readPublicPage("https://merchant-test.net/prices",async()=>{
    blocked++;
    return {status:200,contentType:"text/plain",body:"User-agent: *\nDisallow: /prices",truncated:false};
  }),/robots.txt 禁止/);
  assert.equal(blocked,1);
});

test("website timeout records preserve both the robots step and transport phase",async()=>{
  let attempts=0;
  await assert.rejects(()=>readPublicPage("https://merchant-test.net/prices",async()=>{
    attempts++;
    throw new NetworkFailure("headers_timeout","headers");
  },1000,5000,0),error=>error instanceof WebsiteNetworkFailure&&error.step==="robots"&&error.failure.code==="headers_timeout");
  assert.equal(attempts,1);
});
