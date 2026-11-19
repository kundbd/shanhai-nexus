# Ubuntu VPS 部署

## 腾讯云生产站点

正式站点使用 VPS 上的 Nginx 和独立 systemd 服务。Cloudflare 以仅 DNS 模式解析主域名和 `www`，Nginx 负责 HTTPS 及 `www` 到主域名的 308 跳转。

- [systemd 服务](systemd/shanhai-nexus.service)运行于 `127.0.0.1:3180`，当前版本在 `/opt/shanhai-nexus/current`。
- 生产数据库在 `/var/lib/shanhai-nexus/directory.sqlite`，运行配置在 `/etc/shanhai-nexus/web.env`。
- 社区附件保存在数据库同级的 `community-media` 目录。备份或还原发帖数据时同时处理该目录。Nginx HTTPS 配置仅为 `/api/community/posts` 开放 25 MB 请求上限。
- FILEBOX 账号接入需要在 `web.env` 设置独立的 `MEMBER_SESSION_KEY`（32 字节随机值的十六进制编码）。账号服务的默认 HTTPS 地址是 `https://account-test.unziptool.cn`，可通过 `FILEBOX_ACCOUNT_ORIGIN` 指定已授权的实例。首次切换前备份 SQLite 数据库，启动后核对 `030-member-accounts.sql` 和外键完整性。
- DSH 审核通过 Web 服务的 `web.env` 配置 `DSH_MODERATION_ENABLED=1` 与 `DSH_MODERATION_API_KEY`（也可使用此文件内的 `DEEPSEEK_API_KEY`）。重启 Web 服务后访问后台「DSH 审核」，核对迁移 `032-content-moderation.sql` 与请求状态。零额度会把文字留给人工复核，关闭开关则停止新模型请求。已生效的账号处罚仍按到期时间执行。
- [Nginx HTTPS 配置](nginx/shanhai-nexus-https.conf)部署于 `/etc/nginx/sites-available/shanhai-nexus`。ACME 验证目录为 `/var/www/shanhai-nexus`，证书由 `certbot.timer` 续期。
- 使用 `systemctl status shanhai-nexus`、`journalctl -u shanhai-nexus` 和 `curl -fsS https://shanhainexus.com/api/health` 检查运行状态。

[报价和目录刷新服务](systemd/shanhai-nexus-refresh.service)独立于 Web 服务。它与 Web 使用同一个 SQLite 数据库，按上轮启动时间计算五小时间隔，中断后接着处理未完成的检查。升级至自动发现功能时，先备份 SQLite 并部署包含 `035-automatic-directory-refresh.sql` 的 Web 版本，再替换并重启刷新进程。首次升级会启动一轮新版任务。

从项目目录生成可用 Node.js 独立运行的刷新脚本，再把构建产物和 systemd 文件上传到服务器。

```sh
node -e 'require("esbuild").buildSync({entryPoints:["scripts/directory-refresh.ts"],bundle:true,platform:"node",format:"cjs",target:"node24",external:["sharp"],outfile:"output/directory-refresh.cjs"})'
```

```sh
sudo install -d -m 0755 /opt/shanhai-nexus/maintenance
sudo install -m 0644 directory-refresh.cjs /opt/shanhai-nexus/maintenance/directory-refresh.cjs
sudo install -m 0644 shanhai-nexus-refresh.service /etc/systemd/system/shanhai-nexus-refresh.service
sudo systemctl daemon-reload
sudo systemctl enable --now shanhai-nexus-refresh
sudo journalctl -u shanhai-nexus-refresh -n 20 --no-pager
```

DeepSeek Search 凭证放在 `/etc/shanhai-nexus/refresh.env` 的 `DEEPSEEK_API_KEY`，文件由 `root` 持有且权限为 `0600`。纯官网和汇率核查可在没有该凭证时继续。更新刷新脚本或配置后运行 `sudo systemctl restart shanhai-nexus-refresh`。已完成轮次和当前进度可在后台「批量商家采集」查看。

刷新任务也用同一 DeepSeek 密钥审核授权商家投稿。通过后，公开报价和店铺图标随档案一起保存。后台「投稿审核」显示自动处理结果。`sharp` 由独立运行目录中的 Node 模块提供，systemd 单元通过 `NODE_PATH` 加载。

后台登录入口为 `https://shanhainexus.com/admin/login`。初始账号为 `admin`。在保存了加密凭证的 Windows 用户下，从项目目录运行 `pwsh -NoProfile -File .\deploy\copy-admin-password.ps1` 可将密码复制到剪贴板。

## Docker 与 Caddy 部署方案

目标为 2 vCPU、4 GB 内存、40 GB SSD 的 Ubuntu。Next.js standalone Web 容器和定时刷新进程共享 SQLite 卷，使用宿主上的 HTTPS 反向代理。在具备部署授权后执行以下步骤。

## 1. 构建应用

在装有 Docker Engine 和 Compose 插件的 VPS 上，将项目放到独立目录。

```sh
cp .env.example .env
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
```

`SITE_URL` 默认使用 `https://shanhainexus.com`。变更域名后重新构建，以刷新静态 SEO 元数据。容器进程以非 root 用户运行，应用端口只绑定宿主回环地址。更改 `APP_PORT` 时，同步更新 Caddy 上游和本机检查命令。

`directory-data` 命名卷挂载在 `/app/data`。初始化时自动执行迁移与首批导入，重复启动保留编辑记录。健康端点验证数据库可读。公网部署时设置强随机的 `ADMIN_PASSWORD`、独立的 `ADMIN_SESSION_SECRET` 和 `ADMIN_USERNAME`，将 `ADMIN_ORIGIN` 设为 `https://shanhainexus.com`。管理员会话为 HttpOnly / SameSite=Strict，HTTPS 下启用 Secure。建议仅允许可信管理网段访问后台；若需要更长密码，用环境文件单引号保留其字面值并保护文件权限。

## 2. Cloudflare DNS

将站点加入 Cloudflare 并完成权威名称服务器委派。迁移已有 DNS 区域前核对邮件、验证及其他记录。

| 类型 | 名称 | 目标 | 初次验收 |
| --- | --- | --- | --- |
| A | `@` | VPS 公网 IPv4 | DNS only |
| CNAME | `www` | `shanhainexus.com` | DNS only |

仅在 VPS 的公网 IPv6、监听和防火墙均已验证时增加根域 AAAA。从外部网络核对两条域名的解析，并在 OVH 防火墙和 Ubuntu 上允许入站 TCP 80、443。保留现有 SSH 管理通道。

[Cloudflare DNS 记录管理](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/)

## 3. HTTPS 与 www 跳转

安装 Caddy，把 [Caddyfile](./Caddyfile) 中的两个站点块合并到现有 Caddy 配置。DNS 指向 VPS 且 80、443 可访问时，Caddy 可为两个域名申请并续签证书。主站是 `shanhainexus.com`，`www` 使用 308 跳转并保留路径和查询参数。

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -fsS https://shanhainexus.com/api/health
curl -fsSI 'https://www.shanhainexus.com/guides'
curl -fsS https://shanhainexus.com/sitemap.xml
```

若要启用 Cloudflare 代理，先验证源站证书覆盖两域名并且 HTTPS 可用，再将 SSL/TLS 模式设为 **Full (strict)** 并开启代理。保留 `/search` 和健康检查的 `Cache-Control: no-store` 语义。使用现有 CDN 安全或缓存规则时，也要对这两个路径保持该行为。

[Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https) · [Cloudflare Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)

## 4. 日志与检查

```sh
docker compose logs --tail=100 web
sudo journalctl -u caddy --since "15 minutes ago"
```

Compose 对应用标准输出和错误日志轮转。Caddy 示例保留服务运行日志，并且没有启用 HTTP 访问日志。若接入额外日志或分析服务，确保跳过 `/search` 或从请求目标中清除查询字符串，包括 CDN 和代理的日志。搜索 URL 仍可能出现在浏览器历史里。

现场验收应覆盖根域首页、www 跳转、健康接口、站点地图、搜索结果跳转和六个工具。更新项目后执行 `docker compose up -d --build`，并重查健康状态。

## 5. SQLite 备份与恢复

迁移或升级前在线备份，并将备份复制出卷，按业务需要加密存放。以下文件名使用新日期，避免覆盖。

```sh
docker compose exec web node scripts/backup-directory.mjs /app/data/backup-2026-11-15.sqlite
docker compose cp web:/app/data/backup-2026-11-15.sqlite ./backup-2026-11-15.sqlite
```

恢复时先保全当前卷与文件，再停掉应用。使用新卷或独立目录，将已校验的备份放为 `directory.sqlite`，所属 UID/GID 对应容器内的 `node` 用户（官方镜像通常为 1000）。从新卷启动并验收健康、档案数量和后台记录。请勿将旧的 WAL/SHM 文件复制到新卷或在应用运行时覆盖数据库。数据库回滚与应用镜像回滚一起验证。

## 6. 按需批量收录

浏览器后台使用「批量导入」管理审核。命令行文件导入、检查和报表通过独立镜像运行，应用容器仍使用 standalone 镜像。先用 `docker volume ls` 查到本项目的目录数据卷，将下例的 `ACTUAL_DIRECTORY_VOLUME` 改为实际卷名。

```sh
docker build --target directory-ops -t shanhai-directory-ops .
docker run --rm -v ACTUAL_DIRECTORY_VOLUME:/app/data -v "$PWD/content:/import:ro" shanhai-directory-ops import json /import/merchant-candidates-v03.json
docker run --rm -v ACTUAL_DIRECTORY_VOLUME:/app/data shanhai-directory-ops check all 5000
docker run --rm -v ACTUAL_DIRECTORY_VOLUME:/app/data shanhai-directory-ops report
```

编辑发布前保留快照，用同一数据卷重跑只会增加审计记录。新卷默认仅初始化原始 25 个公开档案，可参照根目录 README 复现本次批次，也可迁移现有 SQLite 的一致性备份。

## 7. 定时发现与复查

Compose 的 `refresh` 服务每五小时复查公开档案与一手报价，并通过已启用的授权来源和 DeepSeek 搜索发现新商家。将 `DEEPSEEK_API_KEY` 写入服务器 `.env` 后，每轮最多一次搜索请求，受 `DEEPSEEK_DISCOVERY_DAILY_LIMIT` 限制。使用 `docker compose logs --tail=100 refresh` 查进度。设置 `DIRECTORY_REFRESH_ENABLED=0` 后重新启动服务可暂停刷新。

在后台启用已审计且允许自动执行的来源，使用上一节的独立镜像。将以下命令交给 Ubuntu cron 或 systemd timer，每 15 分钟执行一次。将数据卷名和环境文件路径改成现场实际值。保护环境文件权限。

```sh
flock -n /var/lock/shanhai-discovery.lock docker run --rm --env-file /srv/shanhai/.env -e DB_PATH=/app/data/directory.sqlite -v ACTUAL_DIRECTORY_VOLUME:/app/data shanhai-directory-ops discovery-tick 2
```

可另外每天运行一次 `check-stale 60 30`，分批复查 30 天前的已导入官网。候选发布仍由编辑执行。
