#!/usr/bin/env bash
set -euo pipefail

# Wrapper for agent-browser on WSL:
# - injects executable path for Chromium with user-local shared libs
# - cleans stale socket/pid files if daemon crashed

SESSION="${AGENT_BROWSER_SESSION:-wsl}"
SOCK_FILE="/tmp/agent-browser-${SESSION}.sock"
PID_FILE="/tmp/agent-browser-${SESSION}.pid"

if [[ -f "${PID_FILE}" ]]; then
  PID="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ -n "${PID}" ]] && ! kill -0 "${PID}" 2>/dev/null; then
    rm -f "${PID_FILE}" "${SOCK_FILE}" || true
  fi
fi

export AGENT_BROWSER_SESSION="${SESSION}"
export AGENT_BROWSER_EXECUTABLE_PATH="${AGENT_BROWSER_EXECUTABLE_PATH:-${HOME}/.local/bin/chrome-headless-shell-wsl}"

exec agent-browser "$@"
