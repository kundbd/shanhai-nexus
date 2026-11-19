import type { DatabaseSync } from "node:sqlite";
import { one } from "./db";
import type { StorefrontObservation } from "./storefront-import";

// Allow one missed five-hour refresh before a storefront check expires.
export const storefrontAvailabilityAge = 10 * 60 * 60_000;

export function invalidateStorefrontAvailability(
  db: DatabaseSync, site: number, url: string, stamp: string, state: "unavailable" | "unconfirmed",
) {
  db.prepare(`INSERT INTO storefront_quote_checks(quote_id,checked_at,state,source_id,amount_minor)
    SELECT p.id,?,?,p.source_id,p.amount_minor FROM price_records p JOIN sources src ON src.id=p.source_id
    WHERE p.site_id=? AND src.url=? AND src.kind='official' AND src.verified=1 AND p.storefront_observed=1
      AND p.reported_item_url IS NULL AND p.publication='published' AND p.recorded_at<=?
    ON CONFLICT(quote_id) DO UPDATE SET state=excluded.state,checked_at=excluded.checked_at,source_id=excluded.source_id,amount_minor=excluded.amount_minor
    WHERE storefront_quote_checks.checked_at<=excluded.checked_at`).run(stamp,state,site,url,stamp);
}

export function saveObservedStorefrontAvailability(db: DatabaseSync, site: number, observation: StorefrontObservation) {
  if (observation.reportedItemUrl) return;
  const { observedAt, sourceUrl } = observation;
  invalidateStorefrontAvailability(db, site, sourceUrl, observedAt, "unconfirmed");
  const save = db.prepare(`INSERT INTO storefront_quote_checks(quote_id,checked_at,state,source_id,amount_minor) VALUES (?,?,?,?,?)
    ON CONFLICT(quote_id) DO UPDATE SET checked_at=excluded.checked_at,state=excluded.state,
      source_id=excluded.source_id,amount_minor=excluded.amount_minor
    WHERE storefront_quote_checks.checked_at<=excluded.checked_at`);
  for (const offer of observation.offers) {
    if (!offer.availability) continue;
    const current = one<{id:number;source_id:number;amount_minor:number;recorded_at:string}>(db, `
      SELECT p.id,p.source_id,p.amount_minor,p.recorded_at FROM price_records p JOIN sources src ON src.id=p.source_id
      WHERE p.site_id=? AND src.url=? AND src.kind='official' AND p.storefront_observed=1
        AND p.reported_item_url IS NULL AND p.publication='published' AND p.currency='CNY'
        AND p.plan=? AND p.period=? AND p.region=?
      ORDER BY p.recorded_at DESC,p.id DESC LIMIT 1`,
    site, sourceUrl, offer.plan, offer.period, offer.region?.trim() || "未注明");
    if (current && current.amount_minor === offer.cnyMinor && current.recorded_at <= observedAt) {
      save.run(current.id, observedAt, offer.availability, current.source_id, current.amount_minor);
    }
  }
}
