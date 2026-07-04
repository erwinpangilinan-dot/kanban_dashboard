#!/usr/bin/env bash
# Install GitHub Actions self-hosted runner on this server (run once as deploy).
# Usage: GITHUB_REPO=owner/repo ./scripts/setup-github-runner.sh
set -euo pipefail

GITHUB_REPO="${GITHUB_REPO:-erwinpangilinan-dot/kanban_dashboard}"
RUNNER_USER="${RUNNER_USER:-deploy}"
RUNNER_HOME="${RUNNER_HOME:-/home/${RUNNER_USER}/actions-runner}"
RUNNER_LABELS="${RUNNER_LABELS:-mission-control,self-hosted,Linux}"
RUNNER_VERSION="${RUNNER_VERSION:-2.325.0}"

if [[ -z "${RUNNER_TOKEN:-}" ]]; then
  echo "RUNNER_TOKEN is required (GitHub registration token, valid ~1 hour)." >&2
  echo "Generate with: gh api repos/${GITHUB_REPO}/actions/runners/registration-token --method POST -q .token" >&2
  exit 1
fi

if [[ "$(id -un)" != "$RUNNER_USER" ]]; then
  echo "Run as ${RUNNER_USER} (e.g. su - deploy -c 'RUNNER_TOKEN=... $0')" >&2
  exit 1
fi

sudo apt-get update -qq
sudo apt-get install -y -qq curl tar python3 python3-pip python3-venv git

mkdir -p "$RUNNER_HOME"
cd "$RUNNER_HOME"

if [[ ! -f ./config.sh ]]; then
  curl -fsSL -o runner.tgz \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
  tar xzf runner.tgz
  rm runner.tgz
fi

./config.sh \
  --url "https://github.com/${GITHUB_REPO}" \
  --token "$RUNNER_TOKEN" \
  --labels "$RUNNER_LABELS" \
  --unattended \
  --replace

sudo ./svc.sh install "$RUNNER_USER"
sudo ./svc.sh start
sudo ./svc.sh status

echo "✓ Runner installed for https://github.com/${GITHUB_REPO}"
echo "  Labels: ${RUNNER_LABELS}"
