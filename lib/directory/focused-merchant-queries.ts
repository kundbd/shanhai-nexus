import type { QuerySeed } from "./merchant-queries";
import type { Pipeline } from "./taxonomy";

const focus:Partial<Record<Pipeline,{topics:string[];modifiers:string[]}>>={
  "ai-retail":{
    topics:["ChatGPT 原号续费 店铺","AI会员卡密 CDK 现货","Claude 会员 兑换码 商城","Claude Max 按月 人工充值","Gemini Google One 家庭组 会员商店","ChatGPT 年度会员 成品账号 商城","Grok SuperGrok 激活码 商店","Perplexity Pro 兑换链接 卡券商城","Cursor Pro 成品账号 卡密","Windsurf 会员 卡密 自助","Codex 额度兑换 商品店","AI 自动发卡 商品库存","GPT ChatGPT 独享账号 商城","ChatGPT Business 席位订阅 在线店铺","Claude Code 订阅代付 商品","AI 会员共享车位 开车 店铺","Midjourney AI 会员代订 商品","AI 产品 充值平台 小店","AI会员点卡 数字卡券 商城","AI 订阅 充值店铺 自助查询"],
    modifiers:["客服 商品详情","微信支付宝 订单查询","人民币 售后","立即购买 库存","激活兑换 自助发货","港澳台 商家 付款","个人店铺 官网","订单卡密 价格"],
  },
  connections:{
    topics:["机场 月付 自助开通 套餐","节点服务 月度流量 用户中心","Clash节点 订阅商店 套餐价格","Surge 节点 订阅选择 购买","IEPL 机场 月付 注册 官网","IPLC 专线 机场 购买 年付","机场 不限时 流量包 用户中心","节点订阅 流量计费 面板","机场 购买 流量小包 新用户","小机场 预付 套餐 自助购买","低倍率 节点 套餐 机场","回国线路 加速服务 购买 订阅","Shadowsocks 订阅流量 套餐店铺","Trojan 节点 云订阅 套餐价格","Hysteria2 节点 流量包 自助服务","V2Ray 节点订阅 购买使用 套餐","机场 电信联通移动 三网 套餐","机场商家 工单 客服 公告 套餐","节点机场 自助订购 到期续费","专线流量 转发订阅 月付 年付","回国加速器 Surge Clash 付费套餐"],
    modifiers:["支付宝 微信 付款","香港 台湾 订阅","日本 新加坡 线路","注册 用户中心","试用 官网 套餐","月付 年付 工单","不限时 流量购买","新用户 自助续费"],
  },
  "ai-relay":{
    topics:["国内 API 中转 官网 充值 低价","Claude Token 中转 按量 充值","OpenAI 兼容模型网关 人民币 充值","中小 AI API 平台 国内 充值","DeepSeek Claude GPT 聚合网关","New API 独立运营 模型价格 充值","多模型 API 中转 余额 支付宝","Gemini API 代理 价格 中文 控制台","跨应用模型 API 统一 令牌充值","千问 Claude API 网关 按量计费","AI API 中转 商家 单价 开发者控制台","AI 中转商城 API 计费 官网"],
    modifiers:["免费试用 价格","按量支付 微信","低门槛 余额充值","实际可用 接入文档","Claude Code GPT 模型","人民币 支付宝 充值"],
  },
};

export function focusedMerchantSeeds():QuerySeed[] {
  return (Object.keys(focus) as Pipeline[]).flatMap((pipeline,group)=>{
    const {topics,modifiers}=focus[pipeline]!;
    return topics.flatMap((topic,index)=>modifiers.map((modifier,variant)=>({pipeline,family:`focused:${pipeline}:${index}`,
      query:`${topic} ${modifier} -排行榜 -教程 -评测 lang:zh`,priority:-300+variant*topics.length*4+index*4+group})));
  });
}
