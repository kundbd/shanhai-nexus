CREATE TABLE content_region_rules (
  kind TEXT NOT NULL CHECK (kind IN ('guide','site','category','editorial','ad','promotion')),
  content_key TEXT NOT NULL CHECK (length(content_key) BETWEEN 1 AND 1500),
  mode TEXT NOT NULL CHECK (mode IN ('cn','overseas','countries')),
  countries TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(countries) AND json_type(countries)='array'
    AND ((mode='countries' AND json_array_length(countries)>0) OR (mode<>'countries' AND json_array_length(countries)=0))),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind,content_key)
) STRICT;

CREATE VIEW content_region_overseas AS
SELECT kind,content_key FROM content_region_rules r
WHERE mode='overseas' OR (mode='countries' AND NOT EXISTS(
  SELECT 1 FROM json_each(r.countries) WHERE type<>'text' OR length(value)<>2 OR upper(value)='CN'
));

DROP TRIGGER retired_network_site_insert;
DROP TRIGGER retired_network_site_update;

CREATE TRIGGER retired_network_site_insert BEFORE INSERT ON sites
WHEN NEW.publication='published'
  AND (NEW.category_slug IN ('airport','vpn','proxy-services','residential') OR NEW.slug='tailscale')
  AND (NOT EXISTS(SELECT 1 FROM content_region_overseas WHERE kind='site' AND content_key=NEW.slug)
    OR (NEW.category_slug IN ('airport','vpn','proxy-services','residential')
      AND NOT EXISTS(SELECT 1 FROM content_region_overseas WHERE kind='category' AND content_key=NEW.category_slug)))
BEGIN
  SELECT RAISE(ABORT,'此服务已下架，无法发布。请先配置允许的境外地区。');
END;

CREATE TRIGGER retired_network_site_update BEFORE UPDATE OF publication,category_slug,slug ON sites
WHEN NEW.publication='published'
  AND (NEW.category_slug IN ('airport','vpn','proxy-services','residential') OR NEW.slug='tailscale')
  AND (NOT EXISTS(SELECT 1 FROM content_region_overseas WHERE kind='site' AND content_key=NEW.slug)
    OR (NEW.category_slug IN ('airport','vpn','proxy-services','residential')
      AND NOT EXISTS(SELECT 1 FROM content_region_overseas WHERE kind='category' AND content_key=NEW.category_slug)))
BEGIN
  SELECT RAISE(ABORT,'此服务已下架，无法发布。请先配置允许的境外地区。');
END;
