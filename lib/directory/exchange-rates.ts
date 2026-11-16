import type { DatabaseSync } from "node:sqlite";
import { all,directory,transaction } from "./db";
import { now } from "./validation";

export const exchangeRateFeed="https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export const exchangeRateReference="https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html";

export function parseExchangeRates(xml:string) {
  const day=/<Cube\s+time=["'](\d{4}-\d{2}-\d{2})["']/.exec(xml)?.[1];
  if (!day||!Number.isFinite(Date.parse(day))||/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("参考汇率响应格式无效");
  const rates=new Map<string,number>([["EUR",1]]);
  for (const [,code,value] of xml.matchAll(/<Cube\s+currency=["']([A-Z]{3})["']\s+rate=["'](\d+(?:\.\d+)?)["']\s*\/>/g)) {
    const rate=Number(value);
    if (Number.isFinite(rate)&&rate>0) rates.set(code,rate);
  }
  if (!rates.has("CNY")||!rates.has("USD")) throw new Error("参考汇率缺少人民币或美元");
  return {day,rates};
}

export function saveExchangeRates(db:DatabaseSync,xml:string,fetchedAt=now()) {
  const {day,rates}=parseExchangeRates(xml);
  return transaction(db,()=>{
    const write=db.prepare(`INSERT INTO directory_exchange_rates(rate_day,currency,per_eur,fetched_at) VALUES(?,?,?,?)
      ON CONFLICT(rate_day,currency) DO UPDATE SET per_eur=excluded.per_eur,fetched_at=excluded.fetched_at`);
    for (const [currency,rate] of rates) write.run(day,currency,rate,fetchedAt);
    return day;
  });
}

export function exchangeRates(db=directory()) {
  const rows=all<{rate_day:string;currency:string;per_eur:number}>(db,`SELECT rate_day,currency,per_eur FROM directory_exchange_rates
    WHERE rate_day=(SELECT max(rate_day) FROM directory_exchange_rates)`);
  return {day:rows[0]?.rate_day??null,byCurrency:new Map(rows.map(row=>[row.currency,row.per_eur]))};
}

export function currencyDigits(currency:string) {
  return new Intl.NumberFormat("zh-CN",{style:"currency",currency}).resolvedOptions().maximumFractionDigits??2;
}

export function toCnyAmount(amount:number,currency:string,rates:Map<string,number>,scale=currencyDigits(currency)) {
  const major=amount/10**scale;
  if (currency==="CNY"||amount===0) return major;
  const rate=rates.get(currency), cny=rates.get("CNY");
  if (!rate||!cny) return undefined;
  return major*cny/rate;
}

export function toCnyMinor(amount:number,currency:string,rates:Map<string,number>,scale?:number) {
  const major=toCnyAmount(amount,currency,rates,scale);
  if (major===undefined) return undefined;
  const converted=Math.round(major*100);
  return Number.isSafeInteger(converted)?converted:undefined;
}
