CREATE TABLE categories (
  slug TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
  parent_slug TEXT REFERENCES categories(slug) ON DELETE RESTRICT,
  position INTEGER NOT NULL DEFAULT 0, CHECK(parent_slug IS NULL OR parent_slug <> slug)
) STRICT;
CREATE TABLE sites (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, website TEXT NOT NULL,
  category_slug TEXT NOT NULL REFERENCES categories(slug) ON DELETE RESTRICT,
  summary TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(aliases)),
  contact TEXT, products TEXT, payments TEXT, fees TEXT, renewal TEXT, refunds TEXT, regions TEXT,
  status TEXT NOT NULL DEFAULT 'listed' CHECK(status IN ('listed','verified','tested')),
  publication TEXT NOT NULL DEFAULT 'draft' CHECK(publication IN ('draft','published','archived')),
  added_at TEXT NOT NULL, updated_at TEXT NOT NULL, verified_at TEXT
) STRICT;
CREATE TABLE site_domains (
  domain TEXT PRIMARY KEY COLLATE NOCASE,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('primary','alias','historical'))
) STRICT;
CREATE UNIQUE INDEX site_primary_domain ON site_domains(site_id) WHERE kind='primary';
CREATE INDEX site_domains_owner ON site_domains(site_id);
CREATE INDEX public_directory ON sites(publication, category_slug, status, updated_at DESC, id DESC);
CREATE INDEX public_recent ON sites(publication, updated_at DESC, id DESC);

CREATE TABLE sources (
  id INTEGER PRIMARY KEY, site_id INTEGER REFERENCES sites(id) ON DELETE RESTRICT,
  title TEXT NOT NULL, url TEXT NOT NULL, accessed_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('official','tested','media','user','pending')),
  verified INTEGER NOT NULL CHECK(verified IN (0,1)),
  excerpt TEXT NOT NULL DEFAULT '', digest TEXT NOT NULL DEFAULT '',
  UNIQUE(site_id,url,accessed_at)
) STRICT;
CREATE UNIQUE INDEX global_source_unique ON sources(url,accessed_at) WHERE site_id IS NULL;
CREATE TABLE editorials (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, site_id INTEGER REFERENCES sites(id) ON DELETE RESTRICT,
  title TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL,
  publication TEXT NOT NULL CHECK(publication IN ('draft','published','archived')), updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE editorial_claims (
  id INTEGER PRIMARY KEY, editorial_id INTEGER NOT NULL REFERENCES editorials(id) ON DELETE CASCADE,
  label TEXT NOT NULL, statement TEXT NOT NULL,
  nature TEXT NOT NULL CHECK(nature IN ('official','tested','media','user','pending')),
  source_id INTEGER REFERENCES sources(id) ON DELETE RESTRICT,
  CHECK(nature='pending' OR source_id IS NOT NULL)
) STRICT;
CREATE INDEX editorial_site ON editorials(site_id,publication,updated_at DESC);
CREATE INDEX editorial_claims_parent ON editorial_claims(editorial_id);
CREATE INDEX editorial_claims_source ON editorial_claims(source_id);

CREATE TABLE price_records (
  id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE RESTRICT, plan TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>=0), currency TEXT NOT NULL CHECK(length(currency)=3),
  period TEXT NOT NULL, region TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', recorded_at TEXT NOT NULL,
  publication TEXT NOT NULL CHECK(publication IN ('draft','published','archived')),
  UNIQUE(site_id,plan,currency,period,region,recorded_at)
) STRICT;
CREATE INDEX price_site_date ON price_records(site_id,publication,recorded_at DESC);
CREATE INDEX price_source ON price_records(source_id);
CREATE TABLE incidents (
  id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  title TEXT NOT NULL, summary TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('price','policy','status','other')),
  occurred_at TEXT NOT NULL, publication TEXT NOT NULL CHECK(publication IN ('draft','published','archived')),
  UNIQUE(site_id,title,occurred_at)
) STRICT;
CREATE INDEX incident_date ON incidents(publication,occurred_at DESC);
CREATE INDEX incident_site ON incidents(site_id,publication);
CREATE INDEX incident_source ON incidents(source_id);

CREATE TABLE user_reviews (
  id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  score INTEGER CHECK(score BETWEEN 1 AND 5), body TEXT NOT NULL, submitted_at TEXT NOT NULL,
  moderation TEXT NOT NULL CHECK(moderation IN ('pending','accepted','rejected')),
  evidence_state TEXT NOT NULL DEFAULT 'unverified' CHECK(evidence_state IN ('unverified','verified','rejected'))
) STRICT;
CREATE INDEX moderated_reviews ON user_reviews(site_id,moderation);
CREATE TABLE submissions (
  id INTEGER PRIMARY KEY, site_id INTEGER REFERENCES sites(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('site','correction','response')),
  url TEXT, body TEXT NOT NULL, submitted_at TEXT NOT NULL,
  moderation TEXT NOT NULL DEFAULT 'pending' CHECK(moderation IN ('pending','accepted','rejected')),
  review_note TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX submissions_queue ON submissions(moderation,submitted_at DESC);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL,
  entity_id TEXT NOT NULL, before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK(after_json IS NULL OR json_valid(after_json)), created_at TEXT NOT NULL
) STRICT;
CREATE INDEX audit_entity ON audit_log(entity,entity_id,id DESC);
CREATE TABLE import_batches (id INTEGER PRIMARY KEY, format TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
CREATE TABLE import_items (
  id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  payload TEXT NOT NULL CHECK(json_valid(payload)), domain TEXT, state TEXT NOT NULL CHECK(state IN ('ready','failed','duplicate','approved','published')),
  message TEXT NOT NULL DEFAULT '', site_id INTEGER REFERENCES sites(id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX import_batch_rows ON import_items(batch_id,id);
