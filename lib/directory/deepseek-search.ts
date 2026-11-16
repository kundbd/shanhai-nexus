import { boundedText } from "./imports";
import { NetworkFailure,parseProxy,requestPublicNetwork } from "./network-transport";

export const deepSeekSearchEndpoint="https://api.deepseek.com/v1/tools/search";
export const deepSeekSearchReference="https://api-docs.deepseek.com/zh-cn/api/search/";

export function deepSeekProxyRoute() {
  try { return parseProxy(process.env.DEEPSEEK_PROXY); }
  catch (error) { throw new Error("DeepSeek Search 代理配置无效 [config]",{cause:error}); }
}

export async function searchDeepSeek(query:string,count:number,fetcher?:typeof fetch,beforeRequest?:()=>void) {
  const key=process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) throw new Error("未设置 DEEPSEEK_API_KEY");
  const input=query.trim();
  if (!input || [...input].length>128) throw new Error("DeepSeek Search 查询词须为 1 至 128 个字符");
  if (!Number.isSafeInteger(count) || count<1 || count>50) throw new Error("DeepSeek Search 返回条数须为 1 至 50");
  const proxy=fetcher?undefined:deepSeekProxyRoute();
  beforeRequest?.();
  const headers={Authorization:`Bearer ${key}`,"Content-Type":"application/json",Accept:"application/json"};
  const body=JSON.stringify({query:input,count,need_content:false});
  const signal=AbortSignal.timeout(15_000);
  let response:Response|undefined;
  let page:Awaited<ReturnType<typeof requestPublicNetwork>>|undefined;
  try {
    if (fetcher) response=await fetcher(deepSeekSearchEndpoint,{method:"POST",headers,body,redirect:"error",cache:"no-store",signal});
    else page=await requestPublicNetwork(new URL(deepSeekSearchEndpoint),{method:"POST",headers,body,signal,maxBytes:1_000_000,proxy});
  } catch (error) {
    if (error instanceof NetworkFailure) {
      const category=error.code.endsWith("_timeout")?"请求超时":error.code==="reset"?"网络请求失败":"请求失败";
      throw new Error(`DeepSeek Search ${category} ${error.message}`,{cause:error});
    }
    const timedOut=error instanceof Error && ["TimeoutError","AbortError"].includes(error.name);
    // eslint-disable-next-line preserve-caught-error -- Transport errors can contain authenticated request details.
    throw new Error(timedOut?"DeepSeek Search 请求超时":"DeepSeek Search 网络请求失败");
  }
  const status=response?.status??page!.status;
  if (status<200||status>=300) {
    await response?.body?.cancel().catch(()=>{});
    const detail=status===401?"（密钥无效或不可用）":status===402?"（账号余额不足）":"";
    throw new Error(`DeepSeek Search HTTP ${status}${detail}`);
  }

  let data:unknown;
  try {
    if (page?.truncated) throw new Error("response size limit reached");
    data=JSON.parse(response?await boundedText(response,1_000_000):page!.body);
  } catch {
    if (signal.aborted) throw new Error("DeepSeek Search 请求超时 [read_timeout]");
    throw new Error("DeepSeek Search 响应无法读取或解析");
  }
  const results=(data as {results?:unknown}|null)?.results;
  if (!Array.isArray(results)) throw new Error("DeepSeek Search 响应缺少结果数组");
  const urls=new Set<string>();
  for (const row of results.slice(0,count)) {
    const raw=(row as {url?:unknown}|null)?.url;
    if (typeof raw!=="string" || raw.includes(key)) continue;
    try {
      const url=new URL(raw);
      if (["https:","http:"].includes(url.protocol) && !url.username && !url.password && url.href.length<=1500) urls.add(url.href);
    } catch { /* Ignore malformed search results. */ }
  }
  if (results.length && !urls.size) throw new Error("DeepSeek Search 返回了结果，但缺少有效网页网址");
  return {urls:[...urls],returned:results.length};
}
