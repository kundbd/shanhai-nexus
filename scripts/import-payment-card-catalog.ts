import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { all, one, transaction } from "../lib/directory/db";
import type { Site } from "../lib/directory/types";
import { dateValue, now, websiteUrl } from "../lib/directory/validation";
import { audit, writeEntityInTransaction, type Fields } from "../lib/directory/write";

type Quote = {
  plan: string;
  amountMinor: number;
  currency: string;
  period: string;
  region: string;
  notes?: string;
};

type Evidence = {
  title: string;
  url: string;
  summary: string;
  quotes?: Quote[];
};

type Profile = {
  slug: string;
  name: string;
  website: string;
  aliases: string[];
  summary: string;
  products: string;
  payments?: string;
  fees: string;
  renewal?: string;
  refunds?: string;
  regions?: string;
  contact?: string;
  sources: Evidence[];
};

type Batch = { observed: string; merchants: Profile[] };

const actor = "editor:payment-card-catalog";
const [file, dbPath, action = "--preview"] = process.argv.slice(2);
if (!file || !dbPath || !existsSync(dbPath) || !["--preview", "--apply"].includes(action)) {
  throw new Error("用法：tsx scripts/import-payment-card-catalog.ts 数据.json 已存在的数据库.sqlite [--preview|--apply]");
}
const batch = JSON.parse(readFileSync(file, "utf8")) as Batch;
const observed = dateValue(batch.observed, "公开资料观察日期");
if (!Array.isArray(batch.merchants) || !batch.merchants.length) throw new Error("批次没有档案。");

const db = new DatabaseSync(dbPath);
const rollbackPreview = new Error("preview");
const result = {
  mode: action,
  before: 0,
  after: 0,
  added: [] as string[],
  updated: [] as string[],
  unchanged: [] as string[],
  sources: 0,
  quotes: 0,
};

function countPublicCards() {
  return one<{count: number}>(db, "SELECT count(*) count FROM sites WHERE category_slug='u-card' AND publication='published'")!.count;
}

function upsertEvidence(site: number, profile: Profile, evidence: Evidence) {
  const url = websiteUrl(evidence.url).url;
  const known = one<{id: number; kind: string; verified: number}>(db,
    "SELECT id,kind,verified FROM sources WHERE site_id=? AND url=? AND accessed_at=?", site, url, observed);
  if (known && (known.kind !== "official" || !known.verified)) {
    throw new Error(`${profile.name} 有归属不同的同日来源，请先核对。`);
  }
  const source = known?.id ?? Number(writeEntityInTransaction(db, "sources", {
    site_id: site, title: evidence.title, url, accessed_at: observed, kind: "official",
    verified: "1", excerpt: evidence.summary, attribution: profile.name,
  }, actor));
  if (!known) result.sources++;

  for (const quote of evidence.quotes ?? []) {
    const prior = one<{amount_minor: number; publication: string}>(db,
      `SELECT amount_minor,publication FROM price_records
       WHERE site_id=? AND plan=? AND currency=? AND period=? AND region=? AND recorded_at=? AND storefront_observed=0`,
      site, quote.plan, quote.currency, quote.period, quote.region, observed);
    if (prior) {
      if (prior.amount_minor !== quote.amountMinor || prior.publication !== "published") {
        throw new Error(`${profile.name} 的「${quote.plan}」存在冲突的同日报价。`);
      }
      continue;
    }
    writeEntityInTransaction(db, "price_records", {
      site_id: site, source_id: source, plan: quote.plan, currency: quote.currency,
      amount_minor: String(quote.amountMinor), period: quote.period, region: quote.region,
      notes: quote.notes, recorded_at: observed, publication: "published",
    }, actor);
    result.quotes++;
  }
}

function importProfile(profile: Profile) {
  if (!profile.sources.length || !profile.fees) throw new Error(`${profile.name} 缺少费用资料或来源。`);
  const website = websiteUrl(profile.website);
  const matches = all<Site>(db, `SELECT DISTINCT s.* FROM sites s LEFT JOIN site_domains d ON d.site_id=s.id
    WHERE s.slug=? OR d.registrable=?`, profile.slug, website.registrable);
  const existing = matches[0];
  if (matches.length > 1 || (existing && (existing.category_slug !== "u-card"
      || existing.publication !== "published" || existing.lifecycle === "closed"))) {
    throw new Error(`${profile.name} 与现有档案冲突，请先核对域名及状态。`);
  }
  const aliases = [...new Set([...(JSON.parse(existing?.aliases ?? "[]") as string[]), ...profile.aliases])];
  const content = {
    summary: profile.summary, products: profile.products, fees: profile.fees,
    payments: profile.payments ?? existing?.payments ?? null,
    renewal: profile.renewal ?? existing?.renewal ?? null,
    refunds: profile.refunds ?? existing?.refunds ?? null,
    regions: profile.regions ?? existing?.regions ?? null,
    contact: profile.contact ?? existing?.contact ?? null,
  };
  const fields: Fields = {
    ...JSON.parse(existing?.merchant_details ?? "{}"), ...content,
    slug: profile.slug, name: existing?.name ?? profile.name,
    website: existing?.website ?? website.url, category_slug: "u-card",
    aliases: aliases.join("\n"), operator_kind: existing?.operator_kind ?? "official",
    publication: "published", lifecycle: "active",
  };
  if (existing) {
    const domains = all<{domain: string; kind: string}>(db, "SELECT domain,kind FROM site_domains WHERE site_id=?", existing.id);
    fields.domain_aliases = domains.filter(({kind}) => kind === "alias").map(({domain}) => domain).join("\n");
    fields.historical_domains = domains.filter(({kind}) => kind === "historical").map(({domain}) => domain).join("\n");
  }
  const site = existing?.id ?? Number(writeEntityInTransaction(db, "sites", { ...fields, status: "listed" }, actor));
  const beforeRows = result.sources + result.quotes;
  for (const evidence of profile.sources) upsertEvidence(site, profile, evidence);

  const status = existing?.status === "tested" ? "tested" : "verified";
  const verifiedAt = status === "tested" ? existing?.verified_at?.slice(0, 10) : observed;
  const changed = !existing || existing.status !== status || existing.verified_at?.slice(0, 10) !== verifiedAt
    || existing.lifecycle !== "active" || existing.aliases !== JSON.stringify(aliases)
    || Object.entries(content).some(([key, value]) => existing[key as keyof typeof content] !== value);
  const slug = existing?.slug ?? profile.slug;
  if (changed) {
    writeEntityInTransaction(db, "sites", { ...fields, id: site, status, verified_at: verifiedAt }, actor);
  } else if (result.sources + result.quotes !== beforeRows) {
    db.prepare("UPDATE sites SET updated_at=? WHERE id=?").run(now(), site);
    audit(db, actor, "add_card_evidence", "sites", site, null, { observed_at: observed });
  }
  if (!existing) result.added.push(slug);
  else if (changed || result.sources + result.quotes !== beforeRows) result.updated.push(slug);
  else result.unchanged.push(slug);
}

try {
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=8000;");
  transaction(db, () => {
    result.before = countPublicCards();
    for (const profile of batch.merchants) importProfile(profile);
    result.after = countPublicCards();
    if (action === "--preview") throw rollbackPreview;
  });
} catch (error) {
  if (error !== rollbackPreview) throw error;
} finally {
  db.close();
}
console.log(JSON.stringify(result, null, 2));
