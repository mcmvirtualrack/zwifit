# Implementation Plan: Cross-Platform Runtime, Refreshed UI & Training Plans

**Branch**: `001-cross-platform-training-plans` | **Date**: 2026-11-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-cross-platform-training-plans/spec.md`

## Summary

Modernise Zwifit so the same code installs, runs and is tested on Linux (first target: Ubuntu
24.04 on WSL with a passed-through USB Bluetooth dongle), macOS and Windows; add training plans
(speed-or-pace, incline, time-or-distance steps, repeat blocks) with safe server-side playback,
workout history with heart rate and CSV export; and rebuild the web UI to be responsive, dark-mode
aware and gated by one-time device pairing.

Technical approach (details in [research.md](research.md)): upgrade to Node 24 LTS, Express 5,
Socket.IO 4 and maintained BLE forks loaded as optional dependencies; move all hardware access
behind treadmill/broadcast adapters with a simulated implementation; implement a pure,
clock-injected playback state machine in `src/core`; store settings, plans, devices and workouts as
atomically-written JSON/NDJSON in a per-OS data directory; validate every input with JSON Schema +
limit checks; and replace the Angular 7 UI with an Angular 22 standalone-component app.

**Additions (2026-11-02)**: heart rate, cadence and running power from ANT+ (USB stick) and
Bluetooth sensors with per-metric source choice and sensor picking; sensor heart rate, cadence and
power re-broadcast to Zwift over Bluetooth (Heart Rate, RSC, FTMS power, Cycling Power); FIT export;
and a redesign of every screen to the approved mockups (dark, Inter / JetBrains Mono, top-right
navigation, live multi-lane charts). See spec User Stories 6–7, research R14–R17 and tasks Phase 9.

**Additions (2026-11-08 – 2026-11-13)**: multi-week training programs generated from a goal, race
date, weeks, run days and easy speed (spec User Story 8, FR-035–FR-037, research R18); HTTPS on an
extra port with Zwifit's own CA; pairing code shown to paired devices; per-device trusted address
and add-by-IP; restart from the UI (`npm start` supervises the server); a live treadmill console
readout; installable web app; and resilience fixes (ANT+ channel reopen, start without a Bluetooth
adapter). See tasks Phase 10.

## Technical Context

**Language/Version**: JavaScript (CommonJS) on Node.js ≥ 24 LTS for the server; TypeScript 5.x for the web UI.

**Primary Dependencies**: express 5, socket.io 4 (+ socket.io-client in UI/tests), ajv 8 (+ ajv-formats), js-yaml 4 (legacy settings migration only), websocket (iFit Wi-Fi), `@stoprocent/bleno` / `@stoprocent/noble` (optional), Angular 22.

**Storage**: JSON and NDJSON files in the per-OS data directory, written atomically (research R7). No database.

**Testing**: Jest 30 (server unit + integration with simulated treadmill and fake timers), Angular default unit runner, Playwright (e2e/responsive), `npm audit`.

**Target Platform**: Ubuntu 24.04 on WSL 2 (first), other Linux incl. Raspberry Pi OS (arm64/armv7), macOS 14+, Windows 11. Browsers: current Chrome/Edge/Firefox/Safari incl. mobile.

**Project Type**: Single Node.js application serving a bundled web SPA, with hardware adapters.

**Performance Goals**: step targets applied ≤ 2 s after boundary (SC-004); status pushed to clients at 1 Hz, broadcast to Zwift at 5 Hz unchanged; samples recorded at 1 Hz.

**Constraints**: zero commands after stop/disconnect (SC-005); no native build required for core features (Bluetooth modules optional); runs on Raspberry Pi 3B+ (≤ 150 MB RSS target); offline/LAN-only.

**Scale/Scope**: 1 household, ≤ 10 paired devices, ≤ 500 plans × ≤ 200 items, workouts up to 6 h (≈ 21,600 samples each); ~10 UI screens (pairing, dashboard/control, plans list, plan editor, playback, history list + detail, programs list + calendar, settings incl. devices, sensors, Zwift broadcast and console).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design (below).*

| Principle | Gate | Pre-research | Post-design |
|-----------|------|--------------|-------------|
| **I. Security First** | All external input validated | ✅ planned | ✅ JSON Schemas for every socket event, HTTP body, import and on-disk file ([contracts/api.md](contracts/api.md), [plan-file.schema.json](contracts/plan-file.schema.json)) |
| | Speed/incline bounds-checked, rejected not clamped | ✅ | ✅ `src/core/limits.js`; adapters reject; existing BLE clamping removed (R9) |
| | Control endpoints need auth or explicit opt-in; narrowest bind | ✅ pairing (FR-023) | ⚠️ bind `0.0.0.0` by default — justified in Complexity Tracking; all data/control behind pairing; `server.host` setting to restrict |
| | No committed/logged secrets | ✅ | ✅ token hashes only, redacting logger, code printed to console only |
| | Least privilege, no runtime sudo | ✅ | ✅ `setcap` on node binary documented; `raspberrypi.sh` poweroff stays in root cron wrapper only |
| | No eval / shell from input | ✅ | ✅ none in design; lint rule `no-eval`, `no-new-func`, ban `child_process` in `src/` except allow-listed WSL check script |
| | `npm audit` clean | ✅ | ✅ CI gate; dependency upgrades remove known-vulnerable socket.io 2 / express 4 / js-yaml 3 |
| | Threat model in plan | ✅ | ✅ see below |
| **II. Test-First** | Tests first, edge + security cases, regression tests | ✅ | ✅ tasks ordered test→impl; security test list in quickstart §3 |
| | ≥ 80 % coverage on changed modules | ✅ | ✅ Jest thresholds per directory (R11) |
| | Hardware-free, deterministic tests | ✅ | ✅ simulated adapter + injected clock |
| | Tests pass on macOS/Linux/Windows | ✅ | ✅ CI matrix 3 OS × Node 24/26 |
| **III. Portability** | Works on all 3 OS or justified exception | ✅ | ✅ core is pure JS; BLE optional with clear status. WSL/Pi helper scripts are OS-specific by nature (Complexity Tracking) |
| | `path`/`os` APIs only | ✅ | ✅ `src/platform/paths.js`; lint bans string path concatenation with `/` in `src/` |
| | npm/Node entry points | ✅ | ✅ R12 |
| | Native deps optional/fallback | ✅ | ✅ R4 |
| | Node version in `engines` + README | ✅ | ✅ R1 |
| **IV. Isolation** | Hardware behind interfaces with test doubles | ✅ | ✅ [contracts/adapters.md](contracts/adapters.md) |

**Result**: PASS (one justified deviation).

### Threat model

| Asset | Entry point | Threat | Mitigation |
|-------|-------------|--------|------------|
| Runner's physical safety | `control:set`, `playback:*` | Unpaired LAN device or malicious web page drives the belt | Pairing cookie required; `SameSite=Strict`; Origin check on handshake; limits rejected; pause never auto-resumes; stop on disconnect |
| Runner's physical safety | Plan import / file on disk | Crafted plan with extreme values | Schema + limit validation on import, load and again at playback start |
| Runner's physical safety | Treadmill state | App sends commands after user stops treadmill | Engine emits nothing after `ended`; treadmill-stopped detection (R9) |
| Health data (HR, workouts) | `workouts:*`, CSV export | Read by unpaired device / exfiltrated | Pairing required; never logged; CSV injection guard |
| Device tokens | Cookie, `devices.json` | Theft via XSS or file read | HttpOnly cookie; strict CSP, no inline script; SHA-256 at rest; 90-day idle expiry; revoke |
| Pairing code | `POST /api/pair` | Brute force | 40-bit code, per-IP + global rate limits, code rotation |
| Settings | `settings:write` | Overwriting arbitrary keys (legacy `fromJSON`) | Allow-listed fields, schema-validated |
| Host system | File paths in settings (TLS cert) | Path traversal / reading arbitrary files | TLS paths are not writable over the network at all (only by editing `settings.json` on the host); contents never echoed |
| Pairing, belt control | Browser on the LAN visiting a hostile site | DNS rebinding makes the hostile name "same origin", then guesses codes or trips the pairing lockout | `Host` header must be an IP, `localhost`, this computer's name (`.local`/`.lan`/`.home`) or `ZWIFIT_ALLOWED_HOSTS`; checked on HTTP and before any Socket.IO transport opens (found in the T088 review) |
| LAN traffic | HTTP | Cookie sniffed on shared Wi-Fi | **Residual risk**: documented; optional HTTPS with user cert; `Secure` cookie when HTTPS |
| Supply chain | npm deps | Vulnerable/malicious package | Lockfile, `npm ci`, `npm audit` gate, minimal new deps (ajv, express, socket.io, BLE forks) |

## Project Structure

### Documentation (this feature)

```text
specs/001-cross-platform-training-plans/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── api.md
│   ├── adapters.md
│   ├── plan-file.schema.json
│   └── workout-export-csv.md
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
app.js                         # supervisor: runs src/app.js, restarts it on `server:restart`
src/
├── app.js                     # wires modules and starts the server
├── core/                      # pure, platform-neutral, ≥80% coverage
│   ├── units.js               # kph⇄mph, speed⇄pace, metres⇄mi/km
│   ├── limits.js              # effective limits, range checks (reject)
│   ├── session.js             # current treadmill/session state
│   ├── sensorMerge.js         # per-metric source choice, smoothing
│   ├── plans/{validate,expand,totals,migrateRoutes,demo}.js
│   ├── playback/engine.js     # state machine (data-model), injected clock & adapter
│   ├── programs/generate.js   # goal → weeks of plans (US8)
│   └── history/{recorder,summarize,csv,fit}.js
├── adapters/
│   ├── treadmill/{index,wifi,ble,simulated,scan}.js
│   ├── broadcast/{index,bleno,null,services}.js  # RSC, HR, FTMS power, Cycling Power
│   ├── sensors/{hub,ant,ble,reading}.js          # ANT+ and Bluetooth HR/cadence/power
│   └── bleScanLease.js        # one shared Bluetooth scan
├── security/{pairing,rateLimit,httpGuards}.js
├── storage/
│   ├── atomicFile.js
│   ├── settingsRepo.js        # incl. settings.conf v1 → v2 migration
│   ├── {plans,workouts,programs,devices,zwiftDevices}Repo.js
├── contracts/{index.js,schemas/*.json}   # ajv schemas (socket events, bodies, plan file)
├── api/
│   ├── server.js              # express + socket.io wiring, HTTP + optional HTTPS port
│   ├── http/{pairing,plans,workouts}.js
│   ├── socket/{control,status,settings,plans,playback,programs,workouts,sensors,zwiftDevices}.js
│   ├── web-src/               # Angular 22 app: shell, pairing, control, plans, playback,
│   │                          #   history, programs, settings, shared charts/tiles
│   └── web-dist/              # committed build output (scripts/build-web.js)
├── platform/{paths,clock}.js
├── lib/{log,errors,ids,deviceName,utils,convertBase}.js   # log.js = redacting logger
├── cli/{pair,setup}.js        # `npm run pair`; first-run setup
├── ble/{enable.js,ifit/_constants.js,ifit/_request.js}    # used by adapters/treadmill/ble.js
├── bluetooth/{rsc,treadmill}/calculator.js               # used by adapters/broadcast
└── settings.js                # legacy settings shim used by ble/enable.js

test/
├── unit/{core,security,storage,adapters,api,cli,contracts,lib,platform}/
├── integration/               # server on ephemeral port + simulated treadmill
├── fixtures/                  # legacy conf files, valid/malicious plans, test TLS cert
└── ble/ifit/                  # existing tests kept
e2e/                           # Playwright: flows.spec.ts, responsive.spec.ts
scripts/
├── build-web.js, find-treadmill.js, watch-treadmill.js, find-ant-sensors.js
└── wsl/                       # check/build Bluetooth kernel, usbipd attach, udev rules,
                               #   deploy, install-node, make-cert (Zwifit CA), README
.github/workflows/ci.yml       # 3 OS × Node 24/26
```

**Structure Decision**: single Node project, keeping the existing `src/` + `test/` layout and the
`src/api/web-src` → `src/api/web-dist` UI arrangement. New `core/`, `adapters/`, `security/`,
`storage/`, `platform/` directories implement constitution Principle IV. Legacy modules
(`src/ifit.js`, `src/bluetooth/`, `src/ble/ifit/`, `src/settings.js`, `src/routes.js`,
`src/oneTimeSetup.js`) are moved into adapters/storage/cli rather than duplicated; existing tests
under `test/ble` keep passing throughout.

### Delivery order (maps to spec priorities)

1. **Spike (P1 risk)**: WSL Bluetooth kernel + usbipd + bleno advertising seen by a phone/Zwift.
2. **P1** Platform: Node 24 upgrade, adapters + simulated mode, data dir + migration, pairing,
   new server API, CI matrix, README per OS. Minimal UI port (pairing + control + settings).
3. **P2** Plans: core plans/units/limits, repos, editor UI, import/export, routes migration.
4. **P3** Playback engine + UI.
5. **P4** Recorder, history UI, CSV export.
6. **P5** UI polish: responsive layout, dark mode, accessibility pass, Playwright gates.
7. **P6–P7** (added 2026-11-02) Sensors and re-broadcast to Zwift; redesign.
8. **P8** (added 2026-11-13) Training programs; HTTPS port, trusted devices, restart, console.

### Status (2026-11-14)

All implementation tasks are done (tasks.md Phases 1–10). Open items are owner checks on real
hardware: T053 (WSL deploy timing, Zwift pairing), T092 (native macOS run), T127 (ANT+/Stryd/
strap/Zwift) and T138 (run a program day on the treadmill).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Server binds `0.0.0.0` by default (constitution I: "narrowest practical bind address") | Primary use is a phone/tablet next to the treadmill; Zwifit often runs on a headless Pi | Loopback-only default would break every existing user's setup; pairing + Origin checks gate all data and control, and `server.host=127.0.0.1` is one setting away |
| OS-specific scripts `scripts/wsl/*`, `raspberrypi.sh` (constitution III) | Kernel/USB passthrough and Pi poweroff are inherently OS-specific | No cross-platform equivalent exists; app itself remains portable and these are optional helpers |
| HTTP (not HTTPS) by default on LAN | Self-signed HTTPS shows certificate errors on phones, defeating easy pairing | Mandatory HTTPS would require users to manage certificates; optional HTTPS provided; residual risk documented |
