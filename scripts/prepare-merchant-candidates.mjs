import { existsSync,readFileSync,writeFileSync } from "node:fs";
import { URL } from "node:url";
import { parse } from "tldts";

const input=process.argv[2]??"output/source-audit";
const output=process.argv[3]??"content/merchant-candidates-v03.json";
const date=process.argv[4]??new Date().toISOString().slice(0,10);
const read=file=>readFileSync(`${input}/${file}`,"utf8");
const json=file=>JSON.parse(read(file));
const origin="https://github.com";
const cc=id=>`https://creativecommons.org/${id}/4.0/`;
const cc0="https://creativecommons.org/publicdomain/zero/1.0/";
const rows=[];
const counts={};
const omitted={};
const mistakes=new Set(["github.com","gist.github.com","lowendtalk.com","lowendbox.com","t.me","discord.com","tkqlhce.com","bit.ly","affiliates.net","youtube.com","google.com","example.com"]);

function source(repo,sha,path,license="LICENSE") {
  const base=`${origin}/${repo}/blob/${sha}/`;
  return {discovery_name:repo,source_url:base+path,source_title:`${repo} · 名称与官网候选`,
    license_url:license.startsWith("https:")?license:base+license,snapshot_at:date};
}
function add(provenance,name,site,category,{rootDomain=false,operator_kind="third_party"}={}) {
  try {
    const trimmed=site.trim().replace(/^www\./i,"https://www.");
    const url=new URL(/^https?:\/\//i.test(trimmed)?trimmed:`https://${trimmed}`);
    const hostname=url.hostname.replace(/^(www\.)/i,"");
    const parsed=parse(hostname,{allowPrivateDomains:true});
    if (url.username || url.password || url.port || (url.protocol!=="https:" && url.protocol!=="http:") ||
        !parsed.domain || (!parsed.isIcann&&!parsed.isPrivate) || mistakes.has(hostname) || mistakes.has(parsed.domain) ||
        /^(?:go|aff|affiliate|referrals?)\./.test(hostname) || !name.trim()) throw new Error("不是可辨认的商家公开域名");
    const stripped=new URL(rootDomain?`https://${parsed.domain}/`:`${url.protocol}//${url.host}/`);
    rows.push({...provenance,name:name.trim().replace(/\*\*/g,"").slice(0,100),url:stripped.href,category,operator_kind});
    counts[provenance.discovery_name]=(counts[provenance.discovery_name]??0)+1;
  } catch {
    omitted[provenance.discovery_name]=(omitted[provenance.discovery_name]??0)+1;
  }
}
function tableEntries(text) {
  return text.split(/\r?\n/).filter(line=>line.startsWith("|")).map(line=>line.split("|").slice(1,-1).map(cell=>cell.trim()));
}
const claws=source("Claws-ZH/awesome-ai-api","c424f4aadcae59767b7f99a74320e14423b52cae","data/gateways.json");
for (const {name,url} of json("claws.json").gateways) add(claws,name,url,"ai-relay");
const ranking=source("apiranking/awesome-api-relay","269183329fef9625efa9b91e663b96874d0d2641","README.md",cc("licenses/by-sa"));
for (const [title,url] of tableEntries(read("relay.md"))) {
  const name=/^\[([^\]]+)\]/.exec(title??"")?.[1];
  if (name && /^`[a-z\d.-]+`$/i.test(url??"")) add(ranking,name,url.slice(1,-1),"ai-relay");
}
const howard=source("howardpen9/awesome-ai-api-proxy","acd5c440ac3d88f9e00c6cf3b25c40b92d52bc1d","data/providers.yaml",cc0);
const howardText=read("howard.yaml");
for (const section of ["china_relays","global_gateways"]) {
  const fragment=howardText.split(`\n${section}:`)[1]?.split(/\n[a-z_]+:\s*(?:\r?\n|$)/)[0]??"";
  for (const [,name,url] of fragment.matchAll(/^ {2}- name: ([^\r\n]+)\r?\n {4}url: (https?:\/\/\S+)/gm)) {
    if (!/MiniMax Open Platform|LiteLLM|RouteScope/i.test(name)) add(howard,name,url,"ai-relay");
  }
}
const free=source("kirito8/free-newapi","c2e46cd93803b525eda597f633f40ed1ab0856ab","README.md");
const freeTable=read("free.md").split("## 二、官方免费额度平台")[0];
for (const [,name,url] of freeTable.matchAll(/<tr><td nowrap>([^<]+)<\/td><td nowrap><a href="(https?:\/\/[^"]+)"/g)) add(free,name,url,"ai-relay");
const vpn=source("hardcor3nl/vpn-audit-register","8f896819cec392f1e8cf9c6c82a6b7cf7e6001f7","vpn-audit-register.json",cc("licenses/by"));
for (const row of json("vpn-register.data")) if (row.website) add(vpn,row.name,row.website,"vpn",{operator_kind:"unknown"});
const hiddify=source("hiddify/awesome-freedom","248c60701bd2ca548189b155bf0ff9a3c781e1fd","vps-providers.md",cc0);
for (const [name,...cells] of tableEntries(read("hiddify.data"))) {
  const url=/\]\((https?:\/\/[^\s)]+)\)/i.exec(cells.join("|"))?.[1];
  if (url) add(hiddify,name,url,"vps",{operator_kind:"unknown"});
}
const vps=source("ishandutta2007/Awesome-Virtual-Private-Server-Vps-Hosting","92b67cc2b8a868fe66b2bbd54cbc5e725d7a75a3","README.md");
for (const [first] of tableEntries(read("awesomevps.data").split("## 🔓 Open-Source")[0])) {
  const match=/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/.exec(first??"");
  if (match) add(vps,match[1],match[2],"vps",{operator_kind:"unknown"});
}
const cheap=source("zhengdon/awesome-cheap-vps","e2f2bd8b09c1c5c10f82b9b206934837e84d7e9e","README.md");
for (const [first] of tableEntries(read("cheapvps.data"))) {
  const match=/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/.exec(first??"");
  if (match) add(cheap,match[1],match[2],"vps",{rootDomain:true,operator_kind:"unknown"});
}
const storage=source("edit2/LowEndStorage","5e7f049b15979a27f25fcaaba149841a23f3173d","data.json","https://spdx.org/licenses/WTFPL.html");
for (const {Provider,Provider_URL} of json("lowendstor.data").data) add(storage,Provider,Provider_URL,"vps",{operator_kind:"unknown"});
const deals=source("Ne00n/DealsLists","4addf372cd08bce4d7ec8ea16efe7e7bd016bfe6","data/lowendtalk-available-posts.json");
const dealt=new Set();
for (const values of Object.values(json("deals.data"))) {
  for (const offers of Object.values(values)) for (const links of Object.values(offers)) for (const link of links) {
    try {
      const domain=parse(new URL(link).hostname,{allowPrivateDomains:true}).domain;
      if (domain && !dealt.has(domain)) { dealt.add(domain);add(deals,domain,link,"vps",{rootDomain:true,operator_kind:"unknown"}); }
    } catch { /* Ignore incomplete historical link. */ }
  }
}
if (existsSync(`${input}/claws-candidates.txt`)) {
  const leads={...source("Claws-ZH/awesome-ai-api","c424f4aadcae59767b7f99a74320e14423b52cae","data/candidates.txt"),
    discovery_name:"Claws-ZH/awesome-ai-api · candidate URLs"};
  const known=new Set(rows.map(row=>new URL(row.url).hostname.replace(/^www\./,"")));
  for (const line of read("claws-candidates.txt").split(/\r?\n/)) {
    const link=line.trim();
    if (!/^https?:\/\/\S+$/.test(link)) continue;
    try {
      const hostname=new URL(link).hostname.replace(/^www\./,"");
      if (known.has(hostname)) continue;
      known.add(hostname);
      add(leads,hostname,link,"",{operator_kind:"unknown"});
    } catch { /* Ignore malformed raw line. */ }
  }
}
writeFileSync(output,`${JSON.stringify(rows,null,2)}\n`);
console.log(JSON.stringify({output,rows:rows.length,counts,omitted},null,2));
