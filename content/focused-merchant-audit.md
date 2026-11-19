# 重点商家扩容审计 · 2026-11-15

本地采集任务 #2 覆盖 AI 会员代充、卡网、成品号商家、中文 API 中转和节点订阅。任务已暂停，可从 SQLite 继续领取待执行任务。公开目录从 423 增至 472 家，本轮 49 家均通过官网资料核查与编辑审批。证据范围为官网身份和其公开陈述的服务，价格、履约与实际节点质量未在此批核验。

| 分类 | 原有 | 新增 | 当前 |
| --- | ---: | ---: | ---: |
| AI 代充 | 43 | 8 | 51 |
| AI 卡网、卡密及账号商品 | 24 | 14 | 38 |
| AI API 中转及聚合 | 71 | 26 | 97 |
| 机场、节点订阅 | 21 | 1 | 22 |
| 商业 VPN | 46 | 0 | 46 |
| 代理 IP | 77 | 0 | 77 |
| VPS | 90 | 0 | 90 |
| 住宅 IP 主机 | 6 | 0 | 6 |

## 候选与核验口径

- 保留 2,335 个唯一注册域及 13,265 条可追溯网址记录。对照此前采集任务和已收录档案，1,389 个注册域首次出现。新域里有 965 个被筛除、7 个被编辑拒绝、300 个核查失败、61 个需人工确认、56 个通过官网身份与主营业务检查。未达到 1,000 条独立真实商家线索的目标。
- 候选池有 97 条通过初步核查并具备审批条件，其中 49 家发布，48 条保留待审批。另有 136 条需要人工确认身份，426 条官网核查未完成，77 条已收录，1,582 条规则筛除，17 条编辑拒绝。
- 完成 2,258 个域、2,408 次官网核查。150 条先前超时记录按原路重试，108 条仍超时，42 条返回其他结果，其中没有新增官网核实。最终未核查完成的 426 条分为 robots.txt 相关 221、连接或读取超时 149、其他 HTTP 状态 45、其他网络原因 11。
- 277 个独立查询共发出 285 次 DeepSeek Search 请求，277 次返回非空结果，8 次计费结果不明。按官价估算 ¥1.385，本轮台账保守预留 ¥1.425。两批大规模任务合计预留 ¥3.135，旧单来源台账另有 1 次，按 ¥0.005 预留后一共 ¥3.140，低于 ¥10 上限。账单实扣以服务商记录为准。[DeepSeek Search 计费](https://api-docs.deepseek.com/zh-cn/guides/search/#计费)

## 来源贡献

“首次出现”指和以往采集及现有已知档案相比的新域；各来源有共享域名。“核对/已查”指符合官网证据与审批门槛 / 该来源实际进入核查的域。“首来源发布”按第一次发现归因，合计 49。

| 来源 | 唯一域 | 首次出现 | 首次出现率 | 核对 / 已查 | 核对率 | 有此来源的发布 | 首来源发布 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| DeepSeek Search | 2,136 | 1,226 | 57.4% | 92 / 2,078 | 4.4% | 44 | 44 |
| All LLM Providers（MIT） | 150 | 120 | 80.0% | 3 / 141 | 2.1% | 3 | 2 |
| AI API Atlas（MIT） | 29 | 22 | 75.9% | 0 / 25 | 0% | 0 | 0 |
| VPNInfobase 授权域名快照 | 22 | 17 | 77.3% | 0 / 18 | 0% | 0 | 0 |
| 编辑独立检索 · AI 商家官网 | 9 | 5 | 55.6% | 3 / 6 | 50.0% | 3 | 3 |
| free-llm-hub（MIT） | 8 | 4 | 50.0% | 0 / 6 | 0% | 0 | 0 |
| 编辑独立检索 · 机场官网 | 5 | 5 | 100% | 0 / 5 | 0% | 0 | 0 |
| Pay2GPT 官网 Sitemap | 1 | 0 | 0% | 0 / 0 | — | 0 | 0 |
| Tangguo 官网 Sitemap | 1 | 0 | 0% | 0 / 0 | — | 0 | 0 |

GitHub 三个快照通过官方 Contents API 读取，只保留公开域名和引用。两份官方 Sitemap 共读到 300 条同站链接，最终归并为两家已有店铺；GetPlus 和 Portkey 公开链接页没有符合导入条件的合作官网外链。[All LLM Providers](https://github.com/foisalislambd/all-llm-provider-list#license) · [AI API Atlas](https://github.com/Vaibhavs25/free-ai-apis-llm/blob/main/LICENSE) · [free-llm-hub](https://github.com/felipetruman/free-llm-hub#-license) · [VPNInfobase 数据许可](https://vpninfobase.com/vpn-audit-register/)

AIprice、AITest123、JiasuWiki、AI CardNav 和中文机场推荐仓库保留了授权审计，均未导入其目录。Models.dev 的 robots.txt 返回无法确认的 HTML。VPN Matrix 数据页授权复用，实际 JSON 地址返回 HTTP 404。GitHub Raw 直连与公开 CDN 分别遇到连接超时、robots.txt HTTP 400，最终使用 GitHub Contents API 获得明确许可且可读的三个快照。[Models.dev 许可](https://github.com/anomalyco/models.dev/blob/dev/LICENSE) · [VPN Matrix 开放数据](https://www.vpn-matrix.com/en/data)

机场和长尾卡网仍是主要缺口。部分品牌有多个自称官网的页面，部分站点只有登录入口或推广跳转。可持续跟进明确授予商家目录数据复用许可的来源，以及站方自主投稿和可公开核验的同主体官网与公开服务页。

## 本地验收

- `output/focused-catalog/baseline.sqlite`、`final.sqlite` 为导入前后备份，`candidates.sqlite` 是可独立打开的候选与来源台账。最终数据库和候选导出通过 SQLite 完整性与外键检查。
- 生产构建、类型检查、ESLint、39 个单元测试通过。真实数据库副本上通过 25 个 Chrome 浏览器回归测试，覆盖 1920、1366、768、390、375 五档宽度、分类筛选、搜索、档案来源、后台权限和导出。
- 桌面和手机版目录及新档案截图位于 `output/playwright/v03/focused-*`。
