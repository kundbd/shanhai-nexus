## 适用条件

适用于无法访问某域名、解析结果与预期不符，或 DNS 变更后的检查。

## 操作步骤

### 1. 查询返回码

Windows 可用 Resolve-DnsName，macOS 和 Linux 可用 dig 查询实际域名。记录 NXDOMAIN、SERVFAIL 或返回的地址。

```text
dig example.com A
Resolve-DnsName example.com -Type A
```

### 2. 对比权威和递归返回

若多个解析器返回 NXDOMAIN，核对域名和权威记录；若出现 SERVFAIL，检查委派与 DNSSEC。刚修改记录且不同解析器结果不同时，核对旧记录 TTL。

### 3. 确认问题是否仍在 DNS

若 A 或 AAAA 已指向预期地址，再检查访问端口、证书和目标服务响应。记录具体返回码与查询时间用于复核。

## 常见问题

### 本地清理缓存后还指向旧地址怎么办？

查询权威服务器和递归解析器。递归端仍有旧缓存时，本地清理无法使它立即过期。
