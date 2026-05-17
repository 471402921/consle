# deploy/

部署配置模板,被 [../deploy.sh](../deploy.sh) 推送到远端。**不要手编远端 `/etc/nginx/...` 或 `/etc/systemd/...`** — 在这里改,跑 `./deploy.sh setup` 覆盖远端。

## 文件

| 文件 | 远端落点 | 改动后做什么 |
|---|---|---|
| `nginx-cute.conf` | `/etc/nginx/sites-available/cute.conf` | `./deploy.sh setup` 重新推 + `nginx -s reload` |
| `cute-relay.service` | `/etc/systemd/system/cute-relay.service` | `./deploy.sh setup` 重新推 + `systemctl daemon-reload + restart` |

## 远端拓扑(简要)

```
0.0.0.0:443     → asset-lab-https.service   (不动)
0.0.0.0:18789   → nginx (cute.conf)
  ├─ /          → /home/ubuntu/cute/console-dist  (SPA)
  ├─ /relay/*   → 127.0.0.1:8080  (cute-relay.service, ws upgrade)
  └─ /health    → 127.0.0.1:8080/health
127.0.0.1:8080  → cute-relay.service        (本机,不对外)
```

- **cert**:`~/cute/{cert,key}.pem`,self-signed,setup 时一次性生成(10 年有效)。不在 git。
- **console build**:本地 `npm run build -w @cute/console` 出 `console/dist/`,deploy 时 rsync 到 `~/cute/console-dist/`。
- **relay bundle**:本地 `npm run build -w @cute/relay`(tsup → `dist/server.cjs`,shared 已 inline),deploy 时 rsync `dist/` + deploy 脚本临时生成的 prod-only `package.json`(只含 `ws`)过去,远端 `npm install --omit=dev` 只装 `ws` 一个依赖。**不传源 package.json**(它带 devDep `@cute/shared`,registry 找不到会报 E404,详见下方"已知陷阱 #2")。

## 首次上机流程

```bash
./deploy.sh setup    # 装 nginx + 生 cert + 装 systemd unit + 装 node 20(只跑一次,幂等)
./deploy.sh deploy   # build → rsync → restart → 验证(每次)
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
