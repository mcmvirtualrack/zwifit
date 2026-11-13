# Bluetooth on Ubuntu under WSL

Zwift needs Zwifit to broadcast over Bluetooth LE. The kernel that ships with WSL has Bluetooth
turned off, so running Zwifit in WSL with real Bluetooth takes three one-time steps: update WSL,
build a WSL kernel with Bluetooth, and share a USB Bluetooth dongle with WSL.

Use a plain USB Bluetooth LE dongle (for example CSR8510 or Realtek RTL8761B based). Built-in
Intel laptop adapters often fail when passed through to WSL. If your treadmill itself connects
over Bluetooth (not Wi-Fi), you need **two** dongles: one to talk to the treadmill and one to
broadcast to Zwift.

## 1. Update WSL

In PowerShell (administrator):

```powershell
wsl --update
wsl --shutdown
```

Then in Ubuntu run `bash scripts/wsl/check-bluetooth.sh`. If it reports
`Bluetooth kernel support: OK`, skip to step 3.

## 2. Build a WSL kernel with Bluetooth

In Ubuntu, from the Zwifit folder, run the build script (asks for your sudo password):

```bash
bash scripts/wsl/build-bt-kernel.sh
```

It picks the newest `linux-msft-wsl-6.6.*` kernel, enables Bluetooth, builds the Realtek dongle
firmware into the kernel (WSL can't load firmware files at runtime) and copies the result to
`C:\WSL\bzImage-bluetooth`. Then continue with the `.wslconfig` step below.

The equivalent manual steps, for reference:

```bash
sudo apt update
sudo apt install -y build-essential flex bison libssl-dev libelf-dev bc dwarves python3 cpio
KVER="$(uname -r | cut -d- -f1)"          # e.g. 6.6.87.2
git clone --depth 1 --branch "linux-msft-wsl-$KVER" \
  https://github.com/microsoft/WSL2-Linux-Kernel.git ~/wsl-kernel
cd ~/wsl-kernel
cp Microsoft/config-wsl .config
scripts/config --enable CONFIG_BT --enable CONFIG_BT_BREDR --enable CONFIG_BT_LE \
  --enable CONFIG_BT_HCIBTUSB --enable CONFIG_BT_HCIBTUSB_RTL --enable CONFIG_BT_RTL
make olddefconfig
make -j"$(nproc)"
mkdir -p /mnt/c/WSL && cp arch/x86/boot/bzImage /mnt/c/WSL/bzImage-bluetooth
```

Options must be built in (`=y`), not modules: custom WSL kernels don't load modules.

Then edit `%USERPROFILE%\.wslconfig` on Windows (create it if missing):

```ini
[wsl2]
kernel=C:\\WSL\\bzImage-bluetooth
networkingMode=mirrored
```

`networkingMode=mirrored` lets your phone reach the Zwifit control page at the Windows PC's IP.
Allow the port through the Windows firewall once (PowerShell, administrator):

```powershell
New-NetFirewallRule -DisplayName "Zwifit" -Direction Inbound -Protocol TCP -LocalPort 1337 -Action Allow
# Mirrored networking puts WSL behind the Hyper-V firewall too; without this, phones time out:
New-NetFirewallHyperVRule -Name "Zwifit" -DisplayName "Zwifit" -Direction Inbound `
  -VMCreatorId "{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}" -Protocol TCP -LocalPorts 1337 -Action Allow
```

From Windows itself, open `http://127.0.0.1:1337/` (`localhost` may try IPv6 first and hang).

**Browsers that insist on HTTPS** (e.g. Edge on a Surface Hub managed by policy): add HTTPS on a
second port, keeping HTTP on 1337. In Ubuntu, make a certificate from Zwifit's own small
certificate authority (CA), point `server.tls` in `~/.local/share/zwifit/settings.json` at it (the
script prints the line), then restart Zwifit:

```bash
bash scripts/wsl/make-cert.sh
# settings.json → "server": { ..., "tls": { "certPath": ".../tls/cert.pem", "keyPath": ".../tls/key.pem", "port": 1338 } }
```

Allow 1338 like 1337 above (both firewall rules), then open `https://<PC's IP>:1338/`. Until a
device trusts the CA it shows a "not private" warning you can click through, but Edge and Chrome
then neither **install the app** ("not from a secure origin") nor, on locked-down devices, always
keep cookies. To fix that, install `tls/zwifit-ca.cer` on the device as a **trusted root
certificate** (on a managed Surface Hub: an Intune "Trusted certificate" profile). Re-run the
script when the PC's IP changes: the CA stays the same, so devices need nothing new. Leave `port`
out to make 1337 itself HTTPS instead.

Apply with `wsl --shutdown`, reopen Ubuntu and re-run `bash scripts/wsl/check-bluetooth.sh`.

To undo, remove the `kernel=` line and run `wsl --shutdown`.

## 3. Share the dongle with WSL

Install usbipd-win if needed (`winget install usbipd`). Then in PowerShell:

```powershell
.\scripts\wsl\attach-bluetooth.ps1            # picks the Bluetooth device automatically
.\scripts\wsl\attach-bluetooth.ps1 -BusId 2-3 # or name it from `usbipd list`
```

The first time needs an administrator prompt. **Repeat this after every reboot** or replug;
while the dongle is attached to WSL, Windows can't use it.

## 4. Install Node.js and let it use Bluetooth without sudo

Install Node 24 into `~/.local/node` (checksum-verified, no sudo), then open a new terminal:

```bash
bash scripts/wsl/install-node.sh
```

Then give Node access to raw Bluetooth:

```bash
sudo apt install -y bluetooth bluez libcap2-bin
sudo systemctl disable --now bluetooth   # Zwifit drives the adapter directly
sudo setcap cap_net_raw,cap_net_admin+eip "$(readlink -f "$(which node)")"
```

Without the Bluetooth service nothing switches the adapter on, so add a rule that does it each
time the dongle is attached, and switch it on now:

```bash
sudo cp scripts/wsl/99-zwifit-hci-up.rules /etc/udev/rules.d/
sudo udevadm control --reload
sudo hciconfig hci0 up
```

Re-run the `setcap` line after upgrading Node.

## 5. Check that the PC broadcasts

```bash
node scripts/wsl/ble-advertise-test.js
```

While it runs (two minutes), a BLE scanner app on your phone (e.g. nRF Connect) should list
**Zwifit Test** advertising the Fitness Machine (0x1826) and Running Speed and Cadence (0x1814)
services.

## 6. Optional: ANT+ heart rate and cadence
 a Garmin ANT+ USB stick (USB2 or USB-m), Zwifit can take heart rate from a Garmin watch
(turn on **Broadcast Heart Rate** on the watch) or an ANT+ chest strap, and running cadence from an+ footpod (or an HRM-Pro Plus). Share the stick like the Bluetooth dongle, from PowerShell:

```powershell list                                     # note the BUSID of "ANT USBStick2"
.\scripts\wsl\attach-bluetooth.ps1 -BusId 2-1 -Keep   # administrator the first time; leave this window open
```
 in Ubuntu, once:

```bash cp scripts/wsl/99-zwifit-ant.rules /etc/udev/rules.d/ udevadm control --reload && sudo udevadm trigger scripts/find-ant-sensors.js      # with Zwifit stopped: prints heart rate as the watch sends it
```
 → Sensors chooses where heart rate and cadence come from (ANT+ first by default).

The ANT+ stick drops off the USB bus whenever it resets (for example when Zwifit starts), and WSL treats that as unplugging it. `-Keep` re-attaches it each time; without it Zwifit reports "No ANT+ USB stick found".
