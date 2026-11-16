ALTER TABLE user_reviews ADD COLUMN visitor_hash TEXT;
CREATE UNIQUE INDEX review_visitor_per_site ON user_reviews(site_id,visitor_hash) WHERE visitor_hash IS NOT NULL;
CREATE INDEX review_recent ON user_reviews(submitted_at DESC);
CREATE INDEX review_visitor_recent ON user_reviews(visitor_hash,submitted_at DESC) WHERE visitor_hash IS NOT NULL;
CREATE INDEX review_queue ON user_reviews(moderation,submitted_at DESC,id DESC);

CREATE TABLE review_blocked_words (word TEXT PRIMARY KEY, normalized TEXT NOT NULL UNIQUE) STRICT;
INSERT INTO review_blocked_words(word,normalized) VALUES
  ('傻逼','傻逼'),('操你妈','操你妈'),('刷单返利','刷单返利'),('加群领红包','加群领红包'),('博彩送彩金','博彩送彩金');
