#!/usr/bin/env bash
set -euo pipefail

# WSL-friendly setup for agent-browser on systems without sudo access.
# It installs the exact Playwright browser revision required by agent-browser
# and unpacks missing shared libs into a user-local directory.

AGENT_BROWSER_ROOT="${AGENT_BROWSER_ROOT:-$(npm root -g)/agent-browser}"
PLAYWRIGHT_CLI="${AGENT_BROWSER_ROOT}/node_modules/playwright-core/cli.js"
LIBS_BASE="${HOME}/.local/agent-browser-libs"
DEBS_DIR="${LIBS_BASE}/debs"
ROOTFS_DIR="${LIBS_BASE}/rootfs"
LIB_DIR="${ROOTFS_DIR}/usr/lib/x86_64-linux-gnu"
WRAPPER_BIN="${HOME}/.local/bin/chrome-headless-shell-wsl"
PLAYWRIGHT_BIN="${HOME}/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell"

if [[ ! -d "${AGENT_BROWSER_ROOT}" ]]; then
  echo "agent-browser not found at: ${AGENT_BROWSER_ROOT}" >&2
  echo "Install it first: npm i -g agent-browser" >&2
  exit 1
fi

if [[ ! -f "${PLAYWRIGHT_CLI}" ]]; then
  echo "Playwright CLI not found at: ${PLAYWRIGHT_CLI}" >&2
  exit 1
fi

mkdir -p "${DEBS_DIR}" "${ROOTFS_DIR}" "${HOME}/.local/bin"

echo "[1/3] Installing Playwright chromium revision required by agent-browser..."
node "${PLAYWRIGHT_CLI}" install chromium

echo "[2/3] Downloading user-local runtime libs (libnspr4/libnss3)..."
(
  cd "${DEBS_DIR}"
  apt download libnspr4 libnss3 >/dev/null
  for deb in ./*.deb; do
    dpkg-deb -x "${deb}" "${ROOTFS_DIR}"
  done
)

if [[ ! -f "${LIB_DIR}/libnspr4.so" || ! -f "${LIB_DIR}/libnss3.so" ]]; then
  echo "Expected libs were not extracted into ${LIB_DIR}" >&2
  exit 1
fi

echo "[3/3] Writing Chromium wrapper: ${WRAPPER_BIN}"
cat > "${WRAPPER_BIN}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export LD_LIBRARY_PATH="${LIB_DIR}:\${LD_LIBRARY_PATH:-}"
exec "${PLAYWRIGHT_BIN}" "\$@"
EOF
chmod +x "${WRAPPER_BIN}"

echo ""
echo "Setup completed."
echo "Next step: use scripts/agent-browser-wsl.sh instead of raw agent-browser."
