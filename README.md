# Zwifit

Welcome to the cryptically named Zwifit! This NodeJS app joins Zwift with treadmills running iFit® with Wi-Fi/Bluetooth.

It also runs your treadmill workouts for you: build interval plans or generate a multi-week
training program, and Zwifit sets the speed and incline of every step, records heart rate, cadence
and power from your sensors, and keeps a history you can export to Garmin Connect, Strava or a
spreadsheet. Everything is controlled from a dark, phone-friendly web page.

**Disclaimer:** I'm not associated with either company. Their trademarks and content are their own.
Heck, they might force me to take this down! But let's enjoy the *run* before they do.

## How This Works

This software connects to your iFit® treadmill over Wi-Fi/Bluetooth to observe its speed and incline. It then
broadcasts that information over Bluetooth in a standard protocol that apps like Zwift are able to
understand.

Optionally it also reads heart rate, running cadence and running power from ANT+ (USB stick) or
Bluetooth sensors (a chest strap, a Garmin watch broadcasting heart rate, a footpod or a Stryd)
and passes them on to Zwift as Bluetooth heart rate, footpod and power sensors.

```
iFit treadmill ──Wi-Fi/BLE──▶          ──Bluetooth──▶ Zwift (speed, incline, HR, cadence, power)
HR strap, Stryd ──ANT+/BLE──▶  Zwifit
                                        ──web page───▶ phone, tablet, PC (control, plans, history)
```

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
   can also search your network for it (`node scripts/find-treadmill.js wifi`).
6. Optional: an ANT+ USB stick (Garmin USB2/USB-m or USB3) and/or Bluetooth sensors for heart rate,
   cadence and power.

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
6. Optional ANT+ stick: share it the same way (`attach-bluetooth.ps1 -BusId <stick>`) and let
   Zwifit use it: `sudo cp scripts/wsl/99-zwifit-ant.rules /etc/udev/rules.d/ && sudo udevadm control --reload`.

Install Zwifit inside the Linux file system (for example `~/zwifit`), not under `/mnt/c`: the
Bluetooth libraries must be the Linux builds.

### Linux and Raspberry Pi

1. `sudo apt-get update && sudo apt-get install -y git bluez libcap2-bin`
2. Install Node.js 24 LTS (from [nodejs.org](https://nodejs.org/), your package manager, or
   `bash scripts/wsl/install-node.sh`, which also works on a Pi).
3. Let Zwifit drive the Bluetooth adapter: `sudo systemctl disable --now bluetooth`,
   `sudo hciconfig hci0 up`, and ``sudo setcap cap_net_raw,cap_net_admin+eip "$(readlink -f "$(which node)")"``
   (re-run the `setcap` line after upgrading Node).
4. Optional ANT+ stick: `sudo cp scripts/wsl/99-zwifit-ant.rules /etc/udev/rules.d/ && sudo udevadm control --reload`.

### macOS

Install Node.js 24 LTS and Git. Bluetooth works through macOS's own stack; allow the terminal to
use Bluetooth when macOS asks.

### Windows (native)

Install Node.js 24 LTS and Git. Bluetooth broadcasting natively on Windows depends on your adapter;
Ubuntu on WSL (above) is the tested route.

## Getting Started

```bash
git clone https://github.com/mcmvirtualrack/zwifit.git
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
until it goes unused for 90 days. To pair another device, either run `npm run pair` on the
computer, or on a device that is already paired open **Settings → Paired devices → New pairing
code** (that code pairs one device and expires after 10 minutes). Already paired devices stay
paired. Change answers later with `npm run setup` or on the Settings page.

A device that should never need a code (a wall-mounted tablet, for example) can be trusted by its
address: in **Settings → Paired devices**, press **Trust address** on it, or add a client by typing
its IP address.

To try everything without a treadmill: `npm run start:sim`.

Settings, plans and workout history are stored per user, not in the repository:
`~/.local/share/zwifit` (Linux), `~/Library/Application Support/Zwifit` (macOS),
`%APPDATA%\Zwifit` (Windows), or wherever `ZWIFIT_DATA_DIR` points. An old `settings.conf` and
`routes.conf` in the Zwifit folder are imported automatically on first start and left as they are.

## Using Zwifit

The top bar has **Dashboard**, **Workout**, **Plans**, **History** and **Settings**, plus a
**Restart** button. In a browser that supports it you can also **install** Zwifit as an app (see
[HTTPS](#https) for devices that require it).

### Dashboard

Live speed, pace, incline, distance, time, heart rate, cadence and power as tiles and live charts,
manual speed and incline controls, and the status of the treadmill, the sensors and the broadcast
to Zwift.

### Training plans

On the **Plans** page, build a plan from steps (speed in mph/km/h or pace in min/mi or min/km,
incline, and a time or distance) and repeat blocks (for example 6 × fast/recover). **Start** runs it
on the **Workout** page: Zwifit sets each step's speed and incline. **Pause** stops the belt; it only
restarts when you press **Resume**. When the plan ends, Zwifit sets a cool-down walk (2 mph /
3 km/h, 0 %) and never stops the belt for you. Plans can be exported and imported as files.

### Training programs

**Plans → Programs** builds a multi-week schedule from a goal (5K, 10K, half marathon or marathon),
a race date, 6–24 weeks, 3–6 run days a week and your easy-run speed. Preview it first: weeks go
through base, build, peak and taper, every 4th week is lighter, the long run is on your last run day
and the race is on race day. Speeds above your treadmill's maximum are lowered to the maximum. In
the program's calendar, press **Start** on a day to run it; finished days are marked done. Deleting
a program keeps the plans and workouts made from it.

### Workout history

Every run is saved with per-step targets, actual speed, incline, heart rate, cadence and power. Open
**History** for charts and the per-step breakdown, and export a workout as **CSV** (spreadsheets) or
**FIT** (Garmin Connect, Strava and others).

### Sensors

Heart rate, cadence and power each have a source in **Settings → Sensors**: Auto, ANT+, Bluetooth
or Off (heart rate can also come from the treadmill's grips or strap). With an ANT+ stick, Zwifit
uses the first sensor it hears, so usually nothing needs setting up; **Scan for sensors** lists every
sensor in range so you can pick one, and the choice is remembered. Power can be smoothed (for
example over 10 s). A sensor that drops out (strap off, out of range) is picked up again on its own.

To check that the stick hears your sensors (stop Zwifit first): `node scripts/find-ant-sensors.js`.

### Sending sensor data to Zwift

In **Settings → Zwift broadcast**, choose what Zwifit sends besides the treadmill's speed and
incline: heart rate (as a Bluetooth heart rate sensor), cadence (as a footpod) and power (with the
treadmill data, and optionally as a separate Bluetooth power meter). Restart Zwifit, then in Zwift
pair "Zwifit" as Run Speed, Heart Rate, Cadence and Power Source. The same page lists the Zwift
devices connected and what they read. When a sensor stops, Zwift's value goes blank rather than
showing zero.

### Settings

Units, treadmill connection, speed and incline limits, sensors, Zwift broadcast, paired devices and
the server. **Console readout** and **Console output** show what the treadmill reports and the raw
messages to and from it, which helps when a treadmill behaves oddly.

### Security

Only paired devices can see live data or control the treadmill. Speeds and inclines outside the
limits in Settings (and the treadmill's own limits) are refused, never quietly capped. If you open
the control page by a custom DNS name, add it to `ZWIFIT_ALLOWED_HOSTS` (comma separated).

### HTTPS

Plain HTTP on port 1337 is the default. Some browsers insist on HTTPS (a managed Edge on a Surface
Hub, for example), and installing Zwifit as an app on a phone or tablet needs it. Zwifit can serve
HTTPS on a second port with a certificate from its own small certificate authority:

```bash
bash scripts/wsl/make-cert.sh
# then in settings.json: "server": { ..., "tls": { "certPath": ".../tls/cert.pem", "keyPath": ".../tls/key.pem", "port": 1338 } }
```

Restart Zwifit and open `https://<computer's IP>:1338/`. Install `tls/zwifit-ca.cer` on each
device as a trusted root certificate to remove the warning. Details are in
[scripts/wsl/README.md](scripts/wsl/README.md).

### Restarting

`npm start` keeps Zwifit running under a small supervisor, so the **Restart** button (top bar or
**Settings → Server**) restarts it after a settings change without touching the terminal. Set
`ZWIFIT_NO_SUPERVISOR=1` to run without it (the button is then unavailable).

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

## Kiosk mode

Open the control page on any paired device at the computer's IP or name, for example
http://raspberrypi.local:1337/ or http://192.168.0.50:1337/ (or http://localhost:1337/ on the same
machine). If you have a monitor or touch screen connected to your Pi, you can run it in Kiosk mode.
It can launch the Zwifit UI automatically. Follow the steps in this article to get started:
https://pimylifeup.com/raspberry-pi-kiosk/

## Set the incline according to your current Zwift session

Zwift does not send the current gain of your running session to the treadmill. However, you can use the software [zwifit-incline-tracker](https://github.com/RasPelikan/zwifit-incline-tracker) to achieve this regardless. These automatic updates are only processed if the treadmill is in the active status.

## Troubleshooting tools

| Command | What it does |
|---------|--------------|
| `node scripts/find-treadmill.js wifi` (or `ble`) | Finds an iFit treadmill on your network or over Bluetooth |
| `node scripts/watch-treadmill.js <ip>` | Read-only: prints what a Wi-Fi treadmill reports, never sends commands |
| `node scripts/find-ant-sensors.js` | Lists ANT+ heart rate, cadence and power heard by the stick |
| `bash scripts/wsl/check-bluetooth.sh` | Checks Bluetooth support under WSL/Linux |

## Contributing

Pull requests are welcome! Do your best to emulate the code around what you are editing.

```bash
npm test             # Jest: unit + integration tests with a simulated treadmill
npm run test:web     # Angular unit tests
npm run test:e2e     # Playwright: phone, tablet and desktop, light and dark
npm run lint
npm run build:web    # rebuild src/api/web-dist from src/api/web-src
```

The server is in `src/` (pure logic in `src/core`, hardware behind `src/adapters`); the web app is
in `src/api/web-src` (Angular). Specs, design notes and task lists are in [specs/](specs/).

## Thank you!

If this works for you and improves your running experience, please consider donating to the developer
who made this possible.

https://venmo.com/DawsonToth

This will also encourage future improvements. Thanks!
