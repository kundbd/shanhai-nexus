ALTER TABLE storefront_feed_state ADD COLUMN reviewed_snapshot_url TEXT;

CREATE TABLE storefront_feed_checks (
  quote_id INTEGER PRIMARY KEY REFERENCES price_records(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK(outcome IN ('in_stock','out_of_stock','stale','terms_changed','identity_conflict','uncertain')),
  observed_at TEXT
) STRICT;
