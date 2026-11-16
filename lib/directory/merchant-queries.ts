import type { Pipeline } from "./taxonomy";

const terms:Record<Pipeline,{zh:string[];en:string[];refineZh:string[];refineEn:string[]}>={
  "ai-retail":{
    zh:["ChatGPT Plus 代充 商城","AI会员 卡密 自动发货","Claude Max 代充 商店","Gemini Google AI Pro 订阅代充","ChatGPT Pro 人工代充","AI会员共享账号 卡网","Grok SuperGrok 代充","Perplexity Pro 会员代充","Cursor Windsurf 可购买订阅","Claude Pro 合租 会员","AI成品号 数字商品店","ChatGPT Claude Gemini 代充 卡券"],
    en:["ChatGPT subscription gift reseller pricing","Claude Pro subscription reseller shop","Gemini AI subscription reseller store","AI membership recharge payment service", "Cursor Pro subscription gift store"],
    refineZh:["支付宝 微信","港澳台 购买","人民币 售后","USDT 自动发货","海外 原号充值","兑换码"],refineEn:["USD plans","Singapore payment","USDT vouchers","account top up","wholesale coupons"],
  },
  connections:{
    zh:["Clash 机场 订阅 官网 套餐","IEPL IPLC 机场 服务 月付","机场 不限时流量 订阅","Shadowsocks 节点 机场 套餐","Hysteria2 Trojan 订阅套餐","V2Ray 机场 官网 月度流量","机场 港台 专线 套餐 购买","静态住宅代理 免费试用 套餐","独立 VPN 服务商 价格","SOCKS5 数据中心代理 购买"],
    en:["independent VPN provider WireGuard subscription pricing","Shadowsocks paid proxy subscription plans","static residential SOCKS5 proxy plans","datacenter SOCKS5 proxy provider pricing","small VPN provider monthly annual subscriptions","WireGuard VPN dedicated IP provider"],
    refineZh:["香港 台湾","新加坡 日本","人民币 月付","支付宝 套餐","低倍率 试用"],refineEn:["Singapore Japan","Europe USA","USD pricing","crypto payment","dedicated IP"],
  },
  "ai-relay":{
    zh:["AI API 中转 充值 价格","Claude API 中转 模型 定价","DeepSeek Gemini API 聚合 定价","多模型 API 统一接口 余额 计费","OpenAI兼容 模型网关 平台 价格","New API 中转 充值 模型"],
    en:["LLM model API gateway unified endpoint pricing","OpenAI compatible multi model API provider credits","Claude Gemini API proxy pay as you go","DeepSeek model API inference gateway pricing","enterprise LLM gateway hosted models billing"],
    refineZh:["按量计费 人民币","OpenAI兼容 Claude","支付宝 充值","企业 模型网关"],refineEn:["USD pay as you go","EUR inference","usage based billing","model catalog"],
  },
  payments:{
    zh:["U卡 USDT 虚拟Visa 办卡 官网","虚拟信用卡 海外订阅 开卡 费用","跨境支付 汇款 平台 官方 收费","稳定币 Mastercard 支付卡 发行","数字钱包 虚拟卡 海外付款","国际订阅付款 充值 平台"],
    en:["stablecoin funded virtual debit card fees provider","virtual Visa Mastercard subscription payment card issuer fees","cross border payment digital wallet international transfer pricing","virtual dollar card crypto fees provider","multi currency virtual cards issuer pricing"],
    refineZh:["港澳 新加坡","开卡手续费 USD","海外电商 付款","USDC Visa"],refineEn:["Europe EUR","UK GBP","Singapore USD","USDT supported countries"],
  },
  vps:{
    zh:["独立 VPS 小型 服务商 月付","香港 日本 新加坡 VPS 月付 商家","轻量云服务器 KVM 购买 价格","海外独立服务器 机房 主机 商家","美国住宅IP VPS 主机 商家"],
    en:["independent KVM VPS hosting monthly provider","small European cloud VPS provider pricing","Japan Singapore VPS hosting monthly provider","dedicated server hosting provider inventory pricing","residential IP VPS provider plans","independent cloud server hosting Canada Australia"],
    refineZh:["人民币 支付宝","港币 数据中心","美国 洛杉矶 KVM","年付 VPS"],refineEn:["EUR SSD Linux","USD quarterly","SGD data center","crypto payment"],
  },
};

export type QuerySeed={pipeline:Pipeline;family:string;query:string;priority:number};
const order:Pipeline[]=["ai-retail","connections","ai-relay","payments","vps"];

export function campaignSeeds():QuerySeed[] {
  return order.flatMap((pipeline,position)=>{
    const group=terms[pipeline];
    return (["zh","en"] as const).flatMap(lang=>group[lang].flatMap((base,index)=>{
      const priority=index*10+position+Number(lang==="en")*5;
      const modifiers=lang==="zh"?group.refineZh:group.refineEn;
      return ["",...modifiers].map((suffix,variant)=>({pipeline,family:`${pipeline}:${lang}:${index}`,
        query:`${base}${suffix?` ${suffix}`:""} lang:${lang}`,priority:priority+variant*64}));
    }));
  });
}

const specialist:Record<Pipeline,readonly string[]>={
  "ai-retail":["Windsurf","Team席位","卡密兑换","数字交付","自动充值","Perplexity","Deep Research","ChatGPT Business"],
  connections:["BGP","IPLC","IEPL","精品线路","不限时流量","WireGuard","SOCKS5","静态住宅","Hysteria2","Shadowsocks","数据中心代理"],
  "ai-relay":["OpenAI compatible","Anthropic compatible","模型路由","按量付费","API key","推理网关","token pricing"],
  payments:["USDC","Mastercard","Visa","多币种","发行费","SWIFT","SEPA","virtual prepaid"],
  vps:["KVM","裸金属","高防","AMD EPYC","NVMe","residential IP","dedicated server"],
};

export function evidenceTerms(pipeline:Pipeline,text:string) {
  const lower=text.toLowerCase();
  return specialist[pipeline].filter(term=>lower.includes(term.toLowerCase()));
}

export function evidenceSeeds(pipeline:Pipeline,keyword:string):QuerySeed[] {
  return (["zh","en"] as const).map(lang=>({pipeline,family:`evidence:${pipeline}:${keyword}`,
    query:`"${keyword}" ${terms[pipeline][lang][0]} lang:${lang}`,priority:130}));
}

export function storefrontSeeds():QuerySeed[] {
  const focus:Partial<Record<Pipeline,string[]>>={
    "ai-retail":["聊天工具会员卡密 在线选购 商品列表","Claude 兑换码 卡网 自动发货 收银台","Gemini Advanced 会员卡密 商品 自动发货","AI 成品号 商城 商品列表 购买","数字商城 自动发货 ChatGPT Plus Claude Pro","Perplexity 会员卡密 兑换 商品列表","Cursor Pro 卡密 卡网 自动发货","数字虚拟商城 ChatGPT 会员 下单发货","ChatGPT Claude Gemini 共享席位 购买","AI 订阅商品卡密 店铺 官网 商品详情"],
    connections:["专线机场 订阅服务 套餐 购买 用户中心","Clash 服务订阅 价格 注册 机场 自助","机场 节点订阅 商家 不限时 套餐 购买","自有专线 节点 IEPL 机场 月付 套餐","代理订阅 机场 官网 支付宝 套餐中心","Clash SS 一键订阅 购买 流量套餐","V2Ray 机场 套餐 国内用户 注册","Hysteria2 订阅服务 自助下单 机场","Trojan 节点 云服务 订阅 套餐","订阅机场 多地区套餐 试用 自助购买"],
  };
  return (Object.keys(focus) as Pipeline[]).flatMap(pipeline=>focus[pipeline]!.flatMap((base,index)=>[""," 自助购买"].map((suffix,variant)=>({
    pipeline,family:`storefront:${pipeline}:${index}`,query:`${base}${suffix} -推荐 -教程 -导航 lang:zh`,priority:index*5+variant*32-30,
  }))));
}
