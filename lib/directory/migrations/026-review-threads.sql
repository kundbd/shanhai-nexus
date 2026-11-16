ALTER TABLE user_reviews ADD COLUMN reply_to INTEGER REFERENCES user_reviews(id) ON DELETE RESTRICT;
ALTER TABLE user_reviews ADD COLUMN thread_id INTEGER REFERENCES user_reviews(id) ON DELETE RESTRICT
  CHECK((thread_id IS NULL AND reply_to IS NULL) OR
        (thread_id IS NOT NULL AND reply_to IS NOT NULL AND thread_id<>id AND reply_to<>id AND score IS NULL AND trim(body)<>''));

DROP INDEX review_visitor_per_site;
CREATE UNIQUE INDEX review_visitor_per_site ON user_reviews(site_id,visitor_hash) WHERE visitor_hash IS NOT NULL AND thread_id IS NULL;
CREATE INDEX review_thread_entries ON user_reviews(thread_id,moderation,submitted_at DESC,id DESC);
CREATE INDEX review_reply_target ON user_reviews(reply_to);
CREATE INDEX published_review_threads ON user_reviews(submitted_at DESC,id DESC) WHERE thread_id IS NULL AND body<>'' AND moderation='accepted';
