# V0.3 第三方商家收录审计

本地导入日期为 2026-11-15（UTC+8）。开放清单只保留商家名称、公开入口与来源标识；分类为编辑建议，价格、评分、节点测试、第三方原文和推广参数未纳入。近期官网检查来自本机对公开 HTTP(S) 页面的请求，不能外推到其他网络或时间。

## 用户指定的发现来源

| 来源 | 本次核查 | 处理 |
| --- | --- | --- |
| [AI 价网](https://aiprice.club/) | robots.txt 可读，公开引用说明允许索引及引用，要求勿高频抓取或整库镜像 | 只按单个线索定位商家官网 |
| [AI 价网 GitHub](https://github.com/AIprice-club/aiprice) | CC BY 4.0 数据包含聚合价格，未找到逐店铺官网字段 | 0 条批量贡献 |
| [API Ranking](https://apiranking.com/sites) | 公开列表和[来源方法](https://apiranking.com/about)可读，robots.txt 排除跳转、下载及导出路径 | 使用其独立授权的 GitHub 快照，网站目录未批量复制 |
| [AiTest123](https://aitest123.com/sites/all) | 公开列表可读，robots.txt 排除 API、列表加载与跳转路径，未找到允许再分发目录的授权 | 0 条批量贡献 |
| [API搜](https://apisou.com/) | robots.txt 可读，排除跳转和管理路径，未确认目录再利用许可 | 0 条批量贡献 |
| [API导航](https://www.apizhao.com/) | 主页可访问，robots.txt 声明允许索引和参考，未发现允许数据库再分发的许可 | 0 条批量贡献 |
| [加速 Wiki](https://jiasu.wiki/) | 首页返回 403，robots.txt 请求超时 | 0 条，保留限制 |
| [GateRank](https://gate-rank.com/rankings/all) | 榜单可读，robots.txt 允许索引及检索引用，未找到再分发目录的许可 | 0 条批量贡献 |
| [飞渡笔记](https://www.feidujc.com/airports/) | 目录与 robots.txt 可读，未找到允许再分发目录的许可 | 0 条批量贡献 |
| [Keysqiu/vpnproxy](https://github.com/Keysqiu/vpnproxy) | README 可读取，仓库树未见 LICENSE | 0 条批量贡献 |

公开可读和可引用只用于发现、查找和核对单条来源。本次对常见条款入口及站点公开说明进行了检查；无法获得许可的来源未作批量再分发。另查到 [VPN Matrix](https://www.vpn-matrix.com/en/data) 声明数据采用 CC BY-SA 4.0，本次 JSON 与 CSV 导出均返回 404。[机场推荐 GitHub 清单](https://github.com/everett7623/airport-recommendations-2026/blob/main/LICENSE)为 CC BY-NC-SA 4.0，未用于本商业产品数据。IPLogs VPN 名称表不包含官网字段，未推测或补造域名。

## 实际使用的源批次

表中「输入」为清单送入 SQLite 的记录数，含同商家跨来源重叠。快照链接、许可与每条输入的获取日期见 [开放候选 JSON](merchant-candidates-v03.json)。官网直查分三批，另有独立的 [官网元数据人工复核](merchant-reviewed-metadata-v03.json) 对开放候选补充简介并批准。

| 来源 | 许可 | 输入 |
| --- | --- | ---: |
| [Claws-ZH/awesome-ai-api](https://github.com/Claws-ZH/awesome-ai-api/blob/c424f4aadcae59767b7f99a74320e14423b52cae/data/gateways.json) | MIT | 177 |
| [Claws-ZH/awesome-ai-api 原始候选](https://github.com/Claws-ZH/awesome-ai-api/blob/c424f4aadcae59767b7f99a74320e14423b52cae/data/candidates.txt) | MIT | 159 |
| [apiranking/awesome-api-relay](https://github.com/apiranking/awesome-api-relay/blob/269183329fef9625efa9b91e663b96874d0d2641/README.md) | CC BY-SA 4.0 | 100 |
| [howardpen9/awesome-ai-api-proxy](https://github.com/howardpen9/awesome-ai-api-proxy/blob/acd5c440ac3d88f9e00c6cf3b25c40b92d52bc1d/data/providers.yaml) | CC0 1.0 | 30 |
| [kirito8/free-newapi](https://github.com/kirito8/free-newapi/blob/c2e46cd93803b525eda597f633f40ed1ab0856ab/README.md) | MIT | 16 |
| [VPN Ownership and Audit Register by VPNInfobase](https://vpninfobase.com/vpn-audit-register/) | CC BY 4.0 | 22 |
| [hiddify/awesome-freedom](https://github.com/hiddify/awesome-freedom/blob/248c60701bd2ca548189b155bf0ff9a3c781e1fd/vps-providers.md) | CC0 1.0 | 50 |
| [ishandutta2007/Awesome-Virtual-Private-Server-Vps-Hosting](https://github.com/ishandutta2007/Awesome-Virtual-Private-Server-Vps-Hosting/blob/92b67cc2b8a868fe66b2bbd54cbc5e725d7a75a3/README.md) | MIT | 10 |
| [zhengdon/awesome-cheap-vps](https://github.com/zhengdon/awesome-cheap-vps/blob/e2f2bd8b09c1c5c10f82b9b206934837e84d7e9e/README.md) | MIT | 4 |
| [edit2/LowEndStorage](https://github.com/edit2/LowEndStorage/blob/5e7f049b15979a27f25fcaaba149841a23f3173d/data.json) | WTFPL | 37 |
| [Ne00n/DealsLists](https://github.com/Ne00n/DealsLists/blob/4addf372cd08bce4d7ec8ea16efe7e7bd016bfe6/data/lowendtalk-available-posts.json) | MIT | 38 |
| 官网直查：[首批](merchant-reviewed-v03.json)、[补充](merchant-reviewed-followup-v03.json)、[机场](merchant-reviewed-airports-v03.json) | 自编事实摘要，附原始官网页面 | 59 |

同一来源同一主机的 9 次重复输入没有新建行。59 行因已有档案、队列域名或人工确认的别名进入重复状态。来路不明、同名但证据不足的条目需要手动复核。

apiranking 派生的名称与域名子集遵循 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。修改包括移除原排名及描述、标准化 URL 和添加出处字段；同方式共享适用于该来源的派生数据。其他来源依其各自许可。MIT 署名与原许可证副本位于 [merchant-licenses](merchant-licenses)。

## 数据库验收快照

- 输入 702 条，写入 693 行，归并后 634 个新增候选或发布档案，涉及 560 个可注册域。另有初始 25 个档案。子域、组织别名及迁移域名仍可能需要人工消歧。
- 新增 119 个已收录公开档案、515 条后台待审；目录合计 144 个公开档案，其中 24 个资料已核实，0 个实测。新增条目均保留「已收录」。未确定服务运营状态的档案不计为确认运营。
- 634 个候选都有出处和检查记录。公开官网返回可读 HTML 的是 195 个唯一候选主机、192 个可注册域；另有 5 个访问受限、32 个主页请求未完成、383 个因 robots.txt 不允许或不可判定而跳过、19 个结果待复核。已发布条目中有 101 个主页通过本轮可达性检查。
- 导入曾有 159 条因来源标签被误拼进 URL 失败。修正源链接后在原批次重试，当前失败项为 0。网页检查中主要原因包括 DNS 无结果、超时、robots.txt 返回网页或重定向、权限或限流、TLS 错误、迁移跳转和 HTTP 404。情况随网络和采集时间变化，不能据此标为停运。
- 119 个候选有编辑简介，13 个列有销售的 AI 产品，11 个有明确的交付方式，8 个有月付报价样本，4 个有月流量。已发布的新增档案中，7 个记录付款方式，6 个记录退款说明，3 个记录质保，7 个记录交付时间。需要登录、无法确定谁在运营或可能已经停止购买的条目不据此判定实际可购买。官网检查没有购买、调用 API 或连接节点。

| 分类 | 本轮待审 | 本轮发布 |
| --- | ---: | ---: |
| 官方 AI 平台 | 0 | 0 |
| AI 会员代充 | 0 | 6 |
| AI 卡网 / 发卡站 | 0 | 8 |
| API 中转站 | 252 | 47 |
| AI 聚合平台／模型托管 | 23 | 4 |
| 机场 / 节点订阅 | 0 | 8 |
| 商业 VPN | 18 | 5 |
| VPS / 云服务器 | 87 | 25 |
| 住宅代理 | 0 | 6 |
| 其他网络服务 | 0 | 0 |
| U 卡 | 0 | 6 |
| 虚拟信用卡 | 0 | 2 |
| 跨境支付 | 0 | 1 |
| 其他订阅支付服务 | 0 | 1 |
| 未分类线索 | 135 | 0 |
| **合计** | **515** | **119** |

目标 3,000–5,000 条未达到。最缺的是 AI 小店、机场、支付商家，以及可追溯的现行套餐、付款和退款规则。扩大规模需要带明确再利用许可的源或商家自主提交；优先核对现有待审队列中的官网、同主体历史域名和分类。
