# Zwifit

Welcome to the cryptically named Zwifit! This NodeJS app joins Zwift with treadmills running iFit® with Wi-Fi/Bluetooth.

**Disclaimer:** I'm not associated with either company. Their trademarks and content are their own.
Heck, they might force me to take this down! But let's enjoy the *run* before they do.

## How This Works

This software connects to your iFit® treadmill over Wi-Fi/Bluetooth to observe its speed and incline. It then
broadcasts that information over Bluetooth in a standard protocol that apps like Zwift are able to
understand.

## What Treadmills Are Compatible?

At the moment it seems hit or miss on which iFit treadmills with Wi-Fi/Bluetooth work, but we are building a spreadsheet
over at the following URL. Look through that. You may also be interested in the TreadSync app, which has a similar
goal to this project, but runs in a slightly different way (on iOS devices).

http://bit.ly/TS-compat

## Minimum Requirements

1. An iFit® treadmill with Wi-Fi or Bluetooth (for example a NordicTrack C 990 over Wi-Fi).
2. Zwift running on your favorite device.
3. A computer that stays near the treadmill: Linux (including a Raspberry Pi 3B+/4/5 or Ubuntu on
   Windows WSL), macOS or Windows, with a Bluetooth LE adapter for the broadcast to Zwift.
4. Node.js **24 LTS** or newer.
5. For Wi-Fi treadmills: the treadmill's IP address helps (reserve it in your router), but Zwifit
   can also search your network for it.

You need to be minimally comfortable with a terminal. Or have a nerdy friend!

## Software Requirements

### Ubuntu on Windows (WSL)

Windows can run Zwifit inside Ubuntu on WSL with a USB Bluetooth dongle passed through to Linux.
Follow [scripts/wsl/README.md](scripts/wsl/README.md) once; in short:

1. Build a Bluetooth-enabled WSL kernel: `bash scripts/wsl/build-bt-kernel.sh`, then add
   `kernel=C:\\WSL\\bzImage-bluetooth` and `networkingMode=mirrored` under `[wsl2]` in
   `%USERPROFILE%\.wslconfig` and run `wsl --shutdown`.
2. Allow the control page through the Windows firewall **and** the Hyper-V firewall that guards
   WSL in mirrored mode (PowerShell as administrator; the exact commands are in
   [scripts/wsl/README.md](scripts/wsl/README.md#2-build-a-wsl-kernel-with-bluetooth)). On the
   Windows PC itself use `http://127.0.0.1:1337/`.
3. Share the dongle with WSL: `.\scripts\wsl\attach-bluetooth.ps1 -BusId <BUSID>`
   (**repeat after every reboot**, with an Ubuntu window open).
4. In Ubuntu: `bash scripts/wsl/install-node.sh`, then
   `sudo apt install -y bluez libcap2-bin`, `sudo systemctl disable --now bluetooth`,
   `sudo cp scripts/wsl/99-zwifit-hci-up.rules /etc/udev/rules.d/ && sudo hciconfig hci0 up`, and
   ``sudo setcap cap_net_raw,cap_net_admin+eip "$(readlink -f "$(which node)")"``.
5. Check: `bash scripts/wsl/check-bluetooth.sh` ends with `Bluetooth kernel support: OK`.

Install Zwifit inside the Linux file system (for example `~/zwifit`), not under `/mnt/c`: the
Bluetooth libraries must be the Linux builds.

### Linux and Raspberry Pi

1. `sudo apt-get update && sudo apt-get install -y git bluez libcap2-bin`
2. Install Node.js 24 LTS (from [nodejs.org](https://nodejs.org/), your package manager, or
   `bash scripts/wsl/install-node.sh`, which also works on a Pi).
3. Let Zwifit drive the Bluetooth adapter: `sudo systemctl disable --now bluetooth`,
   `sudo hciconfig hci0 up`, and ``sudo setcap cap_net_raw,cap_net_admin+eip "$(readlink -f "$(which node)")"``
   (re-run the `setcap` line after upgrading Node).

### macOS

Install Node.js 24 LTS and Git. Bluetooth works through macOS's own stack; allow the terminal to
use Bluetooth when macOS asks.

### Windows (native)

Install Node.js 24 LTS and Git. Bluetooth broadcasting natively on Windows depends on your adapter;
Ubuntu on WSL (above) is the tested route.

## Getting Started

```bash
git clone https://github.com/dawsontoth/zwifit.git
cd zwifit
npm ci
npm start
```

The first start asks a few questions (units, Wi-Fi or Bluetooth, treadmill IP or Bluetooth code),
then prints:

```
Pairing code: ABCD-1234
Control page: http://localhost:1337/
```

Open the control page on your phone, tablet or computer (use the computer's IP or name, for example
`http://192.168.1.20:1337/`) and enter the pairing code. Each device pairs once and stays paired
until it goes unused for 90 days. Run `npm run pair` for a new code; already paired devices stay
paired. Change answers later with `npm run setup` or on the Settings page.

To try everything without a treadmill: `npm run start:sim`.

Settings, plans and workout history are stored per user, not in the repository:
`~/.local/share/zwifit` (Linux), `~/Library/Application Support/Zwifit` (macOS),
`%APPDATA%\Zwifit` (Windows), or wherever `ZWIFIT_DATA_DIR` points. An old `settings.conf` and
`routes.conf` in the Zwifit folder are imported automatically on first start and left as they are.

### Training plans

On the **Plans** page, build a plan from steps (speed in mph/km/h or pace in min/mi or min/km,
incline, and a time or distance) and repeat blocks (for example 6 × fast/recover). **Start** runs it:
Zwifit sets each step's speed and incline. **Pause** stops the belt; it only restarts when you press
**Resume**. When the plan ends, Zwifit sets a cool-down walk (2 mph / 3 km/h, 0 %) and never stops
the belt for you. Plans can be exported and imported as files.

### Workout history

Every plan run is saved with per-step targets, actual speed, incline and heart rate (from the
treadmill's chest strap or grips). Open **History** to review a workout or export it as CSV.

### Security

Only paired devices can see live data or control the treadmill. Speeds and inclines outside the
limits in Settings (and the treadmill's own limits) are refused, never quietly capped. If you open
the control page by a custom DNS name, add it to `ZWIFIT_ALLOWED_HOSTS` (comma separated).

## Automatic Startup

### Using PM2

Do you want this script to run in the background, even when you restart your computer? There are many
ways to accomplish this. Personally, I use a program called PM2.

_NOTE: To install this program globally, you can prefix `sudo ` before the `npm install` line below, but it would be far wiser to tweak your installation of NPM so that `sudo` isn't required! Follow the steps in the following article, and you'll be doing your system a favor! https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally You only need to do this once._

Run the following to set everything up:

```bash
npm install -g pm2
pm2 startup
pm2 start app.js
pm2 save
```

You can undo this easily:

```bash
pm2 unstartup
```

Or restart, or view logs:

```bash
pm2 restart all
pm2 logs
```

Or update the code and restart:

```bash
git pull
pm2 restart all
```

### Using cron with automatic shutdown

If you use a Raspberry Pi it is crucial to shutdown using

```bash
sudo poweroff
```

to avoid damaging the SD card (google for it to find more information). To perform this action after every workout
in a convenient way there is the run-script `raspberrypi.sh` which can be used.

*Details:* If the environment variable `SHUTDOWN_ONDISCONNECT=1` is set for the Zwifit process then Zwifit stops after
loosing the Wifi/Bluetooth connection what is usually caused by switching off the treadmill. This situation is
detected by the run-script `raspberrypi.sh` to shutdown your Raspberry Pi properly.

Since the shutdown procedure requires `sudo` it is advisable to start the shell script using the root cron.
The run-script switches to the user `pi` for running Zwifit, so the root user is only used for shutdown.

To run Zwifit on startup edit the crontab by using

```bash
sudo crontab -e
```

and add this line at the end of the file:

```bash
@reboot nohup /home/pi/zwifit/raspberrypi.sh
```
(where you have to replace the path `/home/pi/zwifit` by the installation path of Zwifit at your system)

*Once applied steps for using the system are:*
1. Plug in your Raspberry Pi.
1. Wait until your treadmill enlights the connection led (or the control page http://raspberrypi.local:1337 is available and the ifit symbol is green) which takes 70 seconds using a Raspberry Pi ZeroW.
1. Do your workouts with Zwift and connect or disconnect to the simulated treadmill as often you need to.
1. Once you retire simple switch of your treadmill.
1. About 10 seconds later it is save to plugin off your Raspberry Pi.

## Calibration

Zwifit will report your treadmill's exact speed, as measured by the machine itself. You can use the calibration
feature within Zwift to adjust this, just like you would with a footpod. Alternatively, load up the Zwifit Web UI
and head to the Settings page.

## Control and Monitoring

The app runs a local web server with a live dashboard (speed, pace, incline, heart rate, distance, time), manual speed and incline controls, training plans, workout history and settings. Open it on any paired device at the computer's IP or name, for example http://raspberrypi.local:1337/ or http://192.168.0.50:1337/ (or http://localhost:1337/ on the same machine).

If you have a monitor or touch screen connected to your Pi, you can run it in Kiosk mode. It can launch the Zwifit UI automatically. Follow the steps in this article to get started: https://pimylifeup.com/raspberry-pi-kiosk/

## Set the incline according to your current Zwift session

Zwift does not send the current gain of your running session to the treadmill. However, you can use the software [zwifit-incline-tracker](https://github.com/RasPelikan/zwifit-incline-tracker) to achieve this regardless. These automatic updates are only processed if the treadmill is in the active status.

## Contributing

Pull requests are welcome! Do your best to emulate the code around what you are editing.

## Thank you!

If this works for you and improves your running experience, please consider donating to the developer
who made this possible.

https://venmo.com/DawsonToth

This will also encourage future improvements. Thanks!
