CREATE TABLE import_item_reviews (
  item_id INTEGER PRIMARY KEY REFERENCES import_items(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('queued','checking','retry','held','archived','published','duplicate','superseded')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at INTEGER NOT NULL DEFAULT 0,
  token TEXT,
  note TEXT NOT NULL DEFAULT '',
  evidence_url TEXT,
  model_decision TEXT CHECK (model_decision IN ('approve','review')),
  approval_digest TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX import_item_review_queue ON import_item_reviews(state,available_at,item_id);

CREATE TRIGGER archived_import_item_update BEFORE UPDATE OF state,payload ON import_items
WHEN EXISTS (SELECT 1 FROM import_item_reviews r WHERE r.item_id=OLD.id AND r.state='archived')
BEGIN
  SELECT RAISE(ABORT,'此导入条目已归档');
END;
