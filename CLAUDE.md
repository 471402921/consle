# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo status

Monorepo with three workspaces — `shared/` (envelope + proto types), `console/` (React + Vite frontend), `relay/` (Node + `ws` server). `npm install` at the root resolves all three; `npm run dev:console` / `npm run dev:relay` start dev servers. `npm run typecheck` runs across all three.

[requirements.md](requirements.md) is the source of truth for product scope, protocol contract, MVP boundaries, non-goals, and the seven open questions. Read it before proposing anything. Don't duplicate its content into other docs; link to specific sections instead.

Deploy topology lives in [deploy/README.md](deploy/README.md). The handoff doc to the cute_pixel team is [handoff/cute_pixel.md](handoff/cute_pixel.md).

## What this project is

Two services live in this repo as workspaces:

- **`console`** — desktop browser web app (React + Vite). User types in a `room_id`, connects via WSS, sees character state, takes over the cute_pixel character with WASD / arrow keys / on-screen joystick, toggles autonomous ↔ external control.
- **`relay`** — small WSS server (Node + `ws`, bundled via `tsup`). Routes by `room_id` + `role`, broadcasts to the opposite role only. **Does not parse message bodies.** Auth = room_id-as-token (≥ 32 chars). MVP target: <100 concurrent rooms, single node.

The cute_pixel app is the **other client**, not a server. Both app and console are clients to relay — this is what makes cross-NAT (phone 4G + laptop WiFi) work. See [requirements.md §3](requirements.md) for the diagram.

## Two protocol layers — keep them separate

This is the most common confusion point and worth fixing early:

| Layer | Lives in | Defines |
|---|---|---|
| `proto/messages.ts` + `proto/messages.gd` (in **cute_pixel** repo) | RN ↔ Godot contract | `CHARACTER_SET_EXTERNAL_CONTROL`, `CHARACTER_SET_VELOCITY`, `CHARACTER_STATE`, etc. |
| Envelope (in **this** repo / relay) | console ↔ relay ↔ app network layer | `{room_id, from, ts, msg}` wrapper; relay never opens `msg` |

The envelope **does not belong in cute_pixel's `proto/`**. The character-level messages **do** belong there and need to be added on the cute_pixel side — see [§5](requirements.md) and the blocker list in [§9](requirements.md) (items 2–7 must land in cute_pixel before E2E works).

## Deploy script — non-obvious things

[deploy.sh](deploy.sh) deploys console + relay to a Tencent Cloud Lighthouse instance at `1.14.190.95`, sharing the box with a `asset-lab-https.service` that **this repo does not manage** (but coordinates with — see [handoff/asset-lab.md](handoff/asset-lab.md)). Live URLs:

```
https://console.ewow.cn/        → cute console SPA   (Tencent DV cert, 90-day, expires 2026-08-14)
wss://console.ewow.cn/relay     → cute-relay (ws upgrade through nginx)
https://1.14.190.95/            → asset-lab (nginx fallback vhost, reverse-proxied to localhost:8001)
https://1.14.190.95:18789/      → cute console old self-signed vhost (1-week fallback; remove after stable)
```

Details that are easy to get wrong:

- **SSH key must be `~/.ssh/jet.pem`** (RSA 2048). `~/.ssh/id_rsa` is NOT installed on the box. Override per-developer with `export CUTE_SSH_KEY=~/.ssh/your.pem`.
- **User is `ubuntu`.** `root`, `lighthouse`, `centos`, `jet.d` have all been tried and rejected.
- **Lighthouse firewall (not classic security group)** controls inbound. Currently open: 22 / 80 / 443 / 22940 / 18789. Tencent edge silently drops data on closed ports (`nc -zv` times out, doesn't refuse). To open another port, Lighthouse 控制台 → 实例 → 防火墙.
- **Topology** is documented in [deploy/README.md](deploy/README.md): nginx on `:443` with host-based routing (`console.ewow.cn` → cute, default → asset-lab fallback), plus `:18789` legacy vhost. Never hand-edit `/etc/nginx/...` or `/etc/systemd/...` on the box — change [deploy/nginx-cute.conf](deploy/nginx-cute.conf) / [deploy/cute-relay.service](deploy/cute-relay.service) and rerun `setup` (or rsync manually for vhost-only changes).
- **Two-phase script**: `./deploy.sh setup` (once, idempotent) installs nginx + generates self-signed cert for `:18789` + writes vhost + installs systemd unit + installs Node 20. `./deploy.sh deploy` (every change) builds locally → rsyncs `console/dist/` and `relay/dist/` → `npm install --omit=dev` on the box → restart cute-relay → reload nginx → curl `/` and `/health`. **Setup does NOT manage the `console.ewow.cn` cert** — that's manual through Tencent Cloud SSL console (free DV, 90-day, renewal procedure in [deploy/README.md](deploy/README.md#cert-续期consoleewowcn)).
- **8 known deployment gotchas** documented in [deploy/README.md](deploy/README.md#已知部署陷阱2026-05-17-踩过的坑): `npm ci` vs `install` in monorepo, devDep resolution of `@cute/shared`, `ProtectHome` vs `WorkingDirectory`, `chmod o+x ~` for nginx traversal, **Tencent webblock blocks LE HTTP-01** (so we use Tencent's own DV cert), `asset-lab` Python single-threaded hang, nginx 1.24 vs `http2 on;`, Ubuntu nginx default vhost stealing `:80`. Re-read that before changing `deploy.sh`, `cute-relay.service`, or `nginx-cute.conf`.
- **Relay packaging**: relay is bundled with `tsup` into a single `dist/server.cjs` with `@cute/shared` inlined; only `ws` is left external. Remote box runs `npm install --omit=dev` against a generated prod-only `package.json`, gets one prod dep. Don't try to ship `@cute/shared` separately — it isn't published.
- **TLS certs (two of them)**:
  - `console.ewow.cn`: Tencent free DV at `~/cute/cert/console.ewow.cn_bundle.crt` + `.key`, 90-day, manual renewal.
  - `:18789` self-signed fallback at `~/cute/cert.pem` + `key.pem`, 10-year, generated by `setup`.
  - Both are NOT in git.
- **asset-lab listens on `127.0.0.1:8001`** (not 443) — coordinated handover documented in [handoff/asset-lab.md](handoff/asset-lab.md). If you ever see `asset-lab-https.service` bound to `:443` again, the asset-lab repo regressed the `PORT = ...` line in `_https_server.py` — that breaks our nginx, ping them to re-sync.
- Logs: `./deploy.sh run 'sudo journalctl -u cute-relay -n 50 --no-pager'`, `./deploy.sh run 'sudo tail -30 /var/log/nginx/cute.error.log'`, `./deploy.sh run 'sudo tail -30 /var/log/nginx/cute.access.log'`.

Commands: `./deploy.sh {ssh|run "<cmd>"|ping|setup|deploy}`.

## MVP guardrails

When in doubt about scope, default to NO — the spec is deliberately narrow ([§4](requirements.md), [§2 non-goals](requirements.md)):

- One app + one console per room. No multi-console conflict resolution.
- One scene (`interior_scene`). No scene switching, no furniture editing.
- Desktop browser only. No mobile console.
- No accounts, no replay, no A/B, no FPS/memory dump UI.
- Reconnect = exponential backoff, 5 attempts, then stop.
- `CHARACTER_STATE` upstream is **throttled to 5 Hz** (every 12 frames at 60 Hz `_physics_process`). Don't propose anything that streams at 60 Hz over WS.

If a request would add something from the "non-MVP" list, surface it before implementing.

## Cross-repo coordination

Anything that touches the wire format (`proto/messages.*` or envelope schema) is a **two-repo change**: this repo (console + relay) + cute_pixel. Land the proto change in cute_pixel first, or both repos break at the seam. The cute_pixel side has stubs ready ([requirements.md §1](requirements.md)) but they need real implementation — see the seven-item blocker list in [§9](requirements.md) for what cute_pixel owes before E2E testing is possible.

The concrete work cute_pixel owes is enumerated in [handoff/cute_pixel.md](handoff/cute_pixel.md) — that doc is meant to be sent verbatim to whoever is implementing on the cute_pixel side. Keep it in sync with the actual `shared/src/envelope.ts` and `shared/src/proto.ts`; if you change a `type` string or envelope field name here, update the handoff doc in the same change. `handoff/` is the dedicated directory for external-facing handoff docs — add new ones there (e.g. `handoff/relay-ops.md`) as needed.
