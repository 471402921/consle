#!/usr/bin/env bash
# cute console + relay deploy / remote-access script
#
# -----------------------------------------------------------------------------
# Server (verified 2026-05-16)
# -----------------------------------------------------------------------------
#   Host         : 1.14.190.95         (Tencent Cloud CVM, Ubuntu 6.8)
#   User         : ubuntu              (NOT root, NOT lighthouse)
#   Hostname     : VM-0-4-ubuntu
#   SSH key      : ~/.ssh/jet.pem      (RSA 2048,
#                                       SHA256:5oKpQOCCDiaFL73tHoExI4wMXHCqsB839S8ZwTWToU0)
#                  Override per-developer with:  export CUTE_SSH_KEY=~/.ssh/your.pem
#   Server-side
#   public key   : labelled `skey-kgkoxj5l` in Tencent Cloud console
#
# Users tried and rejected: root, lighthouse, centos, jet.d.
#
# -----------------------------------------------------------------------------
# Port topology (与 asset-lab 共存)
# -----------------------------------------------------------------------------
# Tencent security group ONLY opens 22 / 443 / 22940 / 18789. Other ports
# (8000, 8443, ...) are TCP-spoofed by the cloud edge: `nc -zv` says
# "succeeded" but actual data is dropped. To open more: 控制台 → 安全组 → 入站规则.
#
#   443    → asset-lab-https.service        (legacy, unrelated to this repo)
#   22940  → 其他业务占用
#   18789  → nginx (cute.conf)              <- 本 repo 部署目标
#            ├─ /         → ~/cute/console-dist  (静态 SPA)
#            ├─ /relay/*  → 127.0.0.1:8080       (cute-relay.service, ws)
#            └─ /health   → 127.0.0.1:8080/health
#
# -----------------------------------------------------------------------------
# 远端布局
# -----------------------------------------------------------------------------
#   ~/cute/                                  ← 本 repo 的部署根
#   ├── cert.pem, key.pem                    ← self-signed (10 年),setup 时生
#   ├── console-dist/                        ← vite build 输出 (rsync 推)
#   └── relay/
#       ├── dist/server.cjs                  ← tsup build (shared inline)
#       ├── package.json + package-lock.json
#       └── node_modules/ws/                 ← npm ci --omit=dev 装的唯一 prod 依赖
#
#   /etc/nginx/sites-available/cute.conf     ← 来自 deploy/nginx-cute.conf
#   /etc/systemd/system/cute-relay.service   ← 来自 deploy/cute-relay.service
#
# asset-lab 由它自己的工具链管,本脚本不再覆盖 ~/asset_lab/。
# -----------------------------------------------------------------------------

set -euo pipefail

REMOTE_HOST="1.14.190.95"
REMOTE_USER="ubuntu"
REMOTE_URL="https://1.14.190.95:18789"
SSH_KEY="${CUTE_SSH_KEY:-${HOME}/.ssh/jet.pem}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SSH_OPTS=(
  -i "${SSH_KEY}"
  -o IdentitiesOnly=yes
  -o ServerAliveInterval=30
)
SSH_CMD="ssh -i ${SSH_KEY} -o IdentitiesOnly=yes"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  ssh                   开交互 shell 到 ${REMOTE_USER}@${REMOTE_HOST}
  run "<cmd>"           远端跑一条命令
  ping                  连接 / 鉴权快速自检 (whoami, hostname, uptime)
  setup                 一次性:装 nginx + 生 cert + 装 systemd unit。
                        nginx/systemd 配置改了之后也要重跑一次
  deploy                每次:本地 build → rsync → restart cute-relay → reload nginx
                        → 校验 / 返回 200

详细端口拓扑 / 远端目录布局见本文件 header。
EOF
}

cmd_ssh() {
  exec ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}"
}

cmd_run() {
  if [[ $# -eq 0 ]]; then
    echo "run: missing command" >&2
    exit 2
  fi
  ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" "$@"
}

cmd_ping() {
  ssh "${SSH_OPTS[@]}" -o ConnectTimeout=10 -o BatchMode=yes \
    "${REMOTE_USER}@${REMOTE_HOST}" 'whoami && hostname && uptime'
}

# 一次性远端配置:装 nginx、生 self-signed cert、安装 nginx vhost 和 systemd unit。
# 幂等:可以重复跑。cert 已存在则不覆盖,nginx vhost / systemd unit 总是更新。
cmd_setup() {
  echo "→ [1/5] 远端装 nginx + 建目录"
  ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" '
    set -euo pipefail
    sudo apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx
    mkdir -p ~/cute/console-dist ~/cute/relay
  '

  echo "→ [2/5] 远端生 self-signed cert (仅在不存在时,10 年有效)"
  ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" '
    set -euo pipefail
    if [[ ! -f ~/cute/cert.pem ]]; then
      openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout ~/cute/key.pem -out ~/cute/cert.pem -days 3650 \
        -subj "/CN=1.14.190.95"
      chmod 600 ~/cute/key.pem
      echo "  cert generated"
    else
      echo "  cert already exists, skipping"
    fi
  '

  echo "→ [3/5] 推送 nginx vhost → /etc/nginx/sites-available/cute.conf"
  rsync -az -e "${SSH_CMD}" \
    "${PROJECT_DIR}/deploy/nginx-cute.conf" \
    "${REMOTE_USER}@${REMOTE_HOST}:/tmp/cute.conf"
  ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" '
    set -euo pipefail
    sudo mv /tmp/cute.conf /etc/nginx/sites-available/cute.conf
    sudo ln -sf /etc/nginx/sites-available/cute.conf /etc/nginx/sites-enabled/cute.conf
    sudo nginx -t
    sudo systemctl reload nginx
  '

  echo "→ [4/5] 推送 systemd unit → /etc/systemd/system/cute-relay.service"
  rsync -az -e "${SSH_CMD}" \
    "${PROJECT_DIR}/deploy/cute-relay.service" \
    "${REMOTE_USER}@${REMOTE_HOST}:/tmp/cute-relay.service"
  ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" '
    set -euo pipefail
    sudo mv /tmp/cute-relay.service /etc/systemd/system/cute-relay.service
    sudo systemctl daemon-reload
    sudo systemctl enable cute-relay.service
  '

  echo "→ [5/5] 远端装 node (如果没有)"
  ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" '
    set -euo pipefail
    if ! command -v node >/dev/null 2>&1; then
      echo "  node not found, 装 NodeSource Node 20"
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
    fi
    node --version
  '

  echo
  echo "Setup done. 下一步:./deploy.sh deploy"
}

cmd_deploy() {
  echo "→ [1/6] 本地 build console + relay"
  ( cd "${PROJECT_DIR}" && npm run build -w @cute/console -w @cute/relay )

  echo "→ [2/6] rsync console dist → ~/cute/console-dist/"
  rsync -az --delete -e "${SSH_CMD}" \
    "${PROJECT_DIR}/console/dist/" \
    "${REMOTE_USER}@${REMOTE_HOST}:cute/console-dist/"

  echo "→ [3/6] rsync relay bundle + package.json → ~/cute/relay/"
  # 只传 dist + package*.json,不传 src / node_modules / shared
  rsync -az --delete \
    --include='dist/' --include='dist/**' \
    --include='package.json' --include='package-lock.json' \
    --exclude='*' \
    -e "${SSH_CMD}" \
    "${PROJECT_DIR}/relay/" \
    "${REMOTE_USER}@${REMOTE_HOST}:cute/relay/"

  echo "→ [4/6] 远端 npm ci --omit=dev (装 ws + 跳 devDeps)"
  ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" '
    set -euo pipefail
    cd ~/cute/relay
    npm ci --omit=dev --no-audit --no-fund
  '

  echo "→ [5/6] 重启 cute-relay + reload nginx"
  ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" '
    set -euo pipefail
    sudo systemctl restart cute-relay
    sleep 1
    sudo systemctl is-active cute-relay
    sudo systemctl reload nginx
  '

  echo "→ [6/6] 验证 ${REMOTE_URL}"
  local health_body code
  health_body=$(curl -ksS --max-time 10 "${REMOTE_URL}/health" || true)
  code=$(curl -ksS -o /dev/null -w '%{http_code}' --max-time 10 "${REMOTE_URL}/" || true)
  echo "  /health → ${health_body}"
  echo "  /       → HTTP ${code}"
  if [[ "${code}" == "200" && "${health_body}" == *'"ok":true'* ]]; then
    echo
    echo "Deployed: ${REMOTE_URL}/"
  else
    echo
    echo "  ✗ 部署校验失败"
    echo "  cute-relay logs:  ./deploy.sh run 'sudo journalctl -u cute-relay -n 30 --no-pager'"
    echo "  nginx error log:  ./deploy.sh run 'sudo tail -30 /var/log/nginx/cute.error.log'"
    exit 1
  fi
}

main() {
  local sub="${1:-}"
  case "${sub}" in
    ssh)    shift; cmd_ssh "$@" ;;
    run)    shift; cmd_run "$@" ;;
    ping)   shift; cmd_ping ;;
    setup)  shift; cmd_setup ;;
    deploy) shift; cmd_deploy ;;
    ""|-h|--help) usage ;;
    *) echo "Unknown command: ${sub}" >&2; usage; exit 2 ;;
  esac
}

main "$@"
