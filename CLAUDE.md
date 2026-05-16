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

[deploy.sh](deploy.sh) deploys console + relay to a Tencent Cloud CVM at `1.14.190.95`, sharing the box with a legacy `asset-lab-https.service` on `:443` that **this repo does not manage**. Details that are easy to get wrong:

- **SSH key must be `~/.ssh/jet.pem`** (RSA 2048). `~/.ssh/id_rsa` is NOT installed on the box. Override per-developer with `export CUTE_SSH_KEY=~/.ssh/your.pem`.
- **User is `ubuntu`.** `root`, `lighthouse`, `centos`, `jet.d` have all been tried and rejected.
- **Only ports 22 / 443 / 22940 / 18789 are open.** Other ports appear reachable but Tencent edge silently drops data. `443` is `asset-lab-https`, `22940` is taken by another service — **only `18789` is available for cute** (so console + relay must share it via nginx path-routing). To open another port, edit security group rules in the Tencent console.
- **Topology on `:18789`**: nginx serves `/` → `~/cute/console-dist/` (vite SPA), `/relay/*` → `127.0.0.1:8080` (cute-relay.service, ws upgrade with `/relay` prefix stripped), `/health` → relay health. nginx vhost and systemd unit live at [deploy/nginx-cute.conf](deploy/nginx-cute.conf) and [deploy/cute-relay.service](deploy/cute-relay.service); never hand-edit `/etc/nginx/...` on the box — change the template and rerun `setup`.
- **Two-phase script**: `./deploy.sh setup` (once) installs nginx + generates self-signed cert + writes vhost + installs systemd unit + installs Node 20 if missing. `./deploy.sh deploy` (every change) builds locally → rsyncs `console/dist/` and `relay/dist/` → `npm ci --omit=dev` on the box → restart cute-relay → reload nginx → curl `/` and `/health`. Setup is idempotent (cert is not overwritten if present).
- **Relay packaging**: relay is bundled with `tsup` into a single `dist/server.cjs` with `@cute/shared` inlined; only `ws` is left external. Remote box runs `npm ci --omit=dev` and gets one prod dep. Don't try to ship `@cute/shared` separately — it isn't published.
- **TLS**: self-signed cert at `~/cute/{cert,key}.pem` (10-year, generated once at setup, not in git, not overwritten). Browsers will show a "not secure" warning; click through for MVP. For external demos, a proper domain + Let's Encrypt is the next step.
- Logs: `./deploy.sh run 'sudo journalctl -u cute-relay -n 50 --no-pager'` and `./deploy.sh run 'sudo tail -30 /var/log/nginx/cute.error.log'`.

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
