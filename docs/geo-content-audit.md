# 山海知序地区内容分流审计

审计日期为 2026 年 11 月 19 日。正式站运行 Next.js 16.4.6、Node.js 和单一 SQLite 内容库，当前应用发布目录为 `20261119-import-review`。本地开发基线取自 `D:\Shanhai-Nexus` 实际源码。

## 部署与信任边界

- `shanhainexus.com` 使用 Cloudflare 权威 DNS。主域和 `www` 的 A 记录指向同一个 VPS，公开 HTTPS 响应来自 Nginx。HTTP 流量直接访问源站。
- 山海知序应用只监听 `127.0.0.1:3180`。Nginx 用 `$proxy_add_x_forwarded_for` 将连接端的 `$remote_addr` 追加到 `X-Forwarded-For` 末尾。站点配置没有重写对端地址的 `real_ip` 规则，正式站应用页返回 `private, no-store` 语义，站点虚拟主机关闭了访问日志。 [Cloudflare DNS 代理说明](https://developers.cloudflare.com/dns/proxy-status/) · [Nginx 代理变量](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#var_proxy_add_x_forwarded_for)
- IP 识别采用明确启用的直连 Nginx 模式。应用在回环监听条件下，只取代理追加的末项，使用本地 Country MMDB 查表。数据库缺失、损坏、地址无效或未识别时使用中国大陆内容策略。地区识别不保存 IP。

## 内容与缓存

- `content/guides.json` 和 `content/articles/` 提供知识文章、教程和常见问题，`lib/search/` 搜索标题和正文。教程详情当前参与静态预渲染。
- 服务档案、分类、山海观察、价格、排行和评价数据来自 SQLite。既有归档状态由迁移 `040` 保留，旧导入归档由迁移 `042` 管理。网络服务既有自动采集限制仍生效。
- 首页广告数据目前写在 `HomeAdCarousel` 客户端组件。若只在渲染时隐藏，受限的卡片信息仍会进入浏览器脚本或 RSC。
- `/search` 已为动态页。站点地图当前动态生成，尚无地区规则。头像使用独立二进制接口和公开缓存，需纳入地区校验。

## 最小调整范围

| 文件或模块 | 变更 |
| --- | --- |
| `lib/geo/`、`next.config.ts` | 本地 IP 识别、地区策略和请求内复用，避免 HTML、RSC、头像接口及站点地图的共享缓存 |
| `lib/directory/migrations/043-*.sql`、`lib/directory/db.ts` | 原库新增按内容对象登记的可见性规则。只有配置境外规则后，现有网络服务档案才能由管理员手动发布 |
| `app/admin/visibility/`、`app/api/admin/manage/route.ts` | 用现有管理员会话、同源校验和审计记录保存策略 |
| `lib/directory/`、`lib/search/`、`app/`、`components/` | 在查询计数、排序、分页、摘要生成及客户端序列化前过滤，直链和关联入口沿用同一规则 |
| `lib/catalog/home-ads.ts`、`components/directory/home-ad-carousel.tsx` | 从客户端移出广告数据，由服务端传递允许的卡片，复用轮播和广告标识 |
| `app/layout.tsx`、`components/site/footer.tsx` | 页脚显示当前内容地区 |
| `tests/`、`deploy/` | 独立库和回环代理测试，说明地区库更新、上线与回滚 |

站点地图只提交全地区可见的内容。境外范围由明确配置的地区决定，多地区内容共用现有模板。测试目录使用独立数据库和端口，正式部署需另行批准。
