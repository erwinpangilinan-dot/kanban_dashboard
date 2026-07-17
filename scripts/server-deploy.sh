#!/usr/bin/env bash
# Run on the production server (self-hosted runner host) — no gh CLI needed.
# Uses inventory/local.yml and secrets from an existing Mission Control .env.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${MISSION_CONTROL_ENV:-/opt/mission-control/.env}"
REF="${1:-main}"
ANSIBLE_DIR="$ROOT/ansible"
VENV="${HOME}/.ansible-venv"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Set MISSION_CONTROL_ENV or deploy once via GitHub Actions first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

need() {
  if [ -z "${!1:-}" ]; then
    echo "Required env var missing in $ENV_FILE: $1" >&2
    exit 1
  fi
}

need DATABASE_URL
PG_PASS="${DATABASE_URL#*://*:}"
PG_PASS="${PG_PASS%%@*}"

need JWT_SECRET
need AUTH_PASSWORD
need AUTH_API_TOKEN

if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install ansible
fi

cd "$ANSIBLE_DIR"
"$VENV/bin/ansible-playbook" \
  -i inventory/local.yml \
  playbooks/deploy.yml \
  -e "mc_deploy_ref=${REF}" \
  -e "mc_postgres_password=${PG_PASS}" \
  -e "mc_jwt_secret=${JWT_SECRET}" \
  -e "mc_auth_password=${AUTH_PASSWORD}" \
  -e "mc_auth_api_token=${AUTH_API_TOKEN}" \
  -e "mc_telegram_bot_token=${TELEGRAM_BOT_TOKEN:-}" \
  -e "mc_telegram_chat_id=${TELEGRAM_CHAT_ID:-}" \
  -e "mc_email_from=${EMAIL_FROM:-}" \
  -e "mc_email_to=${EMAIL_TO:-}" \
  -e "mc_google_client_id=${GOOGLE_CLIENT_ID:-}" \
  -e "mc_google_client_secret=${GOOGLE_CLIENT_SECRET:-}" \
  -e "mc_google_refresh_token=${GOOGLE_REFRESH_TOKEN:-}" \
  -e "mc_ollama_base_url=${OLLAMA_BASE_URL:-http://10.10.1.55:11435}" \
  -e "mc_ollama_model=${OLLAMA_MODEL:-qwen3.5:9b}" \
  -e "mc_memoria_api_url=${MEMORIA_API_URL:-http://10.10.1.55:8765}" \
  -e "mc_github_token=${GITHUB_TOKEN:-}" \
  -e "mc_github_webhook_secret=${GITHUB_WEBHOOK_SECRET:-}" \
  -e "mc_github_default_repo=${GITHUB_DEFAULT_REPO:-erwinpangilinan-dot/kanban_dashboard}" \
  -e "mc_public_url=${MISSION_CONTROL_PUBLIC_URL:-http://10.10.50.6}"

echo "Deploy finished. Check: curl -s -H \"Authorization: Bearer \$AUTH_API_TOKEN\" http://127.0.0.1/api/ops/status"
