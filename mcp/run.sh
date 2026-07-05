#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
# .env wins over any MISSION_CONTROL_* set in .cursor/mcp.json
export MISSION_CONTROL_API_URL="${MISSION_CONTROL_API_URL:-http://10.10.50.6/api}"
export MISSION_CONTROL_API_TOKEN="${MISSION_CONTROL_API_TOKEN:-${AUTH_API_TOKEN:-}}"
if [ -z "$MISSION_CONTROL_API_TOKEN" ] && [ -n "${JWT_SECRET:-}" ]; then
  echo "AUTH_API_TOKEN required in .env when JWT_SECRET is set" >&2
  exit 1
fi
cd "$(dirname "$0")"
exec node src/index.js
