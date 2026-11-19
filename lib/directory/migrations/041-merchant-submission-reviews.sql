CREATE TABLE merchant_submission_reviews (
  submission_id INTEGER PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('checking','retry','held','published')),
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  available_at INTEGER NOT NULL,
  token TEXT,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
) STRICT;
