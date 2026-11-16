const tierNames = new Map([
  ["go","Go"],["plus","Plus"],["pro","Pro"],["pro+","Pro+"],["max","Max"],["ultra","Ultra"],
  ["premium","Premium"],["premium+","Premium+"],["super","Super"],["supergrok","SuperGrok"],
  ["supergrok heavy","SuperGrok Heavy"],["team","Team"],["teams","Team"],["business","Business"],
  ["enterprise","Enterprise"],["edu","Edu"],
]);
const tierPattern = /(?<![a-z0-9])(supergrok(?:\s+heavy)?|premium\+?|pro\+?|enterprise|business|teams?|plus|max|ultra|super|edu|go)(?![a-z])/i;
const monthly = /月付|月卡|月费|\bbilled monthly\b/i;
const yearly = /年付|年卡|年费|\bbilled (?:annually|yearly)\b/i;
const chatgptTiers=["Go","Plus","Pro 100","Pro 200","Pro 500","Business","Enterprise","Edu"];
const claudeTiers=["Pro","Max","Ultra","Team","Enterprise"];

export function canonicalAiTier(product:string,label:string) {
  const text=label.normalize("NFKC");
  const match=tierPattern.exec(text);
  if (!match) return;
  const tier=tierNames.get(match[0].toLowerCase().replace(/\s+/g," "))!;
  const suffix=text.slice(match.index+match[0].length);
  const prefix=text.slice(0,match.index);
  if(product==="ChatGPT") {
    if(tier!=="Pro") return chatgptTiers.includes(tier)?tier:undefined;
    const value=/^\s*\(?\s*(?:US\s*)?\$?\s*(\d{3})(?![a-z0-9×倍])/i.exec(suffix)?.[1]??/\$\s*(\d{3})\s*$/i.exec(prefix)?.[1];
    const multiple=usageMultiple(prefix,suffix);
    // Historical aliases refer to a plan name. The vendor's usage limits can change.
    const alias=multiple==="5"?"100":multiple==="20"?"200":undefined;
    if((value&&alias&&value!==alias)||(multiple&&!alias)) return;
    const canonical=`Pro ${value??alias??""}`;
    return chatgptTiers.includes(canonical)?canonical:undefined;
  }
  if(product==="Claude") {
    if(tier!=="Max") return claudeTiers.includes(tier)?tier:undefined;
    const multiple=usageMultiple(prefix,suffix)??/^\s*(5|20)(?![\da-z×倍])/i.exec(suffix)?.[1];
    if(multiple==="20")return "Ultra";
    if(!multiple||multiple==="5")return "Max";
    return;
  }
  if(!["Pro","Max","Ultra"].includes(tier))return tier;
  const multiple=usageMultiple(prefix,suffix);
  return multiple?`${tier} ${multiple}×`:tier;
}

function usageMultiple(prefix:string,suffix:string) {
  return /^\s*(?:(?:\$\s*)?(?:100|200|500)\s*)?\(?\s*(?:pro\s*)?(\d{1,3})\s*(?:x|×|倍)(?![a-z0-9])/i.exec(suffix)?.[1]??
    /(?<![a-z0-9])(\d{1,3})\s*(?:x|×|倍)\s*$/i.exec(prefix)?.[1];
}

export function aiSubscriptionTier(product:string,plan:string,period:string,amountMinor:number) {
  if (amountMinor<=0||(period!=="月"&&period!=="年")) return;
  const text=plan.normalize("NFKC");
  if (conflictsWithBillingPeriod(text,period)) return;
  return canonicalAiTier(product,text);
}

function conflictsWithBillingPeriod(text:string,period:string) {
  return (period==="月"&&yearly.test(text))||(period==="年"&&monthly.test(text));
}

export function conflictsWithObservedAiTier(product:string,tier:string,period:string,title:string) {
  const text=title.normalize("NFKC");
  if (conflictsWithBillingPeriod(text,period)) return true;
  const marker=tierPattern.exec(text);
  if (!marker) return false;
  const canonical=canonicalAiTier(product,text);
  if (canonical) return canonical!==tier;
  const suffix=text.slice(marker.index+marker[0].length);
  const prefix=text.slice(0,marker.index);
  // A named usage variant that we cannot map is not comparable to a standard tier.
  if (usageMultiple(prefix,suffix)||/^\s*(?:US\s*)?\$?\s*\d{3}(?!\d)/i.test(suffix)) return true;
  return marker[0].toLowerCase()!==tierPattern.exec(tier)?.[0].toLowerCase();
}

export function orderAiTiers(product:string,tiers:string[]) {
  const order=product==="ChatGPT"?chatgptTiers:product==="Claude"?claudeTiers:undefined;
  return order?order.filter(tier=>tiers.includes(tier)):tiers;
}
