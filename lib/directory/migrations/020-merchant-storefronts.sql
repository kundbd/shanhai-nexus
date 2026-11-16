CREATE TABLE merchant_storefronts (
  storefront_key TEXT PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  host TEXT NOT NULL COLLATE NOCASE,
  source_url TEXT NOT NULL,
  discovery_url TEXT,
  observed_at TEXT NOT NULL
) STRICT;
CREATE INDEX merchant_storefronts_site ON merchant_storefronts(site_id);

ALTER TABLE price_records ADD COLUMN storefront_observed INTEGER NOT NULL DEFAULT 0 CHECK(storefront_observed IN (0,1));
