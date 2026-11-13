#!/usr/bin/env bash
# Checks that this WSL (or Linux) machine can run Zwifit's Bluetooth parts.
# Exit code 0 only when the kernel has Bluetooth built in and an adapter (hci0) is visible.
set -u

ok=0
here="$(cd "$(dirname "$0")" && pwd)"

echo "Kernel: $(uname -r)"

config=""
if [ -r /proc/config.gz ]; then
	config="$(zcat /proc/config.gz)"
elif [ -r "/boot/config-$(uname -r)" ]; then
	config="$(cat "/boot/config-$(uname -r)")"
fi

check_option() {
	local name="$1"
	if [ -z "$config" ]; then
		echo "  ?  $name (kernel config not readable)"
		return
	fi
	local line
	line="$(printf '%s\n' "$config" | grep -E "^${name}=" || true)"
	case "$line" in
		"${name}=y") echo "  OK $name=y" ;;
		"${name}=m")
			if grep -qi microsoft /proc/version 2>/dev/null; then
				echo "  !! $name=m (custom WSL kernels can't load modules; build it in with =y)"
				ok=1
			else
				echo "  OK $name=m"
			fi
			;;
		*) echo "  !! $name is not set"; ok=1 ;;
	esac
}

echo "Bluetooth kernel support:"
check_option CONFIG_BT
check_option CONFIG_BT_LE
check_option CONFIG_BT_HCIBTUSB

if [ "$ok" -ne 0 ]; then
	echo
	echo "Next step: build a Bluetooth-enabled WSL kernel. See $here/README.md"
	exit 1
fi

echo "Bluetooth adapter:"
if [ -d /sys/class/bluetooth/hci0 ]; then
	echo "  OK hci0 present"
else
	echo "  !! no adapter (hci0) found"
	if grep -qi microsoft /proc/version 2>/dev/null; then
		echo "Next step: in Windows PowerShell run scripts\\wsl\\attach-bluetooth.ps1"
	else
		echo "Next step: plug in a Bluetooth LE adapter and check 'rfkill list'"
	fi
	exit 1
fi

if command -v hciconfig >/dev/null 2>&1; then
	if hciconfig hci0 2>/dev/null | grep -q 'UP RUNNING'; then
		echo "  OK hci0 switched on"
	else
		echo "  !! hci0 is switched off"
		echo "Next step: sudo hciconfig hci0 up (and install 99-zwifit-hci-up.rules, see $here/README.md)"
		exit 1
	fi
else
	echo "  ?  can't tell whether hci0 is switched on (install bluez for hciconfig)"
fi

echo "Bluetooth kernel support: OK"
exit 0
