ALTER TABLE submissions ADD COLUMN merchant_name TEXT;
ALTER TABLE submissions ADD COLUMN merchant_category TEXT REFERENCES categories(slug) ON DELETE RESTRICT;
ALTER TABLE submissions ADD COLUMN publication_consent INTEGER NOT NULL DEFAULT 0 CHECK(publication_consent IN (0,1));
ALTER TABLE submissions ADD COLUMN intake_run INTEGER REFERENCES coverage_runs(id) ON DELETE RESTRICT;
