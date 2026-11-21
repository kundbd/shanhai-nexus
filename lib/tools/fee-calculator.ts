export const feeToolPath = "/tools/fee-calculator";
export const feeTitle = "跨境订阅与 U 卡成本计算器";
export const feeDescription = "将外币订阅与 U 卡手续费折算为人民币总成本。";

export const feeRateDate = "2026-11-20";
export const feeRateSource = "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html";

// Units of each currency per euro in the ECB reference snapshot.
export const feeCurrencies = {
  USD: 1.0990, HKD: 8.6150, JPY: 174.35, EUR: 1, GBP: 0.83735,
  SGD: 1.4160, AUD: 1.6487, CAD: 1.5723, KRW: 1472.04,
} as const;
export type FeeCurrency = keyof typeof feeCurrencies;
export const cnyPerEuro = 7.3388;

export function feeCosts(price: number, rate: number, topupFee: number, conversionFee: number) {
  if (![price, rate, topupFee, conversionFee].every(Number.isFinite) ||
      price < 0 || rate <= 0 || topupFee < 0 || conversionFee < 0) return;

  const topup = topupFee / 100;
  const conversion = conversionFee / 100;
  const feeMultiplier = conversion + topup + conversion * topup;
  const effectiveRate = rate * (1 + feeMultiplier);
  const total = price * effectiveRate;
  const loss = price * rate * feeMultiplier;
  if ([total, loss, effectiveRate].every(Number.isFinite)) return { total, loss, effectiveRate };
}
