#!/usr/bin/env bash
# asset-lab deploy / remote-access script
#
# -----------------------------------------------------------------------------
# Server (verified 2026-05-05)
# -----------------------------------------------------------------------------
#   Host         : 1.14.190.95         (Tencent Cloud CVM, Ubuntu 6.8)
#   User         : ubuntu              (NOT root, NOT lighthouse)
#   Hostname     : VM-0-4-ubuntu
#   SSH key      : ~/.ssh/jet.pem      (RSA 2048,
#                                       SHA256:5oKpQOCCDiaFL73tHoExI4wMXHCqsB839S8ZwTWToU0)
#                  Override per-developer with:  export ASSET_LAB_SSH_KEY=~/.ssh/your.pem
#   Server-side
#   public key   : labelled `skey-kgkoxj5l` in Tencent Cloud console
#   Remote dir   : ~/asset_lab          (rsync target)
#   Live URL     : https://1.14.190.95/ (self-signed cert; click-through OK)
#
# Why this key (and not ~/.ssh/id_rsa)?
#   id_rsa (SHA256:Enbx...) is NOT installed on this box. Only jet.pem is
#   authorised. -i is required because IdentitiesOnly defaults off and the
#   wrong key would be tried first.
#
# Users tried and rejected: root, lighthouse, centos, jet.d.
#
# -----------------------------------------------------------------------------
# Why HTTPS on 443 (not HTTP on 8000)?
# -----------------------------------------------------------------------------
# The Tencent Cloud security group on this CVM only opens 22 / 443 / 22940 /
# 18789. Other ports (8000, 8443, ...) get TCP-spoofed by the cloud edge:
# `nc -zv` says "succeeded" but actual data is dropped — looks like an HTTP
# protocol filter, isn't. To open another port: 控制台 → 安全组 → 入站规则.
#
# -----------------------------------------------------------------------------
# Server-side runtime
# -----------------------------------------------------------------------------
# The HTTPS server is supervised by systemd as `asset-lab-https.service`.
# Unit file lives at /etc/systemd/system/asset-lab-https.service on the box;
# a copy is checked in at deploy/asset-lab-https.service for reproducibility.
# Cert/key live at ~/asset_lab/{cert,key}.pem (self-signed, generated once
# with openssl, not tracked in git, never overwritten by `deploy`).
# Logs: `./deploy.sh run 'sudo journalctl -u asset-lab-https -n 50 --no-pager'`
# -----------------------------------------------------------------------------

set -euo pipefail

REMOTE_HOST="1.14.190.95"
REMOTE_USER="ubuntu"
REMOTE_URL="https://1.14.190.95"
SSH_KEY="${ASSET_LAB_SSH_KEY:-${HOME}/.ssh/jet.pem}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SSH_OPTS=(
  -i "${SSH_KEY}"
  -o IdentitiesOnly=yes
  -o ServerAliveInterval=30
)

# rsync uses a string for `-e`, not an array
SSH_CMD="ssh -i ${SSH_KEY} -o IdentitiesOnly=yes"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  ssh                   Open an interactive shell on ${REMOTE_USER}@${REMOTE_HOST}
  run "<cmd>"           Run a one-off command on the remote host
  ping                  Quick connectivity / auth check (whoami, hostname, uptime)
  deploy                Sync repo to remote, restart HTTPS server, verify URL
                        (one-liner for "edit code → reload phone")

Connection / port-choice details are in the header of this file.
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

cmd_deploy() {
  echo "→ rsync ${PROJECT_DIR}/ → ${REMOTE_USER}@${REMOTE_HOST}:~/asset_lab/"
  rsync -az --delete \
    --exclude='.git/' \
    --exclude='temporary_asset/' \
    --exclude='.DS_Store' \
    --exclude='node_modules/' \
    --exclude='.vscode/' \
    --exclude='.claude/' \
    --exclude='cert.pem' --exclude='key.pem' \
    -e "${SSH_CMD}" \
    "${PROJECT_DIR}/" "${REMOTE_USER}@${REMOTE_HOST}:asset_lab/"

  echo "→ restart asset-lab-https.service (systemd)"
  ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" \
    'sudo systemctl restart asset-lab-https && sudo systemctl is-active asset-lab-https'

  echo "→ verify ${REMOTE_URL}/"
  local code
  code=$(curl -ksS -o /dev/null -w '%{http_code}' --max-time 10 "${REMOTE_URL}/" || true)
  if [[ "${code}" == "200" ]]; then
    echo "  ✓ HTTP ${code}"
    echo
    echo "Deployed: ${REMOTE_URL}/"
  else
    echo "  ✗ HTTP ${code} (expected 200)"
    echo "  Check logs: ./deploy.sh run 'sudo journalctl -u asset-lab-https -n 30 --no-pager'"
    exit 1
  fi
}

main() {
  local sub="${1:-}"
  case "${sub}" in
    ssh)    shift; cmd_ssh "$@" ;;
    run)    shift; cmd_run "$@" ;;
    ping)   shift; cmd_ping ;;
    deploy) shift; cmd_deploy ;;
    ""|-h|--help) usage ;;
    *) echo "Unknown command: ${sub}" >&2; usage; exit 2 ;;
  esac
}

main "$@"
