CREATE TABLE member_accounts (
  id INTEGER PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  username TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(issuer,subject)
) STRICT;

CREATE TABLE member_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES member_accounts(id) ON DELETE CASCADE,
  provider_tokens TEXT NOT NULL,
  access_expires_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  refresh_started_at INTEGER
) STRICT;
CREATE INDEX member_session_expiry ON member_sessions(expires_at);
CREATE INDEX member_sessions_by_account ON member_sessions(account_id);

ALTER TABLE user_reviews ADD COLUMN account_id INTEGER REFERENCES member_accounts(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX review_account_per_site ON user_reviews(site_id,account_id) WHERE account_id IS NOT NULL AND thread_id IS NULL;
CREATE INDEX member_review_history ON user_reviews(account_id,submitted_at DESC,id DESC) WHERE account_id IS NOT NULL;
