export const visibilityModes = {
  all: "所有地区可见",
  cn: "仅中国大陆可见",
  overseas: "仅香港及已允许的海外地区可见",
  countries: "指定国家或地区可见",
} as const;
export type VisibilityMode = keyof typeof visibilityModes;
export type VisibilityRule = { mode: VisibilityMode; countries: readonly string[] };
export type Audience = { country: string; label: string; overseas: boolean };

const codes = new Set((
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
  "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" "));

export function countryCode(value: string | undefined) {
  const code = value?.trim().toUpperCase();
  return code && codes.has(code) ? code : undefined;
}

export function makeAudience(identified: string | undefined, extra = process.env.GEO_ALLOWED_OVERSEAS ?? ""): Audience {
  const country = countryCode(identified) ?? "CN";
  return {
    country,
    label: country === "CN" ? "中国大陆" : country === "HK" ? "香港" : "其他地区",
    overseas: country !== "CN" && (country === "HK" || extra.split(/[,，\s]+/).some(code => countryCode(code) === country)),
  };
}

export function allowsRegion(rule: VisibilityRule | undefined, audience: Audience | "universal") {
  if (!rule || rule.mode === "all") return true;
  if (audience === "universal") return false;
  if (rule.mode === "cn") return audience.country === "CN";
  if (rule.mode === "overseas") return audience.overseas;
  return rule.countries.includes(audience.country);
}

export function isOverseasRule(rule: VisibilityRule | undefined) {
  return rule?.mode === "overseas" ||
    (rule?.mode === "countries" && rule.countries.length > 0 &&
      rule.countries.every(country => countryCode(country) === country && country !== "CN"));
}
