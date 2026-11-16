ALTER TABLE editorials ADD COLUMN origin TEXT NOT NULL DEFAULT 'editorial'
  CHECK(origin IN ('editorial','third_party'));
