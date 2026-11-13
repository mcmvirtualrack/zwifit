#!/usr/bin/env bash
# Builds a WSL 2 kernel with Bluetooth (and Realtek dongle firmware) built in, and copies it to
# C:\WSL\bzImage-bluetooth. Run inside Ubuntu on WSL. Asks for your sudo password once to install
# build tools. Takes roughly 10-30 minutes.
#
# Usage: bash scripts/wsl/build-bt-kernel.sh [kernel-tag]
#   kernel-tag defaults to the newest linux-msft-wsl-6.6.* tag.
set -euo pipefail

if ! grep -qi microsoft /proc/version; then
	echo "This script is for Ubuntu running under WSL." >&2
	exit 1
fi

work="${ZWIFIT_KERNEL_DIR:-$HOME/wsl-kernel}"
out_dir="/mnt/c/WSL"
out="$out_dir/bzImage-bluetooth"

echo "==> Installing build tools (sudo)"
sudo apt-get update -qq
sudo apt-get install -y -qq build-essential flex bison libssl-dev libelf-dev bc dwarves python3 \
	cpio git zstd linux-firmware >/dev/null

tag="${1:-}"
if [ -z "$tag" ]; then
	tag="$(git ls-remote --tags https://github.com/microsoft/WSL2-Linux-Kernel.git 'linux-msft-wsl-6.6.*' \
		| sed 's#.*/##' | grep -v '\^{}' | sort -V | tail -1)"
fi
echo "==> Kernel tag: $tag"

if [ ! -d "$work/.git" ] || [ "$(git -C "$work" describe --tags 2>/dev/null)" != "$tag" ]; then
	rm -rf "$work"
	git clone --depth 1 --branch "$tag" https://github.com/microsoft/WSL2-Linux-Kernel.git "$work"
fi
cd "$work"

echo "==> Preparing Realtek Bluetooth firmware (built into the kernel)"
fw_dir="$work/zwifit-firmware"
mkdir -p "$fw_dir/rtl_bt"
fw_list=""
for name in rtl8761bu_fw.bin rtl8761bu_config.bin rtl8761b_fw.bin rtl8761b_config.bin; do
	src="/lib/firmware/rtl_bt/$name"
	if [ -f "$src.zst" ]; then
		zstd -q -d -f "$src.zst" -o "$fw_dir/rtl_bt/$name"
	elif [ -f "$src" ]; then
		cp "$src" "$fw_dir/rtl_bt/$name"
	else
		continue
	fi
	fw_list="$fw_list rtl_bt/$name"
done
fw_list="${fw_list# }"
echo "    firmware: ${fw_list:-none found}"

echo "==> Configuring"
cp Microsoft/config-wsl .config
# The 6.6 WSL config builds USB and USB/IP as modules, but a custom WSL kernel doesn't load
# modules, so USB, USB/IP (for usbipd-win) and Bluetooth must all be built in.
scripts/config \
	--enable CONFIG_USB_SUPPORT \
	--enable CONFIG_USB \
	--enable CONFIG_USBIP_CORE \
	--enable CONFIG_USBIP_VHCI_HCD \
	--enable CONFIG_BT \
	--enable CONFIG_BT_BREDR \
	--enable CONFIG_BT_LE \
	--enable CONFIG_BT_HCIBTUSB \
	--enable CONFIG_BT_HCIBTUSB_RTL \
	--enable CONFIG_BT_HCIBTUSB_BCM \
	--enable CONFIG_BT_RTL \
	--enable CONFIG_BT_BCM \
	--enable CONFIG_BT_INTEL
if [ -n "$fw_list" ]; then
	scripts/config --set-str CONFIG_EXTRA_FIRMWARE "$fw_list" \
		--set-str CONFIG_EXTRA_FIRMWARE_DIR "$fw_dir"
fi
make olddefconfig >/dev/null

for opt in CONFIG_USB CONFIG_USBIP_CORE CONFIG_USBIP_VHCI_HCD CONFIG_BT CONFIG_BT_LE CONFIG_BT_HCIBTUSB CONFIG_BT_RTL; do
	if ! grep -q "^$opt=y" .config; then
		echo "Kernel option $opt did not end up built in (=y)." >&2
		exit 1
	fi
done

echo "==> Building with $(nproc) jobs"
make -j"$(nproc)" >/dev/null

mkdir -p "$out_dir"
cp arch/x86/boot/bzImage "$out"
echo
echo "Built $out"
echo
echo "Next, on Windows, add these lines to %USERPROFILE%\\.wslconfig (create the file if needed):"
echo
echo "  [wsl2]"
echo "  kernel=C:\\\\WSL\\\\bzImage-bluetooth"
echo "  networkingMode=mirrored"
echo
echo "Then run 'wsl --shutdown' in PowerShell (this restarts every WSL distro), reopen Ubuntu and"
echo "run: bash scripts/wsl/check-bluetooth.sh"
