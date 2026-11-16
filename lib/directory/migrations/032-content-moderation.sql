ALTER TABLE community_posts ADD COLUMN ai_pending INTEGER NOT NULL DEFAULT 0 CHECK(ai_pending IN (0,1));
ALTER TABLE user_reviews ADD COLUMN ai_pending INTEGER NOT NULL DEFAULT 0 CHECK(ai_pending IN (0,1));
CREATE INDEX community_posts_ai_queue ON community_posts(id DESC) WHERE ai_pending=1 AND hidden=0;
CREATE INDEX user_reviews_ai_queue ON user_reviews(id DESC) WHERE ai_pending=1 AND moderation='pending';

CREATE TABLE member_content_penalties (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES member_accounts(id) ON DELETE RESTRICT,
  surface TEXT NOT NULL CHECK(surface IN ('post','review')),
  fingerprint TEXT NOT NULL,
  category TEXT NOT NULL,
  strike INTEGER NOT NULL CHECK(strike>0),
  created_at INTEGER NOT NULL,
  muted_until INTEGER,
  UNIQUE(account_id,strike)
) STRICT;
CREATE INDEX content_penalty_fingerprint ON member_content_penalties(account_id,fingerprint,created_at DESC);

CREATE TABLE content_ai_requests (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES member_accounts(id) ON DELETE RESTRICT,
  surface TEXT NOT NULL CHECK(surface IN ('post','review')),
  status TEXT NOT NULL CHECK(status IN ('running','allowed','violation','review','error')),
  started_at INTEGER NOT NULL
) STRICT;
CREATE INDEX content_ai_requests_by_time ON content_ai_requests(started_at);
CREATE INDEX content_ai_requests_by_member ON content_ai_requests(account_id,started_at);
