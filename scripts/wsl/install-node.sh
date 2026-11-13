#!/usr/bin/env bash
# Installs the newest Node.js 24 LTS into ~/.local/node (no sudo) after checking its SHA-256
# against nodejs.org's published sums, and adds it to PATH in ~/.bashrc.
#
# Usage: bash scripts/wsl/install-node.sh [major]   (major defaults to 24)
set -euo pipefail

major="${1:-24}"
case "$(uname -m)" in
	x86_64) arch=x64 ;;
	aarch64) arch=arm64 ;;
	*) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac

version="$(curl -fsSL https://nodejs.org/dist/index.json \
	| grep -o "\"version\":\"v$major\.[0-9.]*\"" | head -1 | cut -d'"' -f4)"
if [ -z "$version" ]; then
	echo "Could not find a Node $major release." >&2
	exit 1
fi

dest="$HOME/.local/node-$version"
if [ ! -x "$dest/bin/node" ]; then
	tmp="$(mktemp -d)"
	trap 'rm -rf "$tmp"' EXIT
	name="node-$version-linux-$arch"
	echo "==> Downloading $name"
	curl -fsSL -o "$tmp/$name.tar.xz" "https://nodejs.org/dist/$version/$name.tar.xz"
	curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$version/SHASUMS256.txt"
	(cd "$tmp" && grep " $name.tar.xz\$" SHASUMS256.txt | sha256sum -c --status -) || {
		echo "Checksum mismatch for $name.tar.xz" >&2
		exit 1
	}
	tar -xJf "$tmp/$name.tar.xz" -C "$tmp"
	mkdir -p "$HOME/.local"
	mv "$tmp/$name" "$dest"
fi
ln -sfn "$dest" "$HOME/.local/node"

if ! grep -q '.local/node/bin' "$HOME/.bashrc" 2>/dev/null; then
	echo 'export PATH="$HOME/.local/node/bin:$PATH"' >> "$HOME/.bashrc"
fi

export PATH="$HOME/.local/node/bin:$PATH"
echo "Node $(node -v), npm $(npm -v) in $HOME/.local/node"
echo "Open a new terminal (or run: source ~/.bashrc) to use it."
