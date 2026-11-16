ALTER TABLE price_records ADD COLUMN reported_item_url TEXT
  CHECK(reported_item_url IS NULL OR storefront_observed=1);
