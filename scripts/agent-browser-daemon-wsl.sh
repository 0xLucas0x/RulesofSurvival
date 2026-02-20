#!/usr/bin/env bash
set -euo pipefail

# Starts agent-browser daemon in foreground with WSL runtime settings.
# Keep this running in one terminal, then use scripts/agent-browser-wsl.sh in another.

SESSION="${AGENT_BROWSER_SESSION:-wsl}"
SOCK_FILE="/tmp/agent-browser-${SESSION}.sock"
PID_FILE="/tmp/agent-browser-${SESSION}.pid"
DAEMON_JS="${AGENT_BROWSER_DAEMON_JS:-$(npm root -g)/agent-browser/dist/daemon.js}"

if [[ ! -f "${DAEMON_JS}" ]]; then
  echo "Daemon script not found: ${DAEMON_JS}" >&2
  exit 1
fi

if [[ -f "${PID_FILE}" ]]; then
  PID="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ -n "${PID}" ]] && ! kill -0 "${PID}" 2>/dev/null; then
    rm -f "${PID_FILE}" "${SOCK_FILE}" || true
  fi
fi

export AGENT_BROWSER_SESSION="${SESSION}"
export AGENT_BROWSER_EXECUTABLE_PATH="${AGENT_BROWSER_EXECUTABLE_PATH:-${HOME}/.local/bin/chrome-headless-shell-wsl}"

exec node "${DAEMON_JS}"
