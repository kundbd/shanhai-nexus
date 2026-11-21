import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { all } from "../directory/db";
import { isRetiredCategory } from "../directory/taxonomy";
import { allowsRegion, countryCode, isOverseasRule, type Audience, type VisibilityRule } from "./policy";

export const visibilityKinds = {
  editorial: "山海观察",
  site: "服务档案",
  category: "服务分类",
  ad: "首页轮播广告",
  promotion: "推广链接",
} as const;
export type VisibilityKind = keyof typeof visibilityKinds;
type RulesRow = { kind: VisibilityKind; content_key: string; mode: Exclude<VisibilityRule["mode"], "all">; countries: string };
type CategoryRow = { slug: string; parent_slug: string | null };

export function ruleFromRow(row: RulesRow): VisibilityRule {
  return { mode: row.mode, countries: (JSON.parse(row.countries) as unknown[])
    .filter((code): code is string => typeof code === "string" && countryCode(code) === code) };
}

export function promotionKey(href: string) {
  try {
    const url = new URL(href);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
    url.searchParams.sort();
    return url.href;
  } catch { return; }
}

export function loadVisibility(db: DatabaseSync, audience: Audience | "universal") {
  const rules = new Map<VisibilityKind, Map<string, VisibilityRule>>();
  for (const row of all<RulesRow>(db, "SELECT kind,content_key,mode,countries FROM content_region_rules WHERE kind<>'guide'")) {
    const entries = rules.get(row.kind) ?? new Map<string, VisibilityRule>();
    entries.set(row.content_key, ruleFromRow(row));
    rules.set(row.kind, entries);
  }
  const rule = (kind: VisibilityKind, key: string) => rules.get(kind)?.get(key);
  const allows = (kind: VisibilityKind, key: string, network = false) => {
    const setting = rule(kind, key);
    return (!network || isOverseasRule(setting)) && allowsRegion(setting, audience);
  };
  const hidden = (kind: VisibilityKind) => [...(rules.get(kind)?.keys() ?? [])].filter(key => !allows(kind,key));
  const categories = new Map(all<CategoryRow>(db, "SELECT slug,parent_slug FROM categories").map(row => [row.slug, row.parent_slug]));
  function categoryAllowed(slug: string) {
    const visited = new Set<string>();
    let key: string | null | undefined = slug;
    while (key) {
      if (visited.has(key) || !categories.has(key) || !allows("category", key, isRetiredCategory(key))) return false;
      visited.add(key);
      key = categories.get(key);
    }
    return true;
  }
  const hiddenCategories = [...categories.keys()].filter(key => !categoryAllowed(key));
  const permittedNetworkSites = [...(rules.get("site")?.keys() ?? [])].filter(key => allows("site", key, true));
  const hiddenSites = hidden("site");
  const hiddenEditorials = hidden("editorial");
  const hiddenPromotions = hidden("promotion");
  function linkAllowed(href: string) {
    const key = promotionKey(href);
    return !key || allows("promotion", key);
  }
  function filterText(text: string) {
    if (!hiddenPromotions.length) return text;
    return text.replace(/https?:\/\/[^\s<>"'）)]+/gi, href => linkAllowed(href) ? href : "");
  }
  return { audience, allows, categoryAllowed, hiddenCategories, permittedNetworkSites, hiddenSites, hiddenEditorials, linkAllowed, filterText };
}

export type ContentVisibility = ReturnType<typeof loadVisibility>;
type Predicate = { clause: string; bindings: SQLInputValue[] };
const retired = "('airport','vpn','proxy-services','residential')";

export function siteVisibility(visibility?: ContentVisibility, alias = "s"): Predicate {
  const net = `(${alias}.category_slug IN ${retired} OR ${alias}.slug='tailscale')`;
  const bindings: SQLInputValue[] = [];
  const conditions: string[] = [];
  if (visibility?.permittedNetworkSites.length) {
    conditions.push(`(NOT ${net} OR ${alias}.slug IN (SELECT value FROM json_each(?)))`);
    bindings.push(JSON.stringify(visibility.permittedNetworkSites));
  } else conditions.push(`NOT ${net}`);
  if (visibility?.hiddenCategories.length) {
    conditions.push(`${alias}.category_slug NOT IN (SELECT value FROM json_each(?))`);
    bindings.push(JSON.stringify(visibility.hiddenCategories));
  }
  if (visibility?.hiddenSites.length) {
    conditions.push(`${alias}.slug NOT IN (SELECT value FROM json_each(?))`);
    bindings.push(JSON.stringify(visibility.hiddenSites));
  }
  return { clause: conditions.join(" AND "), bindings };
}

export function editorialVisibility(visibility?: ContentVisibility, alias = "e"): Predicate {
  const owner = siteVisibility(visibility, "region_owner");
  const hidden = visibility?.hiddenEditorials ?? [];
  return {
    clause: `(${alias}.site_id IS NULL OR EXISTS (SELECT 1 FROM sites region_owner
      WHERE region_owner.id=${alias}.site_id AND region_owner.publication='published' AND ${owner.clause}))` +
      (hidden.length ? ` AND ${alias}.slug NOT IN (SELECT value FROM json_each(?))` : ""),
    bindings: [...owner.bindings, ...(hidden.length ? [JSON.stringify(hidden)] : [])],
  };
}
