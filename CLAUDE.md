# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo status

This repo is **pre-implementation**: it contains only the product spec ([requirements.md](requirements.md)) and a deploy script ([deploy.sh](deploy.sh)) carried over from a sibling project. There is no source code, no `package.json`, no test runner, and it is not (yet) a git repo. When asked to "build the console" or "start the relay," the right first step is choosing a stack and scaffolding — not searching for files that don't exist.

[requirements.md](requirements.md) is the source of truth for product scope, protocol contract, MVP boundaries, non-goals, and the seven open questions. Read it before proposing anything. Don't duplicate its content into other docs; link to specific sections instead.

## What this project will become

Two deliverables live in this repo (or it will split into `console/` + `relay/` later):

- **`console`** — desktop browser web app. User types in a `room_id`, connects via WSS, sees character state, takes over the cute_pixel character with WASD / arrow keys / on-screen joystick, toggles autonomous ↔ external control.
- **`relay`** — small WSS server. Routes by `room_id` + `role`, broadcasts to the opposite role only. **Does not parse message bodies.** Auth = room_id-as-token (≥ 32 chars). MVP target: <100 concurrent rooms, single node.

The cute_pixel app is the **other client**, not a server. Both app and console are clients to relay — this is what makes cross-NAT (phone 4G + laptop WiFi) work. See [requirements.md §3](requirements.md) for the diagram.

Tech stack is intentionally undecided ([§6](requirements.md), [§7](requirements.md): "任意"). Don't assume React/Node/etc. unless the user picks one — ask.

## Two protocol layers — keep them separate

This is the most common confusion point and worth fixing early:

| Layer | Lives in | Defines |
|---|---|---|
| `proto/messages.ts` + `proto/messages.gd` (in **cute_pixel** repo) | RN ↔ Godot contract | `CHARACTER_SET_EXTERNAL_CONTROL`, `CHARACTER_SET_VELOCITY`, `CHARACTER_STATE`, etc. |
| Envelope (in **this** repo / relay) | console ↔ relay ↔ app network layer | `{room_id, from, ts, msg}` wrapper; relay never opens `msg` |

The envelope **does not belong in cute_pixel's `proto/`**. The character-level messages **do** belong there and need to be added on the cute_pixel side — see [§5](requirements.md) and the blocker list in [§9](requirements.md) (items 2–7 must land in cute_pixel before E2E works).

## Deploy script — non-obvious things

[deploy.sh](deploy.sh) targets a Tencent Cloud CVM. Several details are easy to get wrong:

- **SSH key must be `~/.ssh/jet.pem`** (RSA 2048). `~/.ssh/id_rsa` is NOT installed on the box. Override per-developer with `export ASSET_LAB_SSH_KEY=~/.ssh/your.pem`.
- **User is `ubuntu`.** `root`, `lighthouse`, `centos`, `jet.d` have all been tried and rejected.
- **Only ports 22 / 443 / 22940 / 18789 are open.** Other ports (8000, 8443, …) appear reachable (`nc -zv` says "succeeded") but data is dropped by the Tencent edge filter. To open another port, edit security group rules in the Tencent console.
- **Naming carryover:** systemd unit is `asset-lab-https.service`, remote dir is `~/asset_lab/`, deployed URL is `https://1.14.190.95/`. These names are from the previous tenant of this CVM — do **not** rename them as part of unrelated work; that's a separate operational change. The deploy script's `rsync --delete` syncs the whole project dir into `~/asset_lab/`, so the console/relay code will live there regardless of name.
- **TLS:** self-signed cert at `~/asset_lab/{cert,key}.pem`, generated once, not in git, not overwritten by `deploy`. Browsers require HTTPS-page → WSS, so the relay also needs TLS — plan the cert story before going public.
- Logs: `./deploy.sh run 'sudo journalctl -u asset-lab-https -n 50 --no-pager'`

Commands: `./deploy.sh {ssh|run "<cmd>"|ping|deploy}`. `deploy` rsyncs → restarts systemd → curls `/` and expects 200.

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
