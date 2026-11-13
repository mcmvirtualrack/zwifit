# Phase 0 Research: Cross-Platform Runtime, Refreshed UI & Training Plans

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-11-01

Facts marked **Observed** were checked on the owner's machine on 2026-11-01. Facts marked
**Verify** come from secondary sources and have a matching verification task in Phase 2.

## R1. Node.js runtime version

- **Decision**: Node.js 24 LTS as the minimum (`"engines": { "node": ">=24" }`); CI also runs
  Node.js 26 (the newest LTS line, Active LTS since late October 2026).
- **Rationale**: Node 24 is supported until April 2028 and is already installed on the Windows host
  (**Observed**: v24.21.0). Testing on 26 keeps the upgrade path open. The README's Node 8/13
  guidance is years past end-of-life and blocks every modern dependency.
- **Alternatives considered**: Node 22 (end-of-life April 2027, too short); Node 26 only (excludes
  distro/Pi users still on 24).

## R2. Bluetooth under Ubuntu on WSL (spec FR-006a)

- **Decision**: Use a USB Bluetooth LE dongle attached to WSL with `usbipd-win`, running on a WSL
  kernel that has Bluetooth built in. Steps:
  1. `wsl --update` to move from the 5.15 kernel to the current 6.6-based kernel.
  2. Check `zcat /proc/config.gz | grep -E 'CONFIG_BT=|CONFIG_BT_HCIBTUSB='`.
  3. If either is missing (expected), build the WSL kernel from Microsoft's `WSL2-Linux-Kernel`
     tag that matches step 1, with `CONFIG_BT=y`, `CONFIG_BT_LE=y`, `CONFIG_BT_HCIBTUSB=y` built in
     (custom kernels disable module loading, so options must be `=y`), and point `.wslconfig`
     `kernel=` at it.
  4. `usbipd bind` once and `usbipd attach --wsl` on each boot. Repeated attaches are scripted.
  Zwifit ships `scripts/wsl/` helpers for steps 2–4, and the README documents step 3.
- **Rationale**: **Observed**: WSL 2.3.26.0, kernel `5.15.167.4-microsoft-standard-WSL2`, and
  `# CONFIG_BT is not set`; no Bluetooth modules present; `usbipd-win` already installed. Community
  guides (Espressif CHIP Tool on WSL2; usbipd-win discussion #310) confirm that the stock kernel lacks
  Bluetooth and that a rebuilt kernel with `BT` + `BTUSB` works with a passed-through dongle.
- **Risks**: Some Intel combo adapters fail under passthrough ("Unsupported Intel hardware variant").
  The README recommends a plain USB BLE dongle (CSR8510 or Realtek RTL8761B class). This is the
  highest-risk item in the feature, so it is a P1 spike task done before any other WSL work.
- **Outcome (T007 spike, 2026-11-01): works.** A phone BLE scanner saw "Zwifit Test" advertising
  0x1826 and 0x1814 from Ubuntu-24.04 on WSL.
  - Dongle: TP-Link UB500 (Realtek RTL8761BU, USB 2357:0604), attached with `usbipd attach` at
    BUSID 2-6. The built-in Intel adapter was left on Windows.
  - Kernel: `linux-msft-wsl-6.6.123.2`, built by `scripts/wsl/build-bt-kernel.sh`.
  - Findings the original plan missed:
    1. The 6.6 WSL config builds `CONFIG_USB` and USB/IP (`USBIP_CORE`, `USBIP_VHCI_HCD`) as
       modules. They must be `=y` as well, or `BT_HCIBTUSB` can't be built in.
    2. WSL can't load firmware files at runtime, so the rtl8761b(u) firmware is built into the
       kernel with `CONFIG_EXTRA_FIRMWARE`.
    3. With the BlueZ service disabled, nothing powers the adapter on: bleno reports
       `poweredOff`. `scripts/wsl/99-zwifit-hci-up.rules` runs `hciconfig hci0 up` on each attach.
    4. bleno emits its first `stateChange` while the first listener is still being added, so
       callers must also check `bleno.state`. The `bleno` broadcast adapter (T029/T036) must do
       this.
    5. In WSL, run Node from a Linux-side `node_modules`. A Windows install in a `/mnt/c` checkout
       lacks `@stoprocent/bluetooth-hci-socket`. Deployment (T053) installs into a Linux path.
  - `.wslconfig` needs `kernel=C:\\WSL\\bzImage-bluetooth` on a line of its own. An inline
    comment becomes part of the path.
- **Alternatives considered**: Wi-Fi-only on WSL and simulation-only were rejected by the owner (spec
  Q1 = C). Running the Bluetooth part natively on Windows while the rest runs in WSL would mean two
  processes and was rejected for complexity.

## R3. WSL networking so phones can reach the control page

- **Decision**: Recommend WSL **mirrored networking** (`[wsl2] networkingMode=mirrored` in
  `%USERPROFILE%\.wslconfig`, Windows 11 22H2+) plus a Windows firewall rule for TCP 1337. Document
  NAT mode with `netsh interface portproxy` as a fallback.
- **Rationale**: In the default NAT mode, other devices on the network cannot reach WSL. Mirrored
  mode makes WSL share the host's LAN address, so a phone uses the Windows PC's IP.
  **Observed**: no `.wslconfig` exists yet.

## R4. Bluetooth libraries (Zwift broadcast and BLE treadmills)

- **Decision**: Move from `@abandonware/bleno`/`noble` 0.5/1.9 to the maintained
  `@stoprocent/bleno` and `@stoprocent/noble` forks, installed as **optionalDependencies** and
  loaded only inside the Bluetooth adapters. If loading fails, the adapter reports `unavailable`
  with a reason (FR-004) instead of crashing the app.
- **Rationale**: Upstream noble/bleno has been idle since 2021, and the abandonware forks are rated
  low-health. The stoprocent forks add multi-connection support, HCI UART and TypeScript types.
  **Verified 2026-11-01** (T008): `@stoprocent/bleno` 0.13.1 and `@stoprocent/noble` 2.8.0, both
  MIT, `os` includes darwin/linux/win32. Native code is N-API (`node-addon-api` +
  `node-gyp-build`), so prebuilds are Node-version independent; bleno ships prebuilds for
  linux-x64/arm/arm64, darwin-x64+arm64 and win32-x64/ia32. Installed on Node 24.21.0 / Windows.
- **Dependency clean-up found during T002**: `local-devices` pulled in `ip`/`get-ip-range` with high
  advisories, and `websocket` pulled in `es5-ext` plus two native add-ons. Both were removed: the
  treadmill network scan uses `os.networkInterfaces()`, and the Wi-Fi adapter uses Node's built-in
  `WebSocket` client. `npm audit --omit=dev` reports 0 vulnerabilities.
- **Constraint carried forward**: on Linux and Windows, using one adapter as both central (BLE
  treadmill) and peripheral (Zwift broadcast) is unsupported. BLE-treadmill users need two dongles;
  Wi-Fi-treadmill users need one. On Windows, the dongle needs the WinUSB driver (Zadig), as today.
- **Alternatives considered**: keep abandonware (unmaintained, no Node 24 guarantee); write
  per-OS native bindings (far too large).

## R5. Web server and real-time channel

- **Decision**: Express 5 for HTTP and Socket.IO 4 for live updates (upgrade from Express 4 and
  Socket.IO 2), with authentication applied to both the HTTP routes and the Socket.IO handshake.
- **Rationale**: Socket.IO 2 is long unsupported, and the 4.x line gives handshake middleware where
  device authentication and Origin checks happen. Keeping the same libraries also keeps the existing
  message model familiar.
- **Alternatives considered**: the plain `ws` package (rewrites the reconnect/rooms logic we use);
  Fastify (no benefit at this scale).

## R6. Device pairing and request security (FR-023a–e)

- **Decision**:
  - **Pairing code**: 8 characters from Crockford base32 (about 40 bits), created with
    `crypto.randomInt`. It is printed to the console on first run and by `npm run pair`
    (regenerate), and stays valid until regenerated.
  - **Device token**: 32 random bytes, stored only as a SHA-256 hash, and sent as cookie
    `zwifit_device` with `HttpOnly`, `SameSite=Strict`, `Path=/` (plus `Secure` when HTTPS is on).
    Expiry is 90 days of inactivity; every authorized request renews `lastSeen`.
  - **Rate limiting**: 5 failed codes per client IP in 15 minutes, then a 15-minute lockout, and a
    global cap of 30 failures per hour that suspends pairing until a new code is generated.
  - **Request checks**: on HTTP state-changing routes and on the Socket.IO handshake, the `Origin`
    must match the server's own host (stops cross-site WebSocket hijacking). JSON body limit 256 KB;
    import limit 1 MB.
  - **No secrets in the client**: pages never embed tokens, and logs pass through a redacting logger.
- **Rationale**: Meets the owner's choice (spec Q2 = A) with no password to type mid-run. A
  `SameSite=Strict` HttpOnly cookie plus an Origin check covers CSRF and token theft through XSS.
- **Transport**: HTTP is the default on the home network, because self-signed HTTPS shows certificate
  warnings on phones. Optional HTTPS with a user-supplied certificate/key is a setting. The remaining
  risk (sniffing on the LAN) is recorded in the threat model.

## R7. Storage location and format

- **Decision**:
  - **Data directory**: one per user, from a small `src/platform/paths.js`:
    - Linux: `$XDG_DATA_HOME/zwifit` (`~/.local/share/zwifit`)
    - macOS: `~/Library/Application Support/Zwifit`
    - Windows: `%APPDATA%\Zwifit`
    - `ZWIFIT_DATA_DIR` overrides all of these.
  - **Format**: plain JSON files, each written atomically (write a temporary file, `fsync`, then
    `rename`):
    - `settings.json`
    - `devices.json`
    - `plans/<id>.json`
    - `workouts/<id>.json` (summary and step results)
    - `workouts/<id>.samples.ndjson` (append-only, one line per second)
  - **Migration**: on first start of the new version, `settings.conf` and `routes.conf` in the
    repository root are imported and left in place (FR-014; existing settings keep working).
- **Rationale**: No native database dependency, so nothing extra to compile on Pi, macOS or Windows.
  Atomic rename keeps every file intact if the app crashes. The append-only sample file lets a
  workout survive a crash up to its last sample (FR-019e). Scale is small: a 3-hour workout is about
  10,800 lines (≈1 MB).
- **Alternatives considered**: SQLite (`node:sqlite` is not stable across our Node range, and
  `better-sqlite3` is a native build); keeping YAML in the repo directory (lost on reinstall, and
  the repo is not a user data location).
- **Note for feature 002**: per-second samples are already kept, so the Grafana feature can read
  them or reindex them into its own store.

## R8. Input validation

- **Decision**: JSON Schema (draft 2020-12) checked with **Ajv 8**. The same schemas validate
  WebSocket messages, HTTP bodies, plan imports and files loaded from disk. A second, semantic
  pass (`src/core/limits.js`) applies the treadmill limits.
- **Rationale**: One definition serves as both validation and documentation
  ([contracts/plan-file.schema.json](contracts/plan-file.schema.json)). Ajv is CommonJS-friendly
  and widely audited.

## R9. Safety limits and treadmill commands

- **Decision**:
  - **Effective limits**: min(settings limits, limits reported by the treadmill). Bluetooth
    treadmills report MaxKph/MaxIncline/MinIncline. Defaults are 0–20 km/h (0–12 mph) and 0–15%
    incline.
  - **Out-of-range commands are rejected**, not clamped. The current BLE code clamps to MaxKph;
    that behaviour is removed (constitution I).
  - **Pause/stop and resume**:
    - BLE: write `Mode=Pause` to pause and `Mode=Active` to resume, then speed and incline.
    - Wi-Fi: set the speed to 0 to pause. The Wi-Fi protocol's ability to restart the belt is
      unverified (**Verify on hardware**). Each adapter declares `capabilities.canResume`. If it is
      false, Resume tells the runner to press Start on the treadmill, and the plan continues once
      belt movement is detected.
  - **"Stopped from the treadmill" detection**: while running, a reported speed of 0 for at least 3
      seconds that Zwifit didn't request, or a BLE mode change to Pause/Idle, ends the plan with
      reason `treadmillStopped`.
  - **Command confirmation**: if the reported speed or incline hasn't reached the target within
      5 seconds of a step boundary, the command is resent once and the event is logged.

## R10. Web UI framework

- **Decision**: Rebuild the UI on the current Angular major (v22, released June 2026) using
  standalone components and signals, with plain SCSS and CSS custom properties for light/dark
  themes. The Bootstrap dependency is dropped. The new app replaces `src/api/web-src`, and the
  built output stays committed in `src/api/web-dist` so Raspberry Pi users never have to build it.
- **Rationale**: The existing UI is Angular 7, which doesn't build on Node 24. The jump from 7 to 22
  is too large to migrate, but the UI is only about 6 components, so a rewrite in the same framework
  matches the existing code and skills. Angular 22 starts the 24-month support cycle.
  **Verified 2026-11-01** (T008): `@angular/core` 22.2.4 / `@angular/cli` 22.2.5, engines
  `^22.22.3 || ^24.15.0 || >=26.0.0` (compatible with our Node range).
- **Alternatives considered**: step-by-step `ng update` from 7 to 22 (15 migrations, each needing
  the old Node); switching to a lighter framework (moves away from existing code for little gain).

## R11. Testing strategy

- **Decision**:
  - **Server**: Jest 30, with coverage thresholds of 80% lines/branches, enforced for
    `src/core/**`, `src/security/**` and `src/storage/**` in `jest.config.js`.
  - **Hardware**: tests use the simulated treadmill and a null broadcast adapter (constitution IV).
  - **Playback**: the playback engine is a pure state machine driven by an injected clock, tested
    with Jest fake timers.
  - **Security**: unauthenticated, wrong-Origin, rate-limit and malformed-input tests run against
    the real server on an ephemeral port using `socket.io-client`.
  - **Web**: Angular's default unit test runner for components; Playwright for end-to-end flows at
    360/768/1280 px widths in light and dark modes (SC-009).
- **CI**: GitHub Actions on `ubuntu-latest`, `macos-latest` and `windows-latest` × Node 24 and 26
  running `npm ci`, `npm test` and `npm audit --audit-level=high`. Playwright runs on Ubuntu (all
  three browsers) and smoke-tests on Windows and macOS. Bluetooth optional dependencies may fail to
  install in CI without failing the run.

## R12. Cross-platform scripts

- **Decision**: every developer task is an `npm` script that runs Node or a cross-platform CLI:
  `start`, `start:sim`, `test`, `build:web`, `pair`, `lint`. `buildWeb.sh` becomes a thin wrapper
  around `npm run build:web`. `raspberrypi.sh` stays a Pi-only wrapper (shutdown on disconnect), as
  the constitution allows. `scripts/wsl/*.sh` are WSL-only by nature and documented as such.

## R13. Export formats

- **Decision**:
  - **Plans**: JSON matching [contracts/plan-file.schema.json](contracts/plan-file.schema.json).
  - **Workouts**: a single UTF-8 CSV with a `record_type` column (`summary`, `step`, `sample`) and
    one shared header, specified in [contracts/workout-export-csv.md](contracts/workout-export-csv.md).
    Values are in the user's units, with ISO 8601 times.
  - **CSV injection guard**: cells starting with `=`, `+`, `-`, `@` are prefixed with `'`.
- **Rationale**: one file, no binary-format dependency, and it opens directly in Excel, Numbers,
  LibreOffice and Google Sheets.
- **Alternatives considered**: XLSX (adds a large dependency); three separate CSVs (spec asks for
  one file).

## R14. ANT+ sensors (heart rate, cadence, power)

- **Decision**: `ant-plus-next` 0.4.0 with a Garmin USB2/USB-m or USB3 stick; channels for the
  heart-rate, stride-based speed and distance (cadence) and bicycle power profiles (a Stryd sends
  running power as an ANT+ power meter and cadence as a footpod, with one device number). Wildcard
  pairing (device 0) unless the user picked a device. Scanning uses the library's scanners, which
  need every channel closed, so a scan releases the stick, scans 15 s and reopens it.
- **Rationale**: ANT+ leaves the single Bluetooth adapter free for the Zwift broadcast, works through
  usbipd under WSL, and most running sensors broadcast it.
- **Details**: the library's `close()` resets the USB device, which under usbip can leave the stick
  claimed by nobody; Zwifit releases the interface and closes the handle instead. Open and startup
  are bounded (10 s) so a half-claimed stick never blocks retries. Detaching several scanners
  confuses the library's channel count, hence the reopen.
- **Alternatives considered**: keeping all sensors on Bluetooth (one adapter for treadmill, Zwift and
  sensors is unreliable); a second process for ANT+ (more moving parts).

## R15. Bluetooth sensors and a shared scan

- **Decision**: `@stoprocent/noble` (already used for BLE treadmills), loaded only when a Bluetooth
  sensor is scanned for or remembered. Only sensors the user picked are connected. One reference-
  counted scan (`src/adapters/bleScanLease.js`) is shared with the BLE treadmill, scanning with
  duplicates so a sensor that drops out is seen again.
- **Rationale**: noble has a single scan: without the lease, the treadmill finding itself
  (`stopScanning`) would end a sensor search and vice versa.
- **Alternatives considered**: connecting to every heart-rate device in range (privacy, and it ties
  up sensors that belong to someone else).

## R16. Sending sensor data to Zwift

- **Decision**: over Bluetooth only: the merged heart rate in the Heart Rate service, the merged
  cadence in the RSC service, and running power optionally in the FTMS Treadmill Data (flag bit 12:
  force on belt 0 + power output; feature bit 14) and as a Cycling Power service (0x1818, the profile
  Stryd itself uses).
- **Rationale**: Zwift on Apple TV, iOS and Android only reads Bluetooth. Zwift running moves the
  avatar by speed, so power is shown, not used for movement.
- **Alternatives considered**: ANT+ transmit channels (power meter, SDM). Deferred: useful only to
  Zwift on a PC with its own ANT+ stick, and the stick would transmit and receive at once.

## R17. Visual design and fonts

- **Decision**: the approved mockups (Design canvas): dark palette (`--bg #080b10`, cards
  `#0e141b`, accent `#3ee6b5`, heart rate `#ff6b8b`, cadence `#f5b14c`, power `#b99bff`, incline
  `#8fb4ff`), Inter and JetBrains Mono from `@fontsource` bundled into the build, top-right
  segmented navigation, Grafana-style thin lines on a dashed grid. Light theme kept as an option.
- **Rationale**: the Content-Security-Policy (`default-src 'self'`) forbids Google Fonts, and the app
  must work offline next to the treadmill.
- **Live data in the browser**: a per-tab 1 s history (3 h, session storage) feeds the live chart,
  sparklines, incline graph and zone times; workouts keep their own samples on the server.

## R18. Training programs

- **Decision**: generate programs on the server from goal, race date, weeks, run days and an easy
  speed; phases base (≈35 %), build (to ≈80 %), peak, taper (1–3 weeks by goal); every 4th week
  before the taper at 75 % volume; the long run on the last run day. Speeds are fixed multiples of
  the easy speed (recovery 0.85, long 0.97, tempo 1.2, intervals 1.33, race pace 1.12–1.33 by
  goal), hills at +4 % incline, all clamped to the treadmill's limits. A day becomes a plan only
  when started, so the plans list doesn't fill with 60+ entries.
- **Rationale**: a speed the runner already knows is a reliable anchor on a treadmill; the
  structure follows common periodised plans.
- **Alternatives considered**: syncing plans from Garmin Connect / TrainingPeaks / intervals.icu
  (deferred by the owner); creating every day's plan up front (clutters Plans).

## Sources

- [usbipd-win: How to make a USB Bluetooth adapter work with WSL (#310)](https://www.github.com/dorssel/usbipd-win/discussions/310)
- [Espressif: Working with the CHIP Tool in WSL2 (Bluetooth kernel rebuild)](https://docs.espressif.com/projects/esp-matter/en/latest/esp32/using_chip_tool.html)
- [WSL2 kernel 6.6 switch notes](https://softantenna.com/blog/wsl2-linux-6-6/)
- [@stoprocent/bleno on npm](https://npmjs.com/package/%40stoprocent%2Fbleno)
- [@stoprocent/noble (Yarn)](https://classic.yarnpkg.com/en/package/@stoprocent/noble)
- [Node.js release changes (InfoQ, 2026)](https://infoq.com/news/2026/06/nodejs-release-changes)
- [Angular version history and support windows](https://herodevs.com/blog-posts/angular-version-history-every-release-date-support-window-and-end-of-life-date-from-angularjs-to-angular-22)
- [Angular yearly release cycle](https://angularindepth.com/article/angular-new-release-cycle-release-schedule-change-explained/)
