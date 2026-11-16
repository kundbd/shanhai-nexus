ALTER TABLE price_records RENAME TO price_records_before_products;

CREATE TABLE price_records (
  id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE RESTRICT, plan TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>=0), currency TEXT NOT NULL CHECK(length(currency)=3),
  period TEXT NOT NULL, region TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', recorded_at TEXT NOT NULL,
  publication TEXT NOT NULL CHECK(publication IN ('draft','published','archived')),
  storefront_observed INTEGER NOT NULL DEFAULT 0 CHECK(storefront_observed IN (0,1)),
  reported_item_url TEXT CHECK(reported_item_url IS NULL OR storefront_observed=1),
  product_title TEXT
) STRICT;

INSERT INTO price_records(id,site_id,source_id,plan,amount_minor,currency,period,region,notes,recorded_at,publication,storefront_observed,reported_item_url)
SELECT id,site_id,source_id,plan,amount_minor,currency,period,region,notes,recorded_at,publication,storefront_observed,reported_item_url
FROM price_records_before_products;

DROP TABLE price_records_before_products;

CREATE UNIQUE INDEX price_observation_identity ON price_records(site_id,plan,currency,period,region,recorded_at,
  coalesce(reported_item_url,CASE WHEN storefront_observed=1 THEN CAST(source_id AS TEXT) END,''));
CREATE INDEX price_site_date ON price_records(site_id,publication,recorded_at DESC);
CREATE INDEX price_source ON price_records(source_id);
