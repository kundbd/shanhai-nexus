import type { DatabaseSync } from "node:sqlite";
import seed from "@/content/directory-seed.json";
import { isRetiredNetworkSite } from "./taxonomy";
import { websiteUrl } from "./validation";

export function seedCategories(db: DatabaseSync) {
  const insert = db.prepare("INSERT OR IGNORE INTO categories(slug,label,description,parent_slug,position) VALUES (?,?,?,?,?)");
  for (const row of seed.categories) insert.run(row.slug,row.label,row.description,row.parent,row.position);
}

export function seedDatabase(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS seed_runs (name TEXT PRIMARY KEY) STRICT");
  if (db.prepare("SELECT 1 FROM seed_runs WHERE name=?").get("v0.3-editorial")) return;
  const updatedCategories:Record<string,string> = {openrouter:"ai-relay",deepseek:"ai-subscriptions",perplexity:"ai-platforms"};
  const siteIds = new Map<string, number>();
  const sourceIds = new Map<string, number>();
  const defaultSources = new Map<string, string>();
  const recorded = new Date(`${seed.date}T00:00:00+08:00`).toISOString();

  function addSource(slug: string, url: string, title: string, verified: boolean, excerpt = "") {
    const key = `${slug}:${url}`;
    const existing = sourceIds.get(key);
    if (existing) return existing;
    const id = Number(db.prepare("INSERT INTO sources(site_id,title,url,accessed_at,kind,verified,excerpt) VALUES (?,?,?,?,?,?,?)")
      .run(siteIds.get(slug)!, title, url, seed.date, verified ? "official" : "pending", Number(verified), excerpt).lastInsertRowid);
    sourceIds.set(key, id);
    return id;
  }

  for (const site of seed.sites) {
    const category = updatedCategories[site.slug] ?? site.category;
    const publication = isRetiredNetworkSite(category, site.slug) ? "archived" : "published";
    const id = Number(db.prepare(`INSERT INTO sites(slug,name,website,category_slug,summary,aliases,contact,products,payments,
      fees,renewal,refunds,regions,status,publication,added_at,updated_at,verified_at,operator_kind) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(site.slug, site.name, site.website, category, site.summary, JSON.stringify(site.aliases), site.contact, site.products,
        site.payments, site.fees, site.renewal, site.refunds, site.regions, site.verified ? "verified" : "listed",
        publication, recorded, recorded, site.verified ? seed.date : null,
        ["chatgpt","claude","gemini","grok","deepseek"].includes(site.slug) ? "official" : ["openrouter","perplexity","hugging-face"].includes(site.slug) ? "third_party" : "unknown").lastInsertRowid);
    siteIds.set(site.slug, id);
    const insertDomain = db.prepare("INSERT INTO site_domains(domain,site_id,kind,registrable) VALUES (?,?,?,?)");
    const primary = websiteUrl(site.website);
    insertDomain.run(primary.domain,id,"primary",primary.registrable);
    for (const domain of site.domains) insertDomain.run(domain.domain,id,domain.kind,websiteUrl(domain.domain).registrable);
    defaultSources.set(site.slug, site.source.url);
    addSource(site.slug, site.source.url, site.source.title, site.verified, site.source.excerpt);
    for (const price of site.prices) {
      const source = addSource(site.slug, "source" in price ? price.source : site.source.url, `${site.name} · 官方套餐说明`, true, `${price.plan} · ${price.currency} · ${price.period} · ${price.region}。`);
      db.prepare(`INSERT INTO price_records(site_id,source_id,plan,amount_minor,currency,period,region,notes,recorded_at,publication)
        VALUES (?,?,?,?,?,?,?,?,?,'published')`).run(id, source, price.plan, price.amount, price.currency, price.period, price.region, price.notes, seed.date);
    }
    db.prepare("INSERT INTO audit_log(actor,action,entity,entity_id,after_json,created_at) VALUES (?,?,?,?,?,?)")
      .run("初始编辑资料", "seed", "sites", String(id), JSON.stringify({ slug: site.slug, publication, source: site.source.url, verified: site.verified }), seed.date);
  }

  for (const review of seed.reviews) {
    const id = Number(db.prepare(`INSERT INTO editorials(slug,site_id,title,summary,body,publication,updated_at)
      VALUES (?,?,?,?,?,'published',?)`).run(review.slug, review.site ? siteIds.get(review.site)! : null,
      review.title, review.summary, review.body, seed.date).lastInsertRowid);
    for (const [label, claim, slug, ref] of review.claims) {
      const source = addSource(slug, ref ?? defaultSources.get(slug)!, `${slug} · 官方公告`, true, claim);
      db.prepare("INSERT INTO editorial_claims(editorial_id,label,statement,nature,source_id) VALUES (?,?,?,'official',?)")
        .run(id, label, claim, source);
    }
  }
  for (const event of seed.incidents) {
    const source = addSource(event.site, event.url, `官方记录 · ${event.title}`, true, event.summary);
    db.prepare(`INSERT INTO incidents(site_id,source_id,title,summary,kind,occurred_at,publication)
      VALUES (?,?,?,?,?,?,'published')`).run(siteIds.get(event.site)!, source, event.title, event.summary, event.kind, event.date);
  }
  db.prepare("INSERT INTO seed_runs VALUES (?)").run("v0.3-editorial");
}
