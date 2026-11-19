CREATE TABLE storefront_quote_checks (
  quote_id INTEGER PRIMARY KEY REFERENCES price_records(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('available','unavailable','unconfirmed')),
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL
) STRICT;
