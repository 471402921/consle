# deploy/

部署配置模板,被 [../deploy.sh](../deploy.sh) 推送到远端。**不要手编远端 `/etc/nginx/...` 或 `/etc/systemd/...`** — 在这里改,跑 `./deploy.sh setup` 覆盖远端。

## 文件

| 文件 | 远端落点 | 改动后做什么 |
|---|---|---|
| `nginx-cute.conf` | `/etc/nginx/sites-available/cute.conf` | `./deploy.sh setup` 重新推 + `nginx -s reload` |
| `cute-relay.service` | `/etc/systemd/system/cute-relay.service` | `./deploy.sh setup` 重新推 + `systemctl daemon-reload + restart` |

## 远端拓扑(2026-05-17 域名 + 正经 TLS;同日改 :18789 绕腾讯 anti-scan)

```
0.0.0.0:80      → nginx (cute.conf)
                  ├─ /.well-known/acme-challenge/ → /var/www/letsencrypt (LE 续期留位,未启用)
                  └─ /*                            → 301 https://$host$request_uri

0.0.0.0:443     → nginx (cute.conf, SSL termination,腾讯 DV cert)
                  按 server_name 分:
                  ├─ console.ewow.cn  → cute console + relay
                  │                    ⚠ 实际不通:腾讯边缘 anti-scan 拦截
                  │                      未备案子域的 SNI 高频 TLS 握手(详见陷阱 #9)
                  └─ default_server   → proxy_pass https://127.0.0.1:8001 (asset-lab fallback)

0.0.0.0:18789   → nginx (cute.conf,腾讯 DV cert,server_name _)  ← **主流量**
                  非标端口,腾讯 anti-scan 不监控,10/10 连击 0 失败
                  ├─ /          → /home/ubuntu/cute/console-dist (cute console SPA)
                  ├─ /relay/*   → 127.0.0.1:8080 (cute-relay.service, ws upgrade)
                  └─ /health    → 127.0.0.1:8080/health

0.0.0.0:8001    → asset-lab-https.service (Python SimpleHTTPServer + self-signed)
127.0.0.1:8080  → cute-relay.service (本机,不对外)
```

URL:
- **主站 console:    `https://console.ewow.cn:18789/`**(注意非标端口)
- **relay WSS:       `wss://console.ewow.cn:18789/relay`**
- asset-lab:        `https://1.14.190.95/`(IP 直访走 fallback vhost)
- console :443 入口暂时挂(腾讯 anti-scan),将来 ICP 备案后恢复

- **cert(console.ewow.cn,两个 vhost 共用)**:腾讯云免费 DV(TrustAsia 签),`~/cute/cert/console.ewow.cn_bundle.crt` + `console.ewow.cn.key`。到期 **2026-08-14**(90 天),续期方法见下文。
- ~~self-signed cert ~/cute/{cert,key}.pem~~ — setup 时生过但**已不使用**(:18789 切到 DV cert 后),可以删但留着也无害。
- **console build**:本地 `npm run build -w @cute/console` 出 `console/dist/`,deploy 时 rsync 到 `~/cute/console-dist/`。
- **relay bundle**:本地 `npm run build -w @cute/relay`(tsup → `dist/server.cjs`,shared 已 inline),deploy 时 rsync `dist/` + deploy 脚本临时生成的 prod-only `package.json`(只含 `ws`)过去,远端 `npm install --omit=dev` 只装 `ws` 一个依赖。**不传源 package.json**(详见下方"已知陷阱 #2")。

## 首次上机流程

```bash
./deploy.sh setup    # 装 nginx + 生 self-signed cert + 装 systemd unit + 装 node 20(只跑一次,幂等)
./deploy.sh deploy   # build → rsync → restart → 验证(每次)
```

**注**:setup 不管 `console.ewow.cn` 的 cert(那是腾讯云手动申请的,不入 setup 自动化)。重建机器后需要:
1. 跑 `setup`(装 nginx / systemd / self-signed cert for 18789)
2. 手动:在腾讯云控制台重新申请 console.ewow.cn DV cert + 下载 nginx 包 + rsync 到 `~/cute/cert/`
3. 跑 `deploy`

## cert 续期(console.ewow.cn)

腾讯云免费 DV 是 90 天有效,**到期前手动续**(无自动续期):

```bash
# 1. 到期前 1 周,腾讯云控制台 → SSL 证书 → 我的证书 → 找到 console.ewow.cn
#    → 续费 / 重新申请(免费版每年 50 张额度,直接再申请就行)
# 2. DNS 自动验证,等 5-10 分钟签发
# 3. 下载 Nginx 格式,解压
# 4. rsync 推到 box:
rsync -az -e "ssh -i ~/.ssh/jet.pem -o IdentitiesOnly=yes" \
  ~/Downloads/console.ewow.cn_nginx/console.ewow.cn_bundle.crt \
  ~/Downloads/console.ewow.cn_nginx/console.ewow.cn.key \
  ubuntu@1.14.190.95:/tmp/
./deploy.sh run '
  sudo mv /tmp/console.ewow.cn_bundle.crt ~/cute/cert/
  sudo mv /tmp/console.ewow.cn.key       ~/cute/cert/
  sudo chmod 644 ~/cute/cert/console.ewow.cn_bundle.crt
  sudo chmod 600 ~/cute/cert/console.ewow.cn.key
  sudo nginx -t && sudo systemctl reload nginx
'

# 5. 验证 cert 新有效期
echo | openssl s_client -connect console.ewow.cn:443 -servername console.ewow.cn 2>/dev/null \
  | openssl x509 -noout -dates
```

## 日志位置(远端)

```
sudo journalctl -u cute-relay -n 50 --no-pager     # relay 应用日志
sudo tail -f /var/log/nginx/cute.access.log         # 18789 接入日志
sudo tail -f /var/log/nginx/cute.error.log          # nginx 错误
```

## 观察 / 监控

无外部监控,靠 `/health` endpoint:

```bash
# 单次:rooms 数 + ok 标志
curl -ksS https://1.14.190.95:18789/health

# 持续:每 5s 刷一次,看 rooms 是否变化
watch -n 5 'curl -ksS https://1.14.190.95:18789/health'

# 看 relay 实时日志(connect / close / room 计数)
./deploy.sh run 'sudo journalctl -u cute-relay -f --no-pager'

# 看 nginx 入站(谁在访问)
./deploy.sh run 'sudo tail -f /var/log/nginx/cute.access.log'
```

`rooms > 0` = 有 app 或 console 进 room 了。
联调期间盯 `journalctl` 比 health 更直观,能看到 `connect room=cute-mvp-... role=app` 之类的行。

## 已知部署陷阱(2026-05-17 踩过的坑)

按踩到的顺序记录,避免重蹈。前 3 个已在 [../deploy.sh](../deploy.sh) / [cute-relay.service](cute-relay.service) 修掉,第 4 个 setup 已自动做。

1. **`npm ci` 在 monorepo 子目录里挂** — `relay/` 下没有独立 `package-lock.json`,顶层 lock 也不能直接复用(它含所有 workspace 的 dep tree)。
   - 解法:改用 `npm install --omit=dev`。重现性损失可接受,因为远端只装 `ws` 一个 prod 依赖。

2. **`--omit=dev` 仍要 resolve devDep 版本** — 即使 `--omit=dev` 不安装 devDep,npm 仍会去 registry 解析它们的版本(为了 audit / lock)。`@cute/shared` 是 monorepo 内非公开包,registry 找不到 → `E404 Not Found - GET .../@cute%2fshared`。
   - 解法:deploy 时 inline 生成一份 prod-only `package.json`(只含 `ws` + `start` script)推到远端,**不传源 package.json**。见 [../deploy.sh](../deploy.sh) `cmd_deploy` 的 Step 3.5。

3. **systemd `ProtectHome=true` 跟 `WorkingDirectory=/home/ubuntu/...` 冲突** — 启动报 `200/CHDIR Permission denied`,然后被 `Restart=on-failure` 拉进重启循环(计数器一晚上能到 10000+)。
   - 解法:删 `ProtectHome` 行;其他 hardening(`ProtectSystem=strict` / `NoNewPrivileges` / `PrivateTmp` / `ReadWritePaths`)留着仍有效。卡死时先 `sudo systemctl stop cute-relay && sudo systemctl reset-failed cute-relay` 再修。

4. **nginx 静态文件 500,`/home/ubuntu` 权限 750** — nginx user `www-data` 不在 `ubuntu` group,traverse 不进 home,所有静态请求 500。nginx error log 关键字 `stat() "/home/ubuntu/cute/console-dist/index.html" failed (13: Permission denied)`。
   - 解法:`chmod o+x ~`(只开 traverse,不开 read,home 仍不可 `ls`)。setup 已自动跑这一步。

5. **LE HTTP-01 challenge 被腾讯 webblock 拦** — 未 ICP 备案的 IP+域名 走 HTTP 时,Tencent 边缘会把请求重定向到 `https://dnspod.qcloud.com/static/webblock.html?d=<domain>`。LE 现在做 multi-perspective validation,其中一个节点走 Tencent 内网(`43.159.x.x`),触发自家拦截,签证书失败:`Invalid response from .../webblock.html`。
   - 真实用户走外网 ISP 访问域名**不被拦**(我们 mac 实测 200 OK),所以**只是签证书这一步挂**。
   - 解法:用**腾讯云免费 DV 证书**(SSL 控制台 → 申请免费证书,TrustAsia 签,90 天有效)代替 LE。腾讯自家签证书的验证不走 webblock。续期手动来,见上文"cert 续期"。

6. **asset-lab hung 6 天没人发现** — systemd 标 `active`,但 python3 单线程 SimpleHTTPServer 被某个慢请求卡死,本机 `curl localhost:443` 都 timeout。重启即修(`sudo systemctl restart asset-lab-https`)。
   - 教训:Python SimpleHTTPServer 不适合长期 prod,但 asset-lab 已经决定不动。建议 asset-lab 那边加外部 health check(我们这边只 review console + relay)。

7. **nginx 1.24 不支持 `http2 on;` 指令** — 那是 nginx 1.25+ 的新写法。Ubuntu 24.04 仓库里是 1.24.0,要用老式 `listen 443 ssl http2;`(http2 作为 listen 参数,不是独立指令)。配错 `nginx -t` 报 `unknown directive "http2"`。

8. **Ubuntu nginx 默认 vhost 占 :80 default_server** — `apt install nginx` 默认 enable `/etc/nginx/sites-enabled/default`,它 listen 80 default_server。我们的 cute vhost 也想 listen 80 default_server → nginx -t 冲突或 cute vhost 被 default vhost 覆盖。
   - 解法:`sudo rm -f /etc/nginx/sites-enabled/default` 让 cute vhost 接管。

9. **腾讯边缘 anti-scan 拦未备案子域 :443 高频 TLS** — `console.ewow.cn:443` SSL handshake 在 ServerHello 之前被边缘 RST(client 看到 `SSL_ERROR_SYSCALL / read 0 bytes / unexpected eof`)。单次孤立访问可能通,**连击 / iOS 5 次重连(31s 内)必触发**,封禁持续数分钟。box 内 nginx 完全 healthy(systemd active,error log 干净),诊断要从 client 侧 + 网络层入手。
   - 触发条件:**SNI = 未备案子域** + **标准 :443 端口** + **短时间多次 TLS 握手**。三个都满足才触发。
   - 解法(临时):换非标端口 — `:18789` 走同一 cert(`~/cute/cert/console.ewow.cn_bundle.crt`),腾讯 anti-scan 不监控非标,实测 10/10 连击 0 失败。`server_name _` 不告诉边缘 SNI 匹配。
   - 解法(根治):ICP 备案 1.14.190.95(2-3 周审核)。备案后 :443 可恢复用。
   - 排查命令:`curl -kv https://console.ewow.cn/ 2>&1 | head -20` 看 TLS 握手停在哪步;`echo | openssl s_client -connect console.ewow.cn:443 -servername console.ewow.cn` 看是否 read 0 bytes。
