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
- **relay bundle**:本地 `npm run build -w @cute/relay`(tsup → `dist/server.cjs`,shared 已 inline),deploy 时 rsync `dist/` + `package.json` 过去,远端 `npm ci --omit=dev` 只装 `ws` 一个生产依赖。

## 首次上机流程

```bash
./deploy.sh setup    # 装 nginx + 生 cert + 装 systemd unit(只跑一次)
./deploy.sh deploy   # build → rsync → restart → 验证(每次)
```

## 日志位置(远端)

```
sudo journalctl -u cute-relay -n 50 --no-pager     # relay 应用日志
sudo tail -f /var/log/nginx/cute.access.log         # 18789 接入日志
sudo tail -f /var/log/nginx/cute.error.log          # nginx 错误
```
