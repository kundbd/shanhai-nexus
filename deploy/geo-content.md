# 地区内容分流部署与回滚

[只读审计和文件清单](../docs/geo-content-audit.md)

## 使用方式

后台打开「更多管理 → 内容维护 → 地区可见性」，选择知识文章与教程、山海观察、服务档案、服务分类、首页轮播广告或推广链接。服务商、分类、山海观察的编辑页也有「地区可见性」链接。

- 无专门规则的通用资料沿用全地区可见。未知出口地址使用中国大陆策略。
- 「仅中国大陆以外地区可见」适用于所有识别为非大陆的访问。指定国家或地区时，直接使用该记录保存的国家代码。
- 顶部在亚洲（含东南亚）、欧洲和北美显示具体国家或地区与相应旗帜。中国台湾使用中国国旗。其余已识别地区显示「其他区域」，适用相同的境外内容策略。 [Unicode CLDR 地区分组](https://github.com/unicode-org/cldr-json/blob/49.0.0/cldr-json/cldr-core/supplemental/territoryContainment.json) · [旗帜素材](https://github.com/lipis/flag-icons/tree/v7.6.0)
- 分类的规则会应用到下级分类和档案，档案的规则会应用到商品、报价、头像及关联评价。山海观察可设更窄的地区范围。
- 原先统一下架且之后未被单独审核的网络服务档案恢复为境外可见。其他归档档案可在后台保存境外规则后手动发布。首页轮播使用目前的广告配置。
- 广告和推广链接的规则共同生效。推广链接按完整地址匹配，查询参数次序等价，邀请码和片段属于链接的一部分。
- 通用站点地图仅列出全地区可见内容。地区限定详情标记 `noindex`，直链经服务端校验后显示地区不可用页面。

## 数据库变更

`043-content-regions.sql` 在现有 SQLite 中创建 `content_region_rules` 表和用于校验境外发布条件的视图，并替换两个网络档案发布触发器。通过后台保存规则会写入已有审核日志。

`044-overseas-network-publication.sql` 使用统一下架时的审核记录，恢复符合条件的已公开档案，并为关联的网络分类和档案保存境外规则。既有单项审核和地区配置会保留。每次恢复都记录在审核日志中，报价和其他业务记录沿用原值。

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

地区集成测试使用回环代理，与现网 Nginx 一样把已知测试对端地址加到末尾。测试覆盖 CN、HK、TW、SG、DE、US、其他区域和未知对端，复用同一 URL 验证顶部标识、HTML、RSC、缓存、直链、搜索、广告、产品和管理员操作。若测试 MMDB 另存，可设置 `GEO_TEST_MMDB` 为文件的绝对路径。

SQLite 迁移验证保留 `pre-043.sqlite` 和 `pre-044.sqlite` 作为离线回滚校验备份，脚本输出其路径。在独立测试库验证桌面和手机时，应分次调用 Playwright，评价用例会更新每次运行的测试库屏蔽词。 [验收记录](../docs/geo-content-validation.md)

## 上线前检查

1. 获得正式部署批准，记录当前运行发布目录和 Git 提交。按 [原部署说明](README.md) 对业务 SQLite 做在线备份，验证备份的完整性和读权限。将当前生效的应用环境配置和 Country MMDB 备份到业务备份目录。
2. 核对 CDN 仍为仅 DNS，山海知序应用上游仍只监听回环地址，站点 Nginx 仍按已审计方式追加对端地址。确认站点访问日志配置和文件读取权限。
3. 从 [DB-IP IP to Country Lite](https://db-ip.com/db/download/ip-to-country-lite) 下载当月 Country MMDB 压缩包，按发布页校验解压文件的摘要。用安装脚本校验格式并原子替换文件。应用身份须可读取文件。推荐目录为 `/var/lib/shanhai-nexus/geoip/`。
4. 正式环境变量仅放在山海知序应用服务的应用配置中。默认先用 `GEO_IP_MODE=off`，需要启用识别时按下例设定。

```dotenv
GEO_IP_MODE=nginx-direct
GEO_IP_DB=/var/lib/shanhai-nexus/geoip/country.mmdb
```

5. 在独立发布目录构建 standalone 产物，按已有发布流程运行迁移并切换应用版本。验证首页与目录、登录跳转、后台表单、公开站点地图和静态资源。用实际授权网络出口核对要开放的地区。

应用按请求生成地区相关 HTML 和 RSC，返回禁止共享缓存的响应。静态资源继续使用原有带哈希的缓存。后续如启用 Cloudflare HTTP 代理，先关闭当前直连识别模式。重新验证代理身份、可信国家头和源站边界后，再启用相应识别方案。对于应用 HTML、RSC、站点地图和头像接口，CDN 必须保留源站缓存约束。

## 国家库更新

DB-IP Country Lite 每月更新。可在业务维护中下载当月文件，校验发布方提供的摘要，再运行 `scripts/install-geoip-db.mjs`。安装脚本验证 Country MMDB 格式后原子替换。应用按需在约一分钟内重新读取发生变化的文件。文件缺失或不可读时回落到中国大陆策略。站点顶部按数据许可链接至 [DB-IP](https://db-ip.com)。

## 回滚

- 地区库或代理识别异常时，将山海知序应用的 `GEO_IP_MODE` 设为 `off`，按应用发布流程重新加载配置。此时按中国大陆策略执行，数据库规则和用户数据可以保留。
- 执行 044 后，回切到已启用 043 的上一发布版本可以保留地区校验。在旧版境外组策略下，目录显示范围可能较窄。
- 回切到不含地区检查的更早版本前，先在独立环境验证备份恢复和所有受限档案的可见性，再经批准安排回滚。恢复旧库前保存当前库并处理上线后的新增数据。
