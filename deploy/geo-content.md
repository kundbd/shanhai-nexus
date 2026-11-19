# 地区内容分流部署与回滚

[只读审计和文件清单](../docs/geo-content-audit.md)

## 使用方式

后台打开「更多管理 → 内容维护 → 地区可见性」，选择知识文章与教程、山海观察、服务档案、服务分类、首页轮播广告或推广链接。服务商、分类、山海观察的编辑页也有「地区可见性」链接。

- 无专门规则的通用资料沿用全地区可见。未知出口地址使用中国大陆策略。
- 「仅香港及已允许的海外地区」包含香港和 `GEO_ALLOWED_OVERSEAS` 列出的境外国家。指定国家或地区时，直接使用该记录保存的国家代码。两种设置都可使用同一套界面。
- 分类的规则会应用到下级分类和档案，档案的规则会应用到商品、报价、头像及关联评价。山海观察可设更窄的地区范围。
- 已归档的机场、VPN、代理和住宅网络档案需要在归档分类及服务档案分别保存境外规则，再通过现有编辑页手动发布。既有批量导入、自动发现和采集规则继续处理原有分类。
- 广告和推广链接的规则共同生效。推广链接按完整地址匹配，查询参数次序等价，邀请码和片段属于链接的一部分。
- 通用站点地图仅列出全地区可见内容。地区限定详情标记 `noindex`，直链经服务端校验后显示地区不可用页面。

## 数据库变更

`043-content-regions.sql` 在现有 SQLite 中创建 `content_region_rules` 表和用于校验境外发布条件的视图，并替换两个网络档案发布触发器。初始规则表为空。迁移保留既有内容行、归档状态和主键。通过后台保存规则会写入已有审核日志。

## 独立验证

在受控的独立目录安装依赖、构建并验证。使用 Node 24 和项目锁文件。

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
node scripts/install-geoip-db.mjs /path/to/dbip-country-lite-YYYY-MM.mmdb.gz data/geoip/country.mmdb
npm run test:geo
node --import tsx tests/integration/geo-legacy-db.ts /path/to/local-backup.sqlite
```

地区集成测试使用回环代理，与现网 Nginx 一样把已知测试对端地址加到末尾。测试分别使用 CN、HK、US 和未知对端，复用同一 URL 验证 HTML、RSC、缓存、直链、搜索、广告、产品和管理员操作。若测试 MMDB 另存，可设置 `GEO_TEST_MMDB` 为文件的绝对路径。

SQLite 迁移验证保留 `pre-043.sqlite` 作为离线回滚校验备份，脚本输出其路径。在独立测试库验证桌面和手机时，应分次调用 Playwright，评价用例会更新每次运行的测试库屏蔽词。 [验收记录](../docs/geo-content-validation.md)

## 上线前检查

1. 获得正式部署批准，记录当前运行发布目录和 Git 提交。按 [原部署说明](README.md) 对业务 SQLite 做在线备份，验证备份的完整性和读权限。将当前生效的应用环境配置和 Country MMDB 备份到业务备份目录。
2. 核对 CDN 仍为仅 DNS，山海知序应用上游仍只监听回环地址，站点 Nginx 仍按已审计方式追加对端地址。确认站点访问日志配置和文件读取权限。
3. 从 [DB-IP IP to Country Lite](https://db-ip.com/db/download/ip-to-country-lite) 下载当月 Country MMDB 压缩包，按发布页校验解压文件的摘要。用安装脚本校验格式并原子替换文件。应用身份须可读取文件。推荐目录为 `/var/lib/shanhai-nexus/geoip/`。
4. 正式环境变量仅放在山海知序应用服务的应用配置中。默认先用 `GEO_IP_MODE=off`，需要启用识别时按下例设定。境外代码只填管理员已决定开放的国家。

```dotenv
GEO_IP_MODE=nginx-direct
GEO_IP_DB=/var/lib/shanhai-nexus/geoip/country.mmdb
GEO_ALLOWED_OVERSEAS=
```

5. 在独立发布目录构建 standalone 产物，按已有发布流程运行迁移并切换应用版本。验证首页与目录、登录跳转、后台表单、公开站点地图和静态资源。用实际授权网络出口核对要开放的地区。

应用按请求生成地区相关 HTML 和 RSC，返回禁止共享缓存的响应。静态资源继续使用原有带哈希的缓存。后续如启用 Cloudflare HTTP 代理，先关闭当前直连识别模式。重新验证代理身份、可信国家头和源站边界后，再启用相应识别方案。对于应用 HTML、RSC、站点地图和头像接口，CDN 必须保留源站缓存约束。

## 国家库更新

DB-IP Country Lite 每月更新。可在业务维护中下载当月文件，校验发布方提供的摘要，再运行 `scripts/install-geoip-db.mjs`。安装脚本先验证 Country MMDB 格式，再原子替换；应用按需在约一分钟内重新读取发生变化的库文件。文件缺失或不可读时回落到中国大陆策略。站点页脚按数据许可链接至 [DB-IP](https://db-ip.com)。

## 回滚

- 地区库或代理识别异常时，将山海知序应用的 `GEO_IP_MODE` 设为 `off`，按应用发布流程重新加载配置。此时按中国大陆策略执行，数据库规则和用户数据可以保留。
- 新版本发生应用错误且尚未保存地区规则时，按已记录的发布目录回切上一版本。迁移表和新规则表可留在 SQLite 中。
- 已经保存地区限定规则时，应先使用保留地区检查的应用版本恢复服务。旧代码无法解释这些规则，直接回切会公开受限记录。确需回到旧代码时，先在独立环境验证备份恢复和所有受限内容的可见性，再经批准安排回滚。恢复旧库前保存当前库并处理上线后的新增数据。
