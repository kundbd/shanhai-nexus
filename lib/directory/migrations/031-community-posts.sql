CREATE TABLE community_posts (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES member_accounts(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  thread_id INTEGER REFERENCES community_posts(id) ON DELETE RESTRICT,
  reply_to INTEGER REFERENCES community_posts(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)),
  CHECK((thread_id IS NULL AND reply_to IS NULL) OR
        (thread_id IS NOT NULL AND reply_to IS NOT NULL AND thread_id<>id AND reply_to<>id))
) STRICT;
CREATE INDEX community_posts_feed ON community_posts(created_at DESC,id DESC) WHERE thread_id IS NULL AND hidden=0;
CREATE INDEX community_post_replies ON community_posts(thread_id,created_at,id) WHERE hidden=0;
CREATE INDEX community_post_reply_targets ON community_posts(reply_to) WHERE hidden=0;
CREATE INDEX community_author_recent ON community_posts(author_id,created_at DESC);

CREATE TABLE community_reactions (
  post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES member_accounts(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('like','repost','bookmark')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(post_id,kind,account_id)
) STRICT;
CREATE INDEX community_reposts_feed ON community_reactions(created_at DESC,post_id DESC) WHERE kind='repost';
CREATE INDEX community_bookmarks ON community_reactions(account_id,created_at DESC,post_id DESC) WHERE kind='bookmark';

CREATE TABLE community_media (
  id TEXT PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 3),
  content_type TEXT NOT NULL CHECK(content_type IN ('image/webp','video/mp4','video/webm')),
  size_bytes INTEGER NOT NULL CHECK(size_bytes>0),
  UNIQUE(post_id,position)
) STRICT;
