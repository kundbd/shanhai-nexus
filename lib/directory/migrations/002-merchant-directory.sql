UPDATE categories SET label='官方 AI 平台',description='模型厂商的官方订阅与直连 API' WHERE slug='ai-subscriptions';
UPDATE categories SET label='AI 聚合平台',description='整合多家 AI 模型或工具的第三方平台' WHERE slug='ai-platforms';
UPDATE categories SET label='商业 VPN',description='面向消费者的商业 VPN 产品' WHERE slug='vpn';
UPDATE categories SET label='VPS / 云服务器' WHERE slug='vps';
UPDATE categories SET label='其他网络服务',description='设备组网、DNS、CDN 及其他基础设施' WHERE slug='network-infrastructure';
UPDATE categories SET label='跨境支付' WHERE slug='payment-accounts';
INSERT INTO categories(slug,label,description,parent_slug,position) VALUES
 ('ai-topup','AI 会员代充','为现有账号充入会员权益的第三方商家','ai',1),
 ('ai-card','AI 卡网 / 发卡站','公开销售卡密、成品账号或共享席位的店铺','ai',2),
 ('ai-relay','API 中转站','代转发第三方模型 API 的服务','ai',3),
 ('airport','机场 / 节点订阅','通过订阅链接交付代理节点的服务商','network',0),
 ('residential','住宅代理','以住宅 IP 为产品的代理服务商','network',3),
 ('u-card','U 卡','提供与数字资产余额相关的支付卡服务','payments',0),
 ('virtual-card','虚拟信用卡','提供虚拟信用卡或虚拟支付卡的服务','payments',1),
 ('subscription-payment','其他订阅支付服务','提供订阅账单结算及其他数字支付服务','payments',3);
UPDATE categories SET position = CASE slug
 WHEN 'ai-platforms' THEN 4 WHEN 'vpn' THEN 1 WHEN 'vps' THEN 2
 WHEN 'network-infrastructure' THEN 4 WHEN 'payment-accounts' THEN 2 ELSE position END;
UPDATE sites SET category_slug='ai-relay' WHERE slug='openrouter' AND category_slug='ai-platforms';
UPDATE sites SET category_slug='ai-subscriptions' WHERE slug='deepseek' AND category_slug='ai-platforms';
UPDATE sites SET category_slug='ai-platforms' WHERE slug='perplexity' AND category_slug='ai-subscriptions';

ALTER TABLE sites ADD COLUMN operator_kind TEXT NOT NULL DEFAULT 'unknown' CHECK(operator_kind IN ('official','third_party','unknown'));
ALTER TABLE sites ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'unknown' CHECK(lifecycle IN ('unknown','active','closed'));
ALTER TABLE sites ADD COLUMN reachability TEXT NOT NULL DEFAULT 'unchecked' CHECK(reachability IN ('unchecked','reachable','restricted','unreachable','skipped','inconclusive'));
ALTER TABLE sites ADD COLUMN checked_at TEXT;
ALTER TABLE sites ADD COLUMN merchant_details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(merchant_details));
UPDATE sites SET operator_kind='official' WHERE slug IN ('chatgpt','claude','gemini','grok','deepseek') AND category_slug='ai-subscriptions';
UPDATE sites SET operator_kind='third_party' WHERE slug IN ('openrouter','perplexity','hugging-face');
CREATE INDEX site_operating_state ON sites(publication,lifecycle,category_slug,reachability);
ALTER TABLE site_domains ADD COLUMN registrable TEXT;
CREATE INDEX site_registrable ON site_domains(registrable);
ALTER TABLE import_items ADD COLUMN registrable TEXT;
ALTER TABLE import_items ADD COLUMN normalized_name TEXT;
ALTER TABLE import_items ADD COLUMN discovery_key TEXT;
ALTER TABLE import_items ADD COLUMN reachability TEXT NOT NULL DEFAULT 'unchecked' CHECK(reachability IN ('unchecked','reachable','restricted','unreachable','skipped','inconclusive'));
ALTER TABLE import_items ADD COLUMN checked_at TEXT;
ALTER TABLE import_items ADD COLUMN check_detail TEXT NOT NULL DEFAULT '';
ALTER TABLE import_items ADD COLUMN final_url TEXT;
CREATE INDEX import_items_domain ON import_items(domain,state,id);
CREATE INDEX import_items_review ON import_items(batch_id,state,id);
CREATE INDEX import_items_registrable ON import_items(registrable,id);
CREATE INDEX import_items_name ON import_items(normalized_name);
CREATE UNIQUE INDEX import_discovery_once ON import_items(discovery_key) WHERE discovery_key IS NOT NULL;
CREATE TABLE candidate_sources (
  id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES import_items(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL, source_name TEXT NOT NULL, license_url TEXT, acquired_at TEXT NOT NULL,
  UNIQUE(item_id,source_url)
) STRICT;
CREATE INDEX candidate_source_attribution ON candidate_sources(source_name);
ALTER TABLE sources ADD COLUMN attribution TEXT;
ALTER TABLE sources ADD COLUMN license_url TEXT;
CREATE TABLE website_checks (
  id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES import_items(id) ON DELETE CASCADE, checked_at TEXT NOT NULL,
  result TEXT NOT NULL, http_status INTEGER, final_url TEXT, reason TEXT NOT NULL
) STRICT;
CREATE INDEX website_check_item_date ON website_checks(item_id,checked_at DESC);
CREATE TABLE site_redirects (
  old_slug TEXT PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE RESTRICT
) STRICT;
