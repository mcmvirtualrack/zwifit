#!/usr/bin/env bash
# Copies Zwifit from a Windows checkout (e.g. /mnt/c/...) into the Linux file system and installs
# the Linux builds of its dependencies. Run inside Ubuntu on WSL from the Windows checkout:
#   bash scripts/wsl/deploy.sh [target-dir]      (default ~/zwifit)
# Your settings, plans and history live in ~/.local/share/zwifit and are not touched.
set -euo pipefail

src="$(cd "$(dirname "$0")/../.." && pwd)"
dest="${1:-$HOME/zwifit}"
export PATH="$HOME/.local/node/bin:$PATH"

if ! command -v node >/dev/null; then
	echo "Node.js is not installed. Run: bash scripts/wsl/install-node.sh" >&2
	exit 1
fi
if ! command -v rsync >/dev/null; then
	echo "rsync is missing. Run: sudo apt install -y rsync" >&2
	exit 1
fi

echo "==> Copying $src to $dest"
mkdir -p "$dest"
rsync -a --delete \
	--exclude node_modules --exclude .git --exclude test-results --exclude playwright-report \
	--exclude coverage --exclude 'src/api/web-src' --exclude '.zwifit-data' \
	"$src/" "$dest/"

echo "==> Installing Linux dependencies"
cd "$dest"
npm ci --omit=dev --no-fund --no-audit

node_bin="$(readlink -f "$(command -v node)")"
if ! getcap "$node_bin" 2>/dev/null | grep -q cap_net_raw; then
	echo
	echo "Node is not allowed to use Bluetooth yet. Run once:"
	echo "  sudo setcap cap_net_raw,cap_net_admin+eip \"$node_bin\""
fi

echo
echo "Deployed. Start Zwifit with:  cd $dest && npm start"
