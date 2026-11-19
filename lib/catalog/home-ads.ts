export type HomeAd = {
  id: string; title: string; description: string; href: string; action: string;
  cardBrand: string; cardLabel: string; network?: boolean;
};

export const homeAds: readonly HomeAd[] = [
  {
    id: "roogoo",
    title: "Roogoo 乐享卡",
    description: "美元结算的 Visa 虚拟卡，用于线上消费和数字订阅。",
    href: "https://wap.roogoo.cloud/register?inviteCode=n0qxgt",
    action: "前往注册",
    cardBrand: "Roogoo",
    cardLabel: "VISA",
  },
  {
    id: "gate",
    title: "Gate AI Card",
    description: "用于支付 AI 工具和数字服务订阅的虚拟卡。",
    href: "https://app.bxjddjt.com/card/redirect?key=invite&invite_code=VAMRAV9DVQ",
    action: "前往申请",
    cardBrand: "Gate",
    cardLabel: "AI Card",
  },
  {
    id: "musepay",
    title: "MusePay Global Nova Card",
    description: "面向 AI 订阅和线上消费的 Visa 虚拟卡。",
    href: "https://h5.musepayapp.io/h5/?type=person&code=W34EQX",
    action: "前往申请",
    cardBrand: "Muse Card",
    cardLabel: "VISA",
  },
];
