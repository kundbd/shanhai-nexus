CREATE TABLE storefront_feed_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  run_id INTEGER,
  attempted_at TEXT NOT NULL,
  snapshot_url TEXT,
  published_at TEXT,
  state TEXT NOT NULL CHECK(state IN ('reading','updated','unchanged','unavailable')),
  reason TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE storefront_feed_quotes (
  quote_id INTEGER PRIMARY KEY REFERENCES price_records(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>=100),
  observed_at TEXT NOT NULL,
  snapshot_url TEXT NOT NULL
) STRICT;
