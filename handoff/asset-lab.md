# asset-lab 端口让位请求(2026-05-17)

> Status: 已发出。本文档由 cute pixel console 项目这边发给 asset-lab 同学,请求把 `_https_server.py` 的 `PORT = 443` 改成 `PORT = 8001`,让位给 nginx。

## 背景

cute pixel console (`console.ewow.cn`)要部署到同一台 box `1.14.190.95`,nginx 要接管 443 端口对外做 SSL termination + host-based 分流。asset-lab 的 `_https_server.py` 现在直接 `listen 0.0.0.0:443`,跟 nginx 撞,必须让位。

## 请 asset-lab 做

asset-lab repo 里 `_https_server.py` 改一行:

```diff
-PORT = 443
+PORT = 8001
```

commit + push。

## 不动会怎样

cute pixel 这边马上要 `sed` 在 box 上改这一行 + 重启 asset-lab + 装 nginx + 配 vhost。改完后 asset-lab 通过 `localhost:8001` + nginx 反代继续可用,外部访问 URL 不变。

**但是**如果 asset-lab repo 不同步这行改动,下次 redeploy 会把 box 上的改回 `PORT = 443`,跟 nginx 撞 443 → asset-lab 起不来 + cute console 也连带挂。所以 repo 必须 sync。

## 让位后的拓扑

```
0.0.0.0:443  → nginx (SSL termination)
              ├─ Host: console.ewow.cn   → /home/ubuntu/cute/console-dist (新, cute console SPA)
              │                          + /relay/* → cute-relay (ws upgrade)
              └─ Host: 其他 / IP 直访     → proxy_pass https://127.0.0.1:8001
                                            (asset-lab,继续工作,自签 cert 在 8001 上)
127.0.0.1:8001 → asset-lab-https.service (改后)
```

asset-lab 外部访问体验:
- `https://1.14.190.95/`(IP 访问)→ 通过 nginx fallback vhost 反代,LE cert(浏览器不再有自签 warning,但 cert CN 不是 IP 也会有 warn — 跟以前差不多)
- `https://ewow.cn/`(主域,如果它继续指 1.14.190.95)→ 同上

## 时间线

| | 谁 | 何时 |
|---|---|---|
| `sed` box 上改 PORT + 重启 + 装 nginx + 签 cert | cute pixel 这边 | 收到通知后立刻 |
| asset-lab repo 同步那一行改动 | asset-lab 同学 | 越早越好,最迟下次 redeploy 前 |

## 出问题怎么办

- cute pixel 项目 repo:https://github.com/471402921/consle
- 想换方案 / 有冲突 → 在这里讨论

## 相关 plan / 上下文(给好奇的人)

- 为什么要换域名:iOS NSAllowsArbitraryLoads + 自签证书 + WebSocket 三件套联调阻塞,需要正经域名 + Let's Encrypt cert
- console + relay 跟 asset-lab 共用同一台 box(`1.14.190.95`,Lighthouse,只 22/443/22940/18789 + 80 开放),所以共用 443 是必须
