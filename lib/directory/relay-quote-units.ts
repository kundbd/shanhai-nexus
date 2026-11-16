export const relayTokenPeriods=["每百万输入 Token","每百万输出 Token"] as const;
export const relayRateRegion="公开按量标价";

export function isRelayTokenPeriod(period:string) {
  return relayTokenPeriods.some(unit=>unit===period);
}
