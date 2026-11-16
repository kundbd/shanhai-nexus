CREATE TABLE merchant_avatars (
  site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  website TEXT NOT NULL,
  source_url TEXT,
  content_type TEXT CHECK(content_type IN ('image/webp','image/x-icon')),
  image BLOB,
  digest TEXT,
  checked_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  CHECK((image IS NULL AND content_type IS NULL AND digest IS NULL AND source_url IS NULL)
    OR (image IS NOT NULL AND length(image) BETWEEN 4 AND 65536 AND content_type IS NOT NULL AND length(digest)=64 AND source_url IS NOT NULL))
) STRICT;
