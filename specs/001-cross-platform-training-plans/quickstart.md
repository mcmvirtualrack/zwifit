# Quickstart & Validation Guide

Proves the feature end to end. Each scenario names the spec items it validates. Interfaces are in
[contracts/](contracts/); entity rules in [data-model.md](data-model.md).

## 0. Automated checks (any OS)

```bash
npm ci
npm test                 # Jest: unit + integration (simulated treadmill), coverage gates
npm run test:web         # Angular unit tests
npm run test:e2e         # Playwright: flows at 360/768/1280 px, light + dark
npm audit --audit-level=high
```

Expected: all pass; coverage ≥ 80 % for `src/core`, `src/security`, `src/storage` (constitution
II). CI repeats this on Ubuntu, macOS and Windows × Node 24/26 (SC-002).

## 1. Ubuntu on WSL — first deployment (Story 1, FR-001, FR-006a/b)

Prerequisites on Windows: WSL 2, `usbipd-win` (already installed on the owner's PC), a USB BLE
dongle, Ubuntu-24.04.

1. **Update WSL** (PowerShell, admin): `wsl --update`, then `wsl --shutdown`.
2. **Check Bluetooth in the kernel** (Ubuntu): `bash scripts/wsl/check-bluetooth.sh`
   - Expected today: reports `CONFIG_BT not set` and links to the README section
     "Build a Bluetooth-enabled WSL kernel". Follow it, set `kernel=` in `%USERPROFILE%\.wslconfig`,
     `wsl --shutdown`, and re-run until it reports `Bluetooth kernel support: OK`.
3. **Networking**: add `networkingMode=mirrored` under `[wsl2]` in `.wslconfig`; allow TCP 1337 in
   Windows Firewall (README gives the one-line command). `wsl --shutdown`.
4. **Attach the dongle** (PowerShell, admin the first time): `scripts\wsl\attach-bluetooth.ps1`
   - Expected: `hciconfig` / `bluetoothctl list` in Ubuntu shows `hci0`.
5. **Install Node 24 LTS** in Ubuntu (README: via nvm), then in the repo: `npm ci`.
6. **Grant Bluetooth capability without sudo**:
   `sudo setcap cap_net_raw,cap_net_admin+eip "$(readlink -f "$(which node)")"`.
7. **Start**: `npm start`.
   - Expected console: guided first-run setup (Story 1 / scenario 4), then
     `Pairing code: XXXX-XXXX` and `Control page: http://<windows-ip>:1337/`.
8. From a browser on Windows **and** a phone on the same Wi-Fi, open the URL, enter the code.
   - Expected: control page shows treadmill and Zwift broadcast status (FR-020).
9. In Zwift, pair the "Zwifit" device as a run speed sensor / treadmill.
   - Expected: speed and incline in Zwift follow the treadmill.

**Negative check (FR-006b)**: `usbipd detach --all` → within 5 s the control page says the
Bluetooth adapter is not attached and links to the re-attach instructions; app keeps running.

## 2. Simulated mode on macOS / Windows / Linux (FR-002, FR-005)

```bash
npm run start:sim
```

Expected: control page works with a simulated treadmill whose speed/incline follow commands and
whose heart rate varies; broadcast shows "unavailable (simulated)" unless an adapter exists.

## 3. Pairing security (FR-023a–e, SC-006)

| Step | Expected |
|------|----------|
| Open the page in a private window | Only the pairing screen; no stats visible; WebSocket rejected (`NOT_PAIRED`). |
| Enter a wrong code 5× | 6th attempt returns "Too many attempts, retry in 15 min". |
| Pair, then `DELETE` the device from Settings → Devices on another device | First device is disconnected immediately and sees the pairing screen. |
| Run `npm run pair` | New code printed; old code no longer works; existing pairings still work. |
| `grep -ri <device-cookie-value> <data-dir> logs` | No matches (only the hash is stored). |

## 4. Build a plan (Story 2, FR-007–FR-014, SC-003)

1. Plans → New: "Intervals 6×".
2. Add "Warm-up" 5 min at **10:00 min/mi**, 1 % → editor shows **6.0 mph** alongside.
3. Add block ×6: "Fast" 2 min 8.0 mph 1 %; "Recover" 1 min 5.0 mph 1 %.
4. Add "Cool-down" 0.5 mi at 4.0 mph 0 %.
5. Expected totals: 30:30 (5 + 18 + 7.5 min) and 3.1 mi (0.5 + 1.6 + 0.5 + 0.5); Save succeeds.
6. Edit Fast to 25 mph → Save refused, field highlighted `Above max speed (12 mph)`.
7. Restart the app → plan reloads identically, Warm-up still shows `10:00 min/mi`.
8. Export → re-import → a second identical plan with a new id. Import a file with
   `"targetKph": 99` → rejected with path `items[0].targetKph`.
9. With a legacy `routes.conf` present before first start → it appears as a plan, original file
   untouched.

## 5. Run a plan (Story 3, FR-015–FR-019, SC-004, SC-005)

Use `npm run start:sim` first, then a real treadmill at low speeds.

| Action | Expected |
|--------|----------|
| Start "Intervals 6×" with belt stopped | Plan waits: "Start the belt on your treadmill". |
| Start belt | Step 1 targets applied within 2 s; page shows current/next step and remaining. |
| Open a second browser | Shows the same running plan; its Start button is disabled. |
| Pause | Belt stops; step timer frozen. |
| Wait 30 s | Belt stays stopped (no auto-resume). |
| Resume | Belt restarts at the step's speed/incline; timer continues. |
| Manual +0.5 mph | Applied immediately; reverts to plan at the next step. |
| Skip | Next step's targets applied. |
| Let it finish | Belt goes to cool-down 2 mph / 0 %; plan "Completed"; belt keeps moving. |
| Restart and stop mid-step from the treadmill console | Plan ends "Stopped from treadmill"; no further commands logged. |
| Kill the treadmill connection mid-plan | Plan ends "Connection lost"; zero commands after that point (check log). |

## 6. History (Story 4, FR-019a–f)

After scenario 5: History lists each run with the correct end reason, step table shows target vs
actual and HR (or "not available"). Export CSV opens in a spreadsheet without cleanup and its
totals match the screen. Delete → gone from list and export URL returns 404.
Kill the app (`kill -9`) mid-plan, restart → workout present, ended "App restarted", samples up to
the crash.

## 7. UI checks (Story 5, FR-020–FR-022, SC-009)

Phone (360 px) / tablet / desktop, light and dark: all stats and controls visible without
horizontal scroll; Start/Pause/Stop targets ≥ 48 px; disconnect shows in ≤ 5 s.

## 8. Sensors (Story 6, FR-026–FR-032, SC-010, SC-011)

1. Attach the ANT+ stick (under WSL: `scripts/wsl/attach-bluetooth.ps1 -BusId <stick>`), start
   Zwifit: the log says "ANT+ stick ready". Without it, Settings → Sensors says why and it retries
   every 10 s.
2. Put on a strap (or turn on "Broadcast Heart Rate" on a Garmin watch) and wake the Stryd: within
   5 s the dashboard shows Heart rate, Cadence and Power tiles and lanes; the Settings cards mark
   them "In use" with their device numbers.
3. Settings → Sensors → Scan for sensors: within 15 s every sensor in range is listed per metric
   with an ANT+ or BLE badge. Press Use on one; restart Zwifit; the same one is used.
4. Source Bluetooth / Off: the value switches or disappears within 5 s. Power smoothing 10 s: the
   dashboard power changes slowly.
5. Disconnect the treadmill while wearing the strap: heart rate keeps showing (the treadmill's
   pulse is dropped).

## 9. Broadcast to Zwift (Story 7, FR-033, SC-012)

1. Switch on "Send heart rate", "Send cadence" and "Also broadcast it as a Bluetooth power meter",
   save, restart Zwifit.
2. In Zwift pair Zwifit as Run Speed, Heart Rate, Cadence and Power Source: each shows the
   sensor's value. Settings → Zwift broadcast lists the device with the services it reads.
3. Stop the Stryd: Zwift's power goes blank (Zwifit sends nothing, not zeros).

## 10. Training programs (Story 8, FR-035–FR-037, SC-013)

1. Programs → New program: goal Half marathon, race date 16 weeks out, 16 weeks, 4 run days, your
   easy speed. Preview shows 16 weeks with base, build, peak and taper phases, the long run on the
   last run day, every 4th week lighter and the race on race day.
2. Set the treadmill maximum below a generated speed (or use the simulated treadmill's limits):
   the preview lowers that speed to the maximum.
3. Save, open the program calendar and press Start on the first day: the run is saved once as a
   plan (pressing Start again does not make a second copy) and plays.
4. Finish the run: the day is marked done and the workout appears in History.
5. Delete the program: its plans and workouts stay.

## 11. Access and server (FR-023 additions, 2026-11-13)

1. Settings → Paired devices → New pairing code: a code shows; it pairs one device and stops
   working after 10 minutes.
2. Trust a device's address (or add a client by IP): that device opens Zwifit without a code.
3. Set `server.tls.port` with a certificate from `scripts/wsl/make-cert.sh`: Zwifit serves HTTPS on
   that port next to HTTP; after installing Zwifit's CA the browser offers "Install app".
4. Press Restart (top bar or Settings → Server) under `npm start`: Zwifit restarts and the page
   reconnects.
5. Settings → Console readout / Console output: set and measured speed and raw treadmill messages
   update live; pause, clear and copy work.

## Validation log

### 2026-11-01 — Windows 11 (owner's PC) + Ubuntu-24.04 on WSL 2

| Check | Result |
|-------|--------|
| §0 Jest (unit + integration) on Windows 11 and in Ubuntu-24.04 | 478 tests, 34 suites pass; coverage 92 % overall, gates (≥ 80 % core/security/storage) met; lint clean |
| §0 Angular unit tests, production build | pass; build has no inline styles/scripts (CSP `style-src 'self'`) |
| §0 Playwright, chromium + firefox + webkit × 360/768/1280 × light/dark | 162 runs pass (no horizontal scroll, controls ≥ 48 px, zero serious axe issues, pairing gate, disconnect ≤ 5 s, build/run/pause/resume/stop "Intervals 6×", history + CSV) |
| §0 `npm audit` | production deps: 0 vulnerabilities; dev tooling: 21 moderate / 3 low, none high |
| §1 WSL kernel 6.6.123.2 with BT + USB/IP built in, TP-Link UB500 (RTL8761BU) | `check-bluetooth.sh` OK; phone scanner sees the advertisement (research R2) |
| §1 Deploy to `~/zwifit` (`scripts/wsl/deploy.sh`), start | starts, prints `http://172.25.253.131:1337/`; Zwift broadcast `advertising: true` on the dongle |
| §1 Windows → WSL | `http://127.0.0.1:1337/` works; LAN address needs the Hyper-V firewall rule (scripts/wsl/README.md) — **owner to add** |
| §2 Simulated mode on native Windows 11 | dashboard, plans, workout and history work (screenshots taken); Windows Bluetooth also advertised |
| Real treadmill (NordicTrack C 990, Wi-Fi, iFit WebSocket 2.1, fw 3.4) | read-only: connects, reports speed/incline, limits 1–22 km/h, 0–12 % |
| **Pending (owner)** | control commands on the real C 990 with the safety key on; Zwift pairing (§1.9); phone over LAN; macOS run (T092) |

### 2026-11-02 — sensors, broadcast and redesign (Windows 11, simulated treadmill + fake sensors)

| Check | Result |
|-------|--------|
| §0 Jest | 551 tests pass (adds ANT+ scan, Bluetooth sensors, scan lease, hub, source modes, smoothing, sensors socket, power broadcast); lint clean |
| §0 Angular unit tests, production build | 19 pass; fonts bundled, no external requests |
| §0 Playwright chromium × 360/768/1280 × light/dark | 72 runs pass (incl. top-right navigation, 48 px controls, zero serious axe issues) |
| Screenshots against the mockups | dashboard, workout, plans, editor, history, history detail, settings, phone dashboard (no horizontal scroll) |
| Deploy to `~/zwifit` | done; native modules load |
| Note | After an update, restart Zwifit before saving settings from a refreshed page, or new fields (e.g. `ftmsPower`) are refused by the still-running old server |
| **Pending (owner)** | §8 with the real ANT+ stick, Stryd and strap; Bluetooth sensors; §9 in Zwift (T127) |

### 2026-11-14 — documentation sync (Windows 11, simulated treadmill)

| Check | Result |
|-------|--------|
| §0 Jest | 579 tests, 45 suites pass (adds programs, HTTPS port, restart, trusted address, console readout) |
| **Pending (owner)** | §1 timing and Zwift pairing (T053); macOS run (T092); §8–§9 with real sensors and Zwift (T127); §10 on the treadmill (T138) |
