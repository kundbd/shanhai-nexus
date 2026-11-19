export const priorityLinks = [
  { label:"AI 代充与卡网", description:"区分代充、卡密、成品号与共享席位", group:"ai-retail" },
  { label:"AI API 中转", description:"第三方模型接口与网关", category:"ai-relay" },
  { label:"U 卡与支付", description:"支付卡、虚拟卡与跨境服务", category:"payments" },
  { label:"VPS 与云服务", description:"独立主机商与云服务器", category:"vps" },
] as const;
export const categoryGroups = {
  "ai-retail": ["ai-topup","ai-card"],
  priority: ["ai-topup","ai-card","ai-relay","u-card","virtual-card","payment-accounts","subscription-payment","vps"],
} as const;

const retiredNetworkCategories = new Set(["airport", "vpn", "proxy-services", "residential"]);
export const isRetiredCategory = (slug: string) => retiredNetworkCategories.has(slug);
export const isRetiredNetworkSite = (category: string, slug: string) => isRetiredCategory(category) || slug === "tailscale";

export const operators = { official:"官方平台",third_party:"第三方商家",unknown:"运营性质待核实" } as const;
export const pipelines={
  "ai-retail":{label:"AI 代充与卡网",categories:["ai-topup","ai-card"]},
  "ai-relay":{label:"AI API 中转",categories:["ai-relay"]},
  connections:{label:"机场与 VPN",categories:["airport","vpn","proxy-services"]},
  payments:{label:"U 卡与跨境支付",categories:["u-card","virtual-card","payment-accounts","subscription-payment"]},
  vps:{label:"VPS 与云服务",categories:["vps","residential"]},
} as const;
export type Pipeline=keyof typeof pipelines;
export const publicPipelines = (Object.keys(pipelines) as Pipeline[]).filter(pipeline => pipeline !== "connections");
export function pipelineForCategory(category:string) {
  return (Object.keys(pipelines) as Pipeline[]).find(key=>(pipelines[key].categories as readonly string[]).includes(category));
}
export const lifecycleLabels = { unknown:"运营状态待核实",active:"运营中",closed:"已停运" } as const;
export const publicLifecycleLabels = { ...lifecycleLabels,unknown:lifecycleLabels.active } as const;
export const reachabilityLabels = { unchecked:"未检查",reachable:"可达",restricted:"访问受限",unreachable:"本次未连接",skipped:"按规则跳过",inconclusive:"本次无法判断" } as const;
export const publicWebsiteLabel = reachabilityLabels.reachable;
export const deliveryLabels = { topup:"原账号代充",code:"卡密兑换",account:"成品账号",seat:"共享席位",other:"其他交付" } as const;

export const merchantFields = {
  ai_products:"销售的 AI 产品",
  delivery_methods:"交付类型",
  delivery_window:"交付周期",
  warranty:"质保规则",
  monthly_price:"月付价格（含币种和周期）",
  monthly_traffic:"月度流量",
  timeless_traffic:"不限时流量",
  route_claim:"线路类型（商家自述）",
  clients:"支持客户端",
  trial:"试用与退款条件",
} as const;

export function suggestCategory(text: string) {
  if (/稳定币.{0,8}(卡|card)|\bu\s*卡\b|crypto.{0,10}card/i.test(text)) return "u-card";
  if (/虚拟(?:信用|支付)?卡|virtual (?:credit )?card/i.test(text)) return "virtual-card";
  if (/发卡|卡网|卡密|成品号/i.test(text)) return "ai-card";
  if (/会员代充|代充值|AI.{0,9}代充/i.test(text)) return "ai-topup";
  if (/API\s*(?:中转|聚合|网关)|(?:AI|LLM)\s*(?:API\s*)?(?:relay|gateway)/i.test(text)) return "ai-relay";
  if (/机场|节点订阅|订阅节点/i.test(text)) return "airport";
  if (/住宅代理|residential pro(?:xy|xies)/i.test(text)) return "residential";
  if (/\bvpn\b/i.test(text)) return "vpn";
  if (/vps|云服务器|cloud hosting/i.test(text)) return "vps";
  if (/跨境|汇款|remittance/i.test(text)) return "payment-accounts";
  if (/订阅支付|subscription billing/i.test(text)) return "subscription-payment";
  if (/模型|生成式|\bai\b|\bllm\b|chatgpt/i.test(text)) return "ai-platforms";
  if (/云存储|cloud storage|object storage/i.test(text)) return "cloud-storage";
  return "";
}
