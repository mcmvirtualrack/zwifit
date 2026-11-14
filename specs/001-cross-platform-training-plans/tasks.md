---

description: "Task list for Cross-Platform Runtime, Refreshed UI & Training Plans"
---

# Tasks: Cross-Platform Runtime, Refreshed UI & Training Plans

**Input**: Design documents from `specs/001-cross-platform-training-plans/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: REQUIRED. Constitution Principle II (NON-NEGOTIABLE) mandates test-first: every test
task below MUST be written and seen failing before its implementation tasks start.

**Organization**: Grouped by user story (spec priorities P1–P5) so each story is an independently
testable increment. Phases 9–10 hold work added later (User Stories 6–8 and owner requests).

**Status (2026-11-14)**: 121 of 125 tasks done. Open: T053, T092, T127, T138 — all owner checks on
real hardware or another OS; no implementation work remains.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1–US5 = spec User Stories 1–5
- Paths are relative to the repository root. Code style: CommonJS, tabs, matching existing `src/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Toolchain upgrade, directory layout, CI, and de-risking spikes

- [X] T001 Create the directory skeleton from plan.md: `src/core/plans/`, `src/core/playback/`, `src/core/history/`, `src/adapters/treadmill/`, `src/adapters/broadcast/`, `src/security/`, `src/storage/`, `src/contracts/schemas/`, `src/platform/`, `src/cli/`, `src/api/http/`, `src/api/socket/`, `test/unit/{core,security,storage,adapters,platform,lib,cli,contracts}/`, `test/integration/helpers/`, `test/fixtures/`, `e2e/`, `scripts/wsl/` (add `.gitkeep` where empty)
- [X] T002 Update package.json: `"engines": { "node": ">=24" }`; dependencies `express@^5`, `socket.io@^4`, `ajv@^8`, `ajv-formats@^3`, `js-yaml@^4`, keep `websocket`, `async`, `death`, `local-devices`; move Bluetooth to `optionalDependencies` as `@stoprocent/bleno` and `@stoprocent/noble` (remove `bleno`, `noble`, `bluetooth-hci-socket` aliases, `xpc-connection` and the `resolutions` block); devDependencies `jest@^30`, `rewire`, `socket.io-client@^4`, `@playwright/test`, `@axe-core/playwright`, `eslint@^9`; scripts `start` (`node app.js`), `start:sim` (`node app.js --simulate`), `test` (`jest`), `test:web`, `test:e2e` (`playwright test`), `build:web`, `pair` (`node src/cli/pair.js`), `lint` (`eslint .`), keep `enable-ble`; remove the inline `jest` block; regenerate package-lock.json with `npm install`
- [X] T003 [P] Create jest.config.js: `roots: ['<rootDir>/test']`, `testEnvironment: 'node'`, keep `modulePaths: ['<rootDir>/src']`, ignore `/node_modules/`, `/e2e/`, `/src/api/web-src/`; `collectCoverageFrom: ['src/**/*.js', '!src/api/web-src/**', '!src/api/web-dist/**']`; `coverageThreshold` of 80 % lines and branches for `./src/core/`, `./src/security/`, `./src/storage/`
- [X] T004 [P] Create eslint.config.js (flat config): tabs, `no-eval`, `no-new-func`, `no-implied-eval`, `no-restricted-modules`/`no-restricted-imports` banning `child_process` under `src/`, `no-restricted-syntax` banning string concatenation of path segments with `'/'` or `'\\'` under `src/` (use `path.join`); ignore `src/api/web-dist/**`, `src/api/web-src/**`, `coverage/**`
- [X] T005 [P] Create .github/workflows/ci.yml: matrix `os: [ubuntu-latest, macos-latest, windows-latest]` × `node: [24, 26]`; steps `npm ci` (optional Bluetooth deps allowed to fail), `npm run lint`, `npm test -- --coverage`, `npm audit --audit-level=high`; separate job on ubuntu running `npm run build:web`, `npm run test:web`, `npx playwright install --with-deps` and `npm run test:e2e`; fail if `git diff --exit-code src/api/web-dist` shows the committed build is stale
- [X] T006 [P] Update .gitignore: add `coverage/`, `playwright-report/`, `test-results/`, `.zwifit-data/`, `*.tmp`
- [X] T007 **Spike (highest risk, research R2)**: on the owner's PC run `wsl --update`; create scripts/wsl/check-bluetooth.sh (prints kernel version; checks `CONFIG_BT`, `CONFIG_BT_LE`, `CONFIG_BT_HCIBTUSB` via `/proc/config.gz`; checks `hci0` with `bluetoothctl list`; prints actionable next step for each failure; exit code 0 only when all pass); create scripts/wsl/attach-bluetooth.ps1 (lists devices via `usbipd list`, accepts `-BusId`, runs `usbipd bind` if not shared, then `usbipd attach --wsl --busid`; idempotent; no hard-coded bus id); create scripts/wsl/README.md with the custom-kernel build steps (clone `microsoft/WSL2-Linux-Kernel` at the tag matching `uname -r`, set `CONFIG_BT=y`, `CONFIG_BT_LE=y`, `CONFIG_BT_HCIBTUSB=y` built-in, build, copy `bzImage` to Windows, set `kernel=` in `%USERPROFILE%\.wslconfig`, `wsl --shutdown`); prove a minimal bleno advertisement from Ubuntu-24.04 is visible on a phone BLE scanner; record outcome, kernel tag and dongle model in research.md R2
- [X] T008 [P] Verify research items and record results in research.md: `@stoprocent/bleno` and `@stoprocent/noble` install with prebuilt binaries on Node 24 for linux-x64, linux-arm64, darwin-arm64, win32-x64 (note licence); current Angular major for scaffolding (R10)

**Checkpoint**: toolchain installs on Node 24; CI runs (existing `test/ble` suite green); WSL Bluetooth path proven or blocker escalated

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Platform services, storage, validation, adapters interfaces, pairing security and
the server skeleton that every story uses

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests for Foundational (write first, must fail) ⚠️

- [X] T009 [P] Unit test test/unit/platform/paths.test.js: with mocked `process.platform` and env, `dataDir()` returns `$XDG_DATA_HOME/zwifit` or `~/.local/share/zwifit` (linux), `~/Library/Application Support/Zwifit` (darwin), `%APPDATA%\Zwifit` (win32); `ZWIFIT_DATA_DIR` overrides all; directory created with mode 0700 on POSIX; `legacyDir()` is the repo root
- [X] T010 [P] Unit test test/unit/storage/atomicFile.test.js: `writeJson` writes temp file + fsync + rename; a failure before rename leaves the previous file intact and no temp file behind; concurrent writes to one path are serialized; `readJson` of a corrupt file throws a typed `CorruptFileError` without leaking the absolute path in `message`
- [X] T011 [P] Unit test test/unit/lib/log.test.js: redacting logger masks values of keys `token`, `code`, `cookie`, `tokenHash`, `codeHash`, `hr`, `samples` at any depth, masks `zwifit_device=` cookie strings in messages, and `safeError(err)` returns `{ code, message }` with no stack or file paths
- [X] T012 [P] Unit test test/unit/core/units.test.js: kph⇄mph with factor 1.609344; pace `"10:00"` min/mi ⇄ 9.656 km/h (±0.01); pace `"6:00"` min/km ⇄ 10 km/h; `"0:00"`, `"1:60"`, `"abc"` rejected; speed 0 → pace `null`; metres⇄miles/km; round-trip of `entered` to `targetKph` "within 0.05 km/h"
- [X] T013 [P] Unit test test/unit/core/limits.test.js: effective limits = intersection of settings and treadmill-reported limits; defaults `minKph 0 / maxKph 20`, `minIncline 0 / maxIncline 15`; `checkTarget` returns `ABOVE_MAX_SPEED`, `BELOW_MIN_SPEED`, `ABOVE_MAX_INCLINE`, `BELOW_MIN_INCLINE`, `NOT_A_NUMBER` and never returns a clamped value
- [X] T014 [P] Unit test test/unit/contracts/schemas.test.js: every schema in `src/contracts/schemas/` compiles under Ajv 2020; fixtures test/fixtures/plans/valid-intervals.json passes and test/fixtures/plans/invalid-*.json (unknown property, `repeat: 100`, nested block, `seconds: 0`, `targetIncline: 0.3`, name with control char, 201 items) each fail with the expected JSON path
- [X] T015 [P] Unit test test/unit/storage/settingsRepo.test.js: migrates fixture test/fixtures/legacy/settings.conf (YAML v1) to `settings.json` v2 (`ble:true` → `treadmill.transport:'ble'`, `ip`, `lastIP`, `bleCode`, `bleActivation`, `bleDetails`, `broadcastFTMS`/`broadcastRSC` → `broadcast.ftms`/`rsc`, `speedOffset`, `speedMultiplier`, `metric`) and leaves the legacy file untouched; rejects `speedMultiplier` outside 0.5–1.5, `speedOffset` outside −2…+2, `limits` not satisfying "`0 ≤ min < max ≤ 30`" (speed) and "`-10 ≤ min < max ≤ 40`" (incline), `cooldownKph` not within limits or ≤ 0, `server.port` outside 1024–65535, `bleCode` not "exactly 4 hex chars", `treadmill.ip` with scheme or path, `server.tls` with only one of cert/key
- [X] T016 [P] Unit test test/unit/storage/devicesRepo.test.js: stores only `tokenHash` (SHA-256 hex); `name` "1–40 chars"; `expiresAt = lastSeenAt + 90 days`; expired entries pruned on load; `lastSeenAt` written "at most once per minute"
- [X] T017 [P] Unit test test/unit/security/pairing.test.js: code is 8 chars of Crockford base32 from `crypto.randomInt`; `verifyCode` constant-time; pairing returns a 32-byte random token whose hash is stored; `authenticate(token)` renews expiry and rejects expired/revoked tokens; `regenerateCode` invalidates the old code but keeps existing pairings; the code is never returned by any API function except to the console printer
- [X] T018 [P] Unit test test/unit/security/rateLimit.test.js: 5 failures per IP within 15 min → locked for 15 min with `retryAfterSeconds`; 30 global failures per hour → pairing suspended until `regenerateCode`; successes don't reset other IPs; uses injected clock
- [X] T019 [P] Unit test test/unit/security/httpGuards.test.js: Origin must equal server scheme+host+port (falls back to `Referer`; missing both → reject for non-GET); security headers exactly as contracts/api.md "Headers" row; `/api/*` gets `Cache-Control: no-store`; body limit 256 KB → 413
- [X] T020 [P] Shared adapter contract suite test/unit/adapters/treadmillContract.js (exported function taking an adapter factory) asserting contracts/adapters.md: `start()` never throws for missing hardware, emits `status` with km/h, `hr` null when absent or 0, `setTarget` rejects (not clamps) out-of-range, `resumeBelt` rejects `RESUME_UNSUPPORTED` when `!capabilities.canResume`, `stop()` clears timers; plus test/unit/adapters/simulated.test.js running it against the simulated adapter with Jest fake timers
- [X] T021 [P] Integration test test/integration/pairing.test.js using helper test/integration/helpers/server.js (starts server on port 0 with temp `ZWIFIT_DATA_DIR`, simulated adapter, null broadcast; exposes `pairedClient()` and `anonClient()`): unpaired `GET /api/session` → `{ paired:false }`; unpaired Socket.IO connect → `connect_error` `NOT_PAIRED`; wrong Origin → `BAD_ORIGIN`; `POST /api/pair` wrong code → 401 `BAD_CODE`, 6th try → 429; correct code → 204 with cookie `HttpOnly; SameSite=Strict; Path=/; Max-Age=7776000`; `DELETE /api/devices/:id` disconnects that device's sockets immediately; `POST /api/pairing-code` from non-loopback → 403; `:id` not matching `^[0-9A-HJKMNP-TV-Z]{26}$` → 400; error bodies contain no stack, path or token

### Implementation for Foundational

- [X] T022 [P] Implement src/platform/paths.js (`dataDir()`, `legacyDir()`) and src/platform/clock.js (`now()`, `setTimeout`/`setInterval` wrappers injectable for tests) to pass T009
- [X] T023 [P] Implement src/storage/atomicFile.js (`writeJson`, `readJson`, `appendLine`, per-path write queue, `CorruptFileError`) to pass T010
- [X] T024 [P] Implement src/lib/log.js redacting logger (`info`, `warn`, `error`, `safeError`) to pass T011; replace `console.*` in new code with it
- [X] T025 [P] Implement src/core/units.js to pass T012
- [X] T026 [P] Implement src/core/limits.js to pass T013
- [X] T027 Copy contracts/plan-file.schema.json to src/contracts/schemas/plan-file.schema.json and add src/contracts/schemas/settings.schema.json, pair-body.schema.json, and one schema per Socket.IO client event in contracts/api.md (`control-set`, `settings-write`, `plans-get`, `plans-save`, `plans-duplicate`, `plans-delete`, `playback-start`, `workouts-list`, `workouts-get`, `workouts-samples`, `workouts-delete`), all `additionalProperties: false`; implement src/contracts/index.js (Ajv 2020 + ajv-formats, compiled once, `validate(name, data)` → `[{ path, code, message }]`) to pass T014
- [X] T028 Implement src/storage/settingsRepo.js (load/migrate/validate/save `settings.json` v2 per data-model.md "Settings", allow-listed `update(partial)` that refuses `bleActivation`/`bleDetails`/`bleServices`/`bleAdvertisingData`/`bleScanData` writes from the API) and turn src/settings.js into a thin compatibility shim over it, to pass T015
- [X] T029 [P] Implement src/storage/devicesRepo.js to pass T016
- [X] T030 Implement src/security/pairing.js and src/security/rateLimit.js (depends on T029) to pass T017–T018
- [X] T031 [P] Implement src/security/httpGuards.js (Express middleware: origin check, security headers, `express.json({ limit: '256kb' })`, id-param validator) to pass T019
- [X] T032 Implement src/adapters/treadmill/simulated.js (deterministic: follows `setTarget` with a ramp, `pauseBelt` → 0, `resumeBelt` supported, HR follows speed, test hooks `simulateDisconnect()`, `simulateConsoleStop()`, `setReportsCurrentSpeed(false)`) and src/adapters/treadmill/index.js factory (`create(settings, { simulate })`), plus src/adapters/broadcast/null.js and src/adapters/broadcast/index.js factory, to pass T020
- [X] T033 Implement src/api/server.js (Express 5 + Socket.IO 4; static `web-dist`; httpGuards; Socket.IO `allowRequest`/middleware enforcing pairing cookie + Origin; per-socket limit 20 commands/s; unknown events dropped and logged by name only; `ack` envelope `{ ok, data?, error?, details? }`) and src/api/http/pairing.js (`GET /api/session`, `POST /api/pair`, `POST /api/unpair`, `GET /api/devices`, `DELETE /api/devices/:id`, `POST /api/pairing-code` loopback-only) to pass T021
- [X] T034 Implement src/cli/pair.js (`npm run pair`): regenerates the code, prints `Pairing code: XXXX-XXXX` to stdout only, works whether or not the app is running (writes `codeHash` via devicesRepo)

**Checkpoint**: `npm test` green on all three OS in CI; server starts with simulated treadmill; pairing works end to end via tests

---

## Phase 3: User Story 1 - Install and run on any desktop OS, starting with Ubuntu on WSL (Priority: P1) 🎯 MVP

**Goal**: The app installs and starts with the same commands on Linux/WSL, macOS and Windows,
connects to a real treadmill and broadcasts to Zwift (WSL via USB dongle), degrades gracefully
without hardware, and shows a paired-only control page.

**Independent Test**: quickstart.md §1 on Ubuntu-24.04 WSL and §2 on macOS/Windows: start, pair a
phone, see live status; detach the dongle → clear message, app keeps running.

### Tests for User Story 1 (write first, must fail) ⚠️

- [X] T035 [P] [US1] Unit test test/unit/adapters/wifi.test.js against a fake iFit WebSocket server on port 0: runs the T020 contract suite; parses `MPH`/`KPH`/`Incline`/`Chest Pulse`/`Cadence` into km/h events; `Chest Pulse` 0 → `hr: null`; speed `< 0.1` → 0; applies `speedOffset`/`speedMultiplier`; when no current speed is reported (Pro-Form) emits `estimatedSpeed: true` with `fallbackKph`; `setTarget` sends `{ type:'set', values:{ KPH|MPH, Incline } }` as strings; `pauseBelt` sends speed `"0"`; `capabilities.canResume === false`; reconnect every 10 s; malformed JSON frames ignored
- [X] T036 [P] [US1] Unit test test/unit/adapters/ble.test.js with an injected fake `noble` and the existing `_request`/`_constants`: runs the T020 contract suite; reported `MaxKph`/`MinKph`/`MaxIncline`/`MinIncline` exposed via `limits()`; `pauseBelt` writes `Mode=Pause`, `resumeBelt` writes `Mode=Active` then targets; **regression**: speed above `MaxKph` is rejected with `ABOVE_MAX_SPEED` (old code clamped); mode change to Pause/Idle emits `status.mode`
- [X] T037 [P] [US1] Unit test test/unit/adapters/bleno.test.js with an injected fake `bleno`: FTMS/RSC services registered per `broadcast.ftms`/`rsc`; `update()` at 5 Hz uses existing calculators; when `require('@stoprocent/bleno')` throws, `status.available === false` and `reason` mentions `scripts/wsl/attach-bluetooth.ps1` when `/proc/version` contains `microsoft`, otherwise a generic "No Bluetooth adapter found" message; powered-off state → `poweredOn:false` within one event
- [X] T038 [P] [US1] Integration test test/integration/startup.test.js: app module (`createApp({ dataDir, simulate })`) starts with treadmill disconnected and broadcast unavailable without throwing; paired client receives `status` with both reasons within 1 s; detaching (simulated) is reflected within 5 s (FR-004, FR-006b); first start with test/fixtures/legacy/settings.conf migrates settings
- [X] T039 [P] [US1] Integration test test/integration/control.test.js: `control:set` with `{ kph: 25 }` → `ack` `{ ok:false, error:'OUT_OF_RANGE' }` and adapter receives nothing; `{}` → schema error; valid value reaches adapter; `settings:write` with an unknown key or `bleActivation` → rejected (**regression** for legacy unauthenticated `fromJSON`); valid write broadcasts `settings` to all paired clients without secrets
- [X] T040 [P] [US1] Unit test test/unit/cli/setup.test.js: first-run setup asks units and transport (`wifi` / `ble` / `simulated`), validates IP and 4-hex BLE code, saves via settingsRepo, prints pairing code and control-page URL; detects missing dependencies with `require.resolve` instead of checking `./node_modules`

### Implementation for User Story 1

- [X] T041 [P] [US1] Port src/ifit.js into src/adapters/treadmill/wifi.js implementing contracts/adapters.md (injected settings, no global `events` bus, km/h canonical, reject out-of-range, `pauseBelt` via speed 0, `canResume:false`, fallback speed handling from commit 7154529) to pass T035; delete src/ifit.js
- [X] T042 [P] [US1] Port src/ble/ifit/index.js into src/adapters/treadmill/ble.js (lazy-require `@stoprocent/noble` in `start()`, keep src/ble/ifit/_request.js and _constants.js, remove clamping, implement `pauseBelt`/`resumeBelt` via `Mode`) to pass T036; existing test/ble suite stays green
- [X] T043 [P] [US1] Port src/bluetooth/index.js into src/adapters/broadcast/bleno.js (lazy-require `@stoprocent/bleno`, keep src/bluetooth/{rsc,treadmill}/* calculators and characteristics, ramping and time/distance tracking moved to src/core/session.js as pure functions, WSL-aware reason) to pass T037; update characteristic files to require `@stoprocent/bleno`
- [X] T044 [US1] Implement src/api/socket/status.js (push `status` on connect, on change and at 1 Hz while belt moving) and src/api/socket/control.js and src/api/socket/settings.js (schema + limits validation, allow-list) to pass T039
- [X] T045 [US1] Port src/oneTimeSetup.js into src/cli/setup.js to pass T040; delete src/oneTimeSetup.js
- [X] T046 [US1] Rewrite app.js as a thin entry calling `createApp()` from new src/app.js (parse `--simulate` / `ZWIFIT_SIMULATE=1`, run setup if no settings, build adapters via factories, start server, preserve `SHUTDOWN_ONDISCONNECT` exit code 99, graceful shutdown via `death` stopping adapters and server) to pass T038
- [X] T047 [US1] Replace src/api/web-src with a new Angular 22 standalone app (`ng new` per T008 version, strict mode, no Bootstrap, SCSS): src/api/web-src/src/app/core/socket.service.ts (typed events from contracts/api.md, `ack` promises, reconnect), core/session.service.ts (`GET /api/session`, `POST /api/pair`), core/units.ts (port of src/core/units.js display helpers)
- [X] T048 [US1] Build the pairing screen src/api/web-src/src/app/pairing/pairing.component.ts (8-char code input auto-formatted `XXXX-XXXX`, optional device name, shows "Too many attempts, retry in N min" on 429; no data shown before pairing)
- [X] T049 [US1] Build the control screen src/api/web-src/src/app/control/control.component.ts (live speed, incline, distance, time, pace, HR or "not available"; treadmill and broadcast connection status with `reason` text and link to WSL attach help; manual speed/incline +/- buttons calling `control:set` and showing `OUT_OF_RANGE` errors)
- [X] T050 [US1] Build the settings screen src/api/web-src/src/app/settings/settings.component.ts (units, calibration, limits, cooldown speed, broadcast toggles, server host/port) and devices list src/api/web-src/src/app/settings/devices.component.ts (`GET /api/devices`, revoke with confirmation, "this device" marker, unpair)
- [X] T051 [US1] Add cross-platform `build:web` (`node scripts/build-web.js` running the Angular CLI build with `--output-path ../web-dist` via `path.join`), make buildWeb.sh a one-line wrapper calling `npm run build:web`, build and commit src/api/web-dist
- [X] T052 [US1] Rewrite README.md "Minimum Requirements"/"Software Requirements"/"Getting Started": Node 24 LTS; sections for **Ubuntu on WSL** (`wsl --update`, scripts/wsl/check-bluetooth.sh, custom kernel link to scripts/wsl/README.md, `networkingMode=mirrored`, Windows firewall rule for TCP 1337, attach-bluetooth.ps1 and re-attach after reboot, Node via nvm, `setcap cap_net_raw,cap_net_admin+eip`), **Linux/Raspberry Pi**, **macOS** (Bluetooth permission for the terminal app), **Windows native** (WinUSB via Zadig); pairing explanation; `npm run start:sim`; recommended dongles; one vs two dongles for Wi-Fi vs BLE treadmills
- [ ] T053 [US1] Deploy on the owner's Ubuntu-24.04 WSL following README only; walk quickstart.md §1 including the negative detach check and Zwift pairing; record time taken against SC-001 (< 15 min excluding downloads) and any README fixes in this task's PR

**Checkpoint**: US1 deployable MVP — app runs on WSL with real treadmill + Zwift, paired-only control page, CI green on 3 OS

---

## Phase 4: User Story 2 - Build a training plan step by step (Priority: P2)

**Goal**: Create, edit, reorder, duplicate, delete, import/export training plans with speed-or-pace
steps, incline, time-or-distance ends and repeat blocks; legacy routes migrated.

**Independent Test**: quickstart.md §4 — build the "Intervals 6×" plan, totals 30:30 / 3.1 mi,
limit rejection, restart persistence, export/import, routes.conf migration.

### Tests for User Story 2 (write first, must fail) ⚠️

- [X] T054 [P] [US2] Unit test test/unit/core/plans/validate.test.js covering every data-model.md rule verbatim: name "1–80 chars, trimmed, unique per user (case-insensitive); no control chars"; description "0–500 chars"; items "1–200 items; total expanded steps ≤ 2000"; step label "0–40 chars"; `targetKph` "within effective limits; `> 0`"; `entered` "must round-trip to `targetKph` within 0.05 km/h"; incline "within effective limits, 0.5 % resolution"; end time "1–21600" s, distance "10–100000" m; block `repeat` "1–99", block steps "1–20 steps; blocks do **not** nest"; step/block ids unique within plan; errors as `{ path, code, message }` e.g. `items[2].steps[0].targetKph` / `ABOVE_MAX_SPEED`
- [X] T055 [P] [US2] Unit test test/unit/core/plans/expand.test.js and totals.test.js: block ×6 expands to 12 flat steps with `repetition` numbers; quickstart "Intervals 6×" plan totals exactly 1830 s and 3.1 mi (±0.01); distance steps get time estimated from target speed and time steps get distance estimated, setting `totals.estimated`
- [X] T056 [P] [US2] Unit test test/unit/core/plans/migrateRoutes.test.js with fixture test/fixtures/legacy/routes.conf containing the formats from the old route form help (`1 Mile: 1% Incline`, `2.6 Miles: 6.2 MPH`, `0:30:00: 10% Incline`, `5 Miles: 2% Incline, 4 MPH`, KPH and Kilometers variants): cumulative boundaries become consecutive steps whose speed/incline carry forward; unparseable lines reported with line numbers; result passes validate(); legacy file untouched
- [X] T057 [P] [US2] Unit test test/unit/storage/plansRepo.test.js: CRUD under `plans/<id>.json`; ids are "random 128-bit values encoded as 26-char Crockford base32"; `createdAt`/`updatedAt` server-set; duplicate names (case-insensitive) rejected `NAME_TAKEN`; a corrupt or invalid plan file is skipped and reported while others load; plans re-validated on load against current limits (flagged, not deleted)
- [X] T058 [P] [US2] Integration test test/integration/plans.test.js: `plans:save`/`list`/`get`/`duplicate`/`delete` via paired socket incl. `plans:changed` broadcast; `GET /api/plans/:id/export` returns `Content-Disposition: attachment; filename="<safe-name>.zwifit-plan.json"`; `POST /api/plans/import` assigns a new id, rejects `"targetKph": 99` with path `items[0].targetKph`, rejects > 1 MB with 413; unpaired → 401

### Implementation for User Story 2

- [X] T059 [P] [US2] Add `controlIncline` (boolean, default `true`; when false the plan never sends incline, so the Zwift incline tracker keeps control — spec edge case) to contracts/plan-file.schema.json, src/contracts/schemas/plan-file.schema.json and data-model.md "Training Plan"; extend T054 fixtures accordingly
- [X] T060 [P] [US2] Implement src/core/plans/validate.js (schema via src/contracts + semantic/limit checks) to pass T054
- [X] T061 [P] [US2] Implement src/core/plans/expand.js and src/core/plans/totals.js to pass T055
- [X] T062 [P] [US2] Implement src/core/plans/migrateRoutes.js to pass T056
- [X] T063 [US2] Implement src/storage/plansRepo.js (uses atomicFile, validate) and run routes migration once at startup in src/app.js (marker `migrations.routesV1` in settings) to pass T057; delete src/routes.js
- [X] T064 [US2] Implement src/api/socket/plans.js and src/api/http/plans.js (export with filename sanitized to `[A-Za-z0-9-_]`, import with `express.json({ limit: '1mb' })`) to pass T058
- [X] T065 [US2] Build plans list src/api/web-src/src/app/plans/plans-list.component.ts (name, totals, updated date; New, Duplicate, Delete with confirm, Import file picker, Export)
- [X] T066 [US2] Build plan editor src/api/web-src/src/app/plans/plan-editor.component.ts: add/remove/reorder steps and blocks (buttons + drag), step fields label / speed-or-pace toggle with unit per user setting and live equivalent ("10:00 min/mi = 6.0 mph") / incline / end type time (`h:mm:ss`) or distance; block repeat 1–99; expanded preview; live totals; server validation errors mapped onto fields by `path`; `controlIncline` toggle
- [X] T067 [US2] Remove the legacy routes UI and step recorder (old `routes/`, `models/recordedRoute.ts`, `services/stepRecorder.ts` are not carried into the new app); rebuild and commit src/api/web-dist

**Checkpoint**: US1 + US2 work independently; plans persist across restarts on all OS

---

## Phase 5: User Story 3 - Run a training plan on the treadmill (Priority: P3)

**Goal**: Server-side playback that applies each step's targets, supports pause (belt stop) /
explicit resume / skip / stop / manual override, ends safely with cool-down, and never sends
commands after it ends.

**Independent Test**: quickstart.md §5 on `npm run start:sim`, then a real treadmill at low speed.

### Tests for User Story 3 (write first, must fail) ⚠️

- [X] T068 [P] [US3] Unit test test/unit/core/playback/engine.test.js with fake clock and a recording fake adapter, covering the data-model.md state machine: `start` refused unless `idle`, connected, belt speed > 0 (`BELT_STOPPED` → waits with message "Start the belt on your treadmill") and plan valid against current limits; step 1 targets sent on start; next targets within 2 s of a time or distance boundary (SC-004); distance progress uses `estimatedSpeed` and flags it; pause → `pauseBelt` once, step progress frozen, **no command for 10 simulated minutes**; resume only via explicit call → `resumeBelt` + targets; `canResume:false` → waits for belt movement then continues; override applies immediately and clears at next step; skip; `controlIncline:false` never sends incline; last step → single `setTarget({ kph: cooldownKph, incline: 0 })` then `completed`; reported speed 0 for ≥ 3 s not requested by engine, or BLE mode Pause/Idle → `ended(treadmillStopped)`; disconnect → `ended(connectionLost)`; target not reached in 5 s → resent once and logged; **after `ended`/`completed` zero adapter calls for any later event (SC-005)**; pause while belt already stopped sends no stop; connection loss while paused → ended
- [X] T069 [P] [US3] Integration test test/integration/playback.test.js with two paired clients: both receive identical `playback` events at 1 Hz; second `playback:start` → `ALREADY_RUNNING`; `plans:delete` of running plan → `PLAN_RUNNING`; editing the running plan doesn't change the session (snapshot); revoking the controlling device mid-plan → that socket disconnected, plan continues, other device can stop it; resume from an unpaired socket impossible; app restart → state `idle`, no commands

### Implementation for User Story 3

- [X] T070 [US3] Implement src/core/playback/engine.js (pure state machine; injected clock, adapter, limits, settings; emits `state` events; holds `planSnapshot`; implements every rule in T068) to pass T068
- [X] T071 [US3] Implement src/api/socket/playback.js (`playback:start|pause|resume|skip|stop`, `playback` broadcast to all paired sockets on change and at 1 Hz) and wire engine into src/app.js (adapter events → engine; `control:set` during playback → engine override) to pass T069
- [X] T072 [US3] Build playback screen src/api/web-src/src/app/playback/playback.component.ts: plan name, current step (label, target speed/pace, incline), next step, step and plan remaining time/distance, progress bar, override indicator, large Pause/Resume/Skip/Stop buttons (Stop and Pause always visible), end-reason banner (Completed / Stopped by you / Connection lost / Stopped from treadmill / App restarted), "Start the belt" waiting state; Start button on plan list/editor disabled while another plan runs; rebuild web-dist

**Checkpoint**: US1–US3 work; quickstart §5 passes in simulation and on hardware at low speed

---

## Phase 6: User Story 4 - Review and export workout history (Priority: P4)

**Goal**: Every playback recorded with 1 s samples incl. heart rate, per-step results, crash-safe,
viewable, CSV-exportable and deletable by paired devices only.

**Independent Test**: quickstart.md §6 — run, stop mid-way, check history and CSV, `kill -9`
mid-plan and restart.

### Tests for User Story 4 (write first, must fail) ⚠️

- [X] T073 [P] [US4] Unit test test/unit/core/history/recorder.test.js: sample "every 1 s while running or paused" with fields `t, kph, incline, metres, hr|null, flatIndex, event?, estimated?`; `event` on step/override/pause/resume/end; StepResult averages, `seconds`, `metres`, `avgHr`/`maxHr` absent when no HR, `overridden`, `skipped`; summary totals; `hr` 0 stored as `null`; `rebuildFromSamples` produces the same summary, tolerates a truncated last line and sets `endReason: appRestart`
- [X] T074 [P] [US4] Unit test test/unit/storage/workoutsRepo.test.js: writes `workouts/<id>.json` and appends `workouts/<id>.samples.ndjson` with flush per sample; list newest first with `before`/`limit 1–100`; samples paging `limit ≤ 3600`; delete removes both files; startup scan closes any workout with `endedAt: null`
- [X] T075 [P] [US4] Unit test test/unit/core/history/csv.test.js against contracts/workout-export-csv.md: UTF-8 BOM, CRLF, RFC 4180 quoting, one header with all columns, row order summary → steps → samples, imperial and metric column names (`speed_mph`/`speed_kph`, `distance_mi`/`distance_km`), empty `hr_bpm` when null, injection guard for cells starting `=`, `+`, `-`, `@`, tab, CR in text columns (plan name `=HYPERLINK(...)` fixture), filename `zwifit-<YYYY-MM-DD>-<safe-plan-name>.csv` "only `[A-Za-z0-9-_]`, max 60 chars"
- [X] T076 [P] [US4] Integration test test/integration/workouts.test.js: a simulated playback produces a workout visible via `workouts:list`/`get`/`samples` and `workouts:changed`; export CSV totals match `workouts:get`; delete then export → 404; unpaired → 401; log output during the run contains no HR values or samples (FR-019f)

### Implementation for User Story 4

- [X] T077 [P] [US4] Implement src/core/history/recorder.js to pass T073
- [X] T078 [P] [US4] Implement src/core/history/csv.js to pass T075
- [X] T079 [US4] Implement src/storage/workoutsRepo.js and startup crash recovery in src/app.js to pass T074
- [X] T080 [US4] Implement src/api/socket/workouts.js and src/api/http/workouts.js (`GET /api/workouts/:id/export.csv`), connect recorder to engine events in src/app.js, to pass T076
- [X] T081 [US4] Build history screens src/api/web-src/src/app/history/history-list.component.ts (date, plan, duration, distance, avg/max HR or "not available", end reason; infinite scroll via `before`) and history-detail.component.ts (summary, step table target vs actual, HR, Export CSV, Delete with confirmation); rebuild web-dist

**Checkpoint**: US1–US4 work; every playback appears in history with correct end reason (SC-007, SC-008)

---

## Phase 7: User Story 5 - Clearer, responsive control page (Priority: P5)

**Goal**: Responsive, dark-mode aware, accessible UI across all screens.

**Independent Test**: quickstart.md §7 via Playwright at 360/768/1280 px in light and dark.

### Tests for User Story 5 (write first, must fail) ⚠️

- [X] T082 [P] [US5] Playwright config playwright.config.ts (starts `npm run start:sim` with temp `ZWIFIT_DATA_DIR`, projects chromium/firefox/webkit × viewports 360×740, 768×1024, 1280×800 × `colorScheme` light/dark) and e2e/helpers/pair.ts (reads pairing code from server stdout)
- [X] T083 [P] [US5] e2e/responsive.spec.ts: on every screen `document.documentElement.scrollWidth <= innerWidth`; Start/Pause/Resume/Skip/Stop and +/- controls have bounding boxes ≥ 48×48 px; text contrast ≥ 4.5:1 in both themes (axe-core via `@axe-core/playwright`, zero serious violations)
- [X] T084 [P] [US5] e2e/flows.spec.ts: unpaired visitor sees only pairing screen; pair; simulated disconnect shown within 5 s; build "Intervals 6×" via the editor in < 3 min of scripted steps; run, pause, resume, stop; history entry appears and CSV downloads

### Implementation for User Story 5

- [X] T085 [US5] Create design tokens src/api/web-src/src/styles/_tokens.scss (CSS custom properties for colors, spacing, type scale; light defaults; dark via `@media (prefers-color-scheme: dark)`; manual override `[data-theme]`) and apply across all components; remove any hard-coded colors
- [X] T086 [US5] Implement responsive shell src/api/web-src/src/app/shell/shell.component.ts (bottom tab bar on < 768 px, side nav ≥ 768 px; routes Control, Plans, Playback, History, Settings) and large-number stat tiles src/api/web-src/src/app/shared/stat-tile.component.ts
- [X] T087 [US5] Accessibility pass: `aria-live="polite"` on connection status and playback step changes, labelled inputs in editor and settings, visible focus styles, keyboard reordering in plan editor; rebuild web-dist to pass T083–T084

**Checkpoint**: all stories complete; SC-009 verified by CI

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T088 [P] Security review of the full diff against plan.md threat model (run `/security-review`); fix findings with regression tests
- [X] T089 [P] Run `npm audit --audit-level=high` and `npm outdated`; resolve or record time-boxed exceptions in research.md per constitution I
- [X] T090 [P] Verify coverage thresholds (`npm test -- --coverage`) ≥ 80 % for src/core, src/security, src/storage; add missing edge-case tests
- [X] T091 Remove dead legacy code and references (`src/settings.js` shim if unused, old `src/bluetooth/index.js`, `src/ble/ifit/index.js`, `README` Node 8/13 text, `settings.conf`/`routes.conf` mentions now pointing to the data dir) and update .github/ISSUE_TEMPLATE/bug_report.md to ask for OS, Node version and `transport`
- [ ] T092 [P] Run quickstart.md §2–§7 on native macOS and native Windows 11 (simulated + real Bluetooth dongle where available) and record results in quickstart.md "Validation log"
- [X] T093 Update .specify/memory/constitution.md follow-up TODO list: mark CI, coverage thresholds, cross-platform scripts, README Node version and API authentication items as done (remove the Sync Impact Report comment if all are resolved)

---

## Phase 9: Additions after the plan (2026-11-01 – 2026-11-02)

Requested by the owner while testing; spec User Stories 6–7 and FR-019c/g, FR-020a–e, FR-022a/b,
FR-026–FR-034.

**Sensors**

- [X] T100 ANT+ adapter (heart rate, footpod cadence, Stryd power) with stick release, retry and hotplug: src/adapters/sensors/ant.js, test/unit/adapters/ant.test.js
- [X] T101 Merge sensor readings into the treadmill status; ignore a disconnected treadmill's pulse: src/core/sensorMerge.js, test/unit/core/sensorMerge.test.js
- [X] T102 Record power and cadence in samples, step results and totals; FIT export with power, cadence and lap/session maxima: src/core/history/recorder.js, summarize.js, fit.js
- [X] T103 ANT+ scan, chosen device numbers, maker and battery: src/adapters/sensors/ant.js
- [X] T104 Bluetooth sensors (0x180D, 0x1818, 0x1814, battery) and the shared scan lease; BLE treadmill moved onto the lease: src/adapters/sensors/ble.js, src/adapters/bleScanLease.js, src/adapters/treadmill/ble.js, test/unit/adapters/bleSensors.test.js
- [X] T105 Sensor hub and per-source choice (auto ANT+ first / ant / ble / treadmill / off), power smoothing: src/adapters/sensors/hub.js, src/core/sensorMerge.js
- [X] T106 `sensors:scan` / `sensors:connect` / `sensors:forget` with schemas; settings fields: src/api/socket/sensors.js, src/contracts/schemas/sensors-*.schema.json, settings*.schema.json, test/unit/api/sensorsSocket.test.js

**Broadcast**

- [X] T110 Heart Rate service from the merged heart rate; Zwift devices list (rename, forget): src/adapters/broadcast/*, src/api/socket/zwiftDevices.js
- [X] T111 Running power in FTMS Treadmill Data and as a Cycling Power service: src/adapters/broadcast/services.js, bleno.js, src/bluetooth/treadmill/calculator.js, test/unit/adapters/bleno.test.js

**Web app redesign**

- [X] T120 Tokens, self-hosted Inter / JetBrains Mono, dark default, top-right segmented navigation: src/api/web-src/src/styles/*, angular.json, app/shell/shell.component.ts, app/core/prefs.service.ts
- [X] T121 Live history service (heart rate, power, speed, cadence, incline) and chart helpers: app/core/hr-history.service.ts, app/shared/chart.ts, spark.component.ts, live-chart.component.ts, hr-trace.*
- [X] T122 Dashboard per the mockup (pills, tiles with sparklines, live lanes with window switch, plan strip, presets, incline card, heart-rate zones, autodetect): app/control/*
- [X] T123 Workout page per the mockup (header actions, plan profile, Now card with ring, Up next, live lanes, tiles): app/playback/*, app/core/plan-profile.service.ts
- [X] T124 Plans card grid with profiles and search; History weekly summary and run cards; tinted detail tiles: app/plans/plans-list.component.ts, app/history/*
- [X] T125 Settings per the mockup: section menu, switches, limit tracks, Zwift devices, per-metric sensor cards (source, devices, In use / Standby, Use / Pin / Forget, scan), power options and broadcast switches, maximum heart rate: app/settings/*
- [X] T126 e2e: replace the side-menu test with a top-right navigation test: e2e/flows.spec.ts
- [ ] T127 Owner: validate quickstart §8–§9 with the real ANT+ stick, Stryd, strap and Zwift

## Phase 10: Additions (2026-11-08 – 2026-11-13)

- [X] T130 ANT+: reopen a sensor's channel the stick closed (strap off, out of range) without a restart: src/adapters/sensors/ant.js, test/unit/adapters/ant.test.js
- [X] T131 Startup: no Bluetooth adapter no longer stops Zwifit; clear "port in use"; failed start exits with its cause: src/adapters/broadcast/bleno.js, src/api/server.js, app.js
- [X] T132 Installable web app (manifest, icons): src/api/web-src/public/manifest.webmanifest, public/icons/, src/index.html
- [X] T133 HTTPS on an extra port (`server.tls.port`) next to HTTP: src/api/server.js, settings.schema.json, test/integration/https.test.js, scripts/wsl/README.md
- [X] T134 Pairing code shown in Settings → Paired devices (single use, 10 minutes): src/security/pairing.js, src/api/http/pairing.js, app/settings/*, app/pairing/*
- [X] T135 [US8] Program generator: src/core/programs/generate.js, test/unit/core/programs.test.js
- [X] T136 [US8] Programs storage and commands (preview, create, list, get, start, delete): src/storage/programsRepo.js, src/api/socket/programs.js, src/contracts/schemas/programs-*.schema.json, test/integration/programs.test.js
- [X] T137 [US8] Programs pages (new program with preview, program calendar with Start): app/programs/*, app.routes.ts, e2e/responsive.spec.ts
- [X] T139 Per-device "Trust address" (no code or cookie from a trusted device's address): src/storage/devicesRepo.js, src/security/pairing.js, src/api/http/pairing.js, src/api/server.js, app/settings/*, test/integration/pairing.test.js
- [X] T144 Settings → Console output: live raw messages to and from the treadmill (pause, clear, copy): wifi.js, simulated.js, treadmill-console.schema.json, console-readout.component.ts
- [X] T143 Settings → Console readout: set speed, measured belt speed, Zwifit's speed and incline, plus every field the console sends: src/adapters/treadmill/wifi.js, simulated.js, src/app.js, app/settings/console-readout.component.ts, test/unit/adapters/wifi.test.js
- [X] T142 Restart Zwifit (top bar button and Settings → Server): `npm start` supervises Zwifit and restarts it on `server:restart`: app.js, src/app.js, app/core/restart.service.ts, app/shell/shell.component.ts, app/settings/*, test/integration/restart.test.js
- [X] T141 Add a client by typing its IP address; edit a trusted device's address: src/storage/devicesRepo.js, src/api/http/pairing.js, src/contracts/schemas/device-add.schema.json, device-rename.schema.json, app/settings/*, test/integration/pairing.test.js
- [X] T140 Zwifit's own CA for HTTPS so devices can trust it (install as app): scripts/wsl/make-cert.sh, scripts/wsl/README.md
- [ ] T138 Owner: generate a program, run a day on the treadmill, check it is marked done

## Phase 11: Additions (2026-11-14)

Requested by the owner while testing; spec Session 2026-11-14, FR-019h–j, FR-020c/e/f/g (amended),
FR-027a, FR-029, FR-032a, FR-033a, FR-038.

- [X] T150 Shutdown time limits: the child exits within 10 s and the supervisor kills it after 15 s: app.js
- [X] T151 ANT+ devices in range (heard + last scan, last heard time): src/adapters/sensors/ant.js, test/unit/adapters/ant.test.js, app/settings/*
- [X] T152 Custom names for ANT+ and Bluetooth devices (`sensors:rename`): src/api/socket/sensors.js, src/contracts/schemas/sensors-rename.schema.json, settings.schema.json, test/unit/api/sensorsSocket.test.js, app/settings/*
- [X] T153 Free runs (Pause / Resume / Finish, `control:finish`, status `freeRun`): src/core/history/freeRun.js, recorder.js, src/api/socket/control.js, status.js, src/app.js, app/control/*, test/unit/core/history/freeRun.test.js, test/integration/control.test.js
- [X] T154 Bluetooth sensors blocked while sharing the adapter with the Zwift broadcast (opt-in `sensors.bluetoothWithZwift`); re-advertise after a noble adapter reset: src/adapters/sensors/ble.js, src/adapters/broadcast/bleno.js, src/app.js, test/unit/adapters/bleSensors.test.js, bleno.test.js
- [X] T155 Measured belt speed to Zwift (`speedSource`, no easing when measured): src/adapters/treadmill/wifi.js, src/adapters/broadcast/bleno.js, src/app.js, test/unit/adapters/wifi.test.js, bleno.test.js
- [X] T156 Incline totals (avg, max, climb) and incline chart in History: src/core/history/summarize.js, test/unit/core/history/summarize.test.js, app/history/*, app/core/prefs.service.ts
- [X] T157 [US8] Custom programs (`programs:createCustom` / `programs:updateCustom`, week × weekday editor): src/core/programs/custom.js, src/storage/programsRepo.js, src/api/socket/programs.js, src/contracts/schemas/programs-custom.schema.json, app/programs/program-editor.component.ts, test/unit/core/customPrograms.test.js, test/integration/programs.test.js
- [X] T158 Heart-rate zone colours (live lane, sparkline, tile, History chart) and time in zone per workout: app/core/prefs.service.ts, app/shared/live-chart.component.ts, spark.component.ts, app/history/*, styles/_tokens.scss, _screens.scss
- [X] T159 Power zones from threshold power (tiles, live lane, History chart, time in power zone): app/core/prefs.service.ts, app/control/*, app/playback/*, app/shared/*, app/history/*
- [X] T160 Dashboard: time in zone inside the heart-rate lane; incline row under the belt controls; incline trace over the speed lane: app/control/*, app/shared/live-chart.component.ts, styles/_screens.scss
- [X] T161 Tablet layout and full screen (1600 px page, viewport-height lanes, safe areas, Fullscreen button, home-screen meta): src/index.html, app/shell/shell.component.ts, styles/_shell.scss, _screens.scss, _tokens.scss
- [X] T163 Average pace over moving time (`totals.movingSeconds`, `avgKph`) in History; W/kg and % of threshold on the Avg power tile: src/core/history/summarize.js, test/unit/core/history/summarize.test.js, app/history/*
- [X] T164 Step countdown (5 s, flashing, beeps, Settings → Display switches): app/shared/step-countdown.component.ts, app/shell/shell.component.ts, app/core/prefs.service.ts, app/settings/*
- [X] T165 Workout intensity 50–120 % (`playback:intensity`, `playback.intensity`), controls on the Workout page and dashboard, scaled targets shown: src/core/playback/engine.js, src/api/socket/playback.js, src/contracts/schemas/playback-intensity.schema.json, test/unit/core/playback/engine.test.js, app/core/intensity.ts, app/shared/intensity-control.component.ts, app/playback/*, app/control/*
- [ ] T162 Owner: check the dashboard on the iPad (landscape and portrait, from the home screen) and power zones with a threshold set

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none. T007 (WSL spike) should start immediately; it blocks only T053.
- **Foundational (Phase 2)**: after T001–T004; blocks all user stories.
- **US1 (Phase 3)**: after Phase 2. MVP.
- **US2 (Phase 4)**: after Phase 2; UI tasks T065–T067 need T047 (new Angular app) from US1.
- **US3 (Phase 5)**: needs US2 core (T060–T063) for plans to play.
- **US4 (Phase 6)**: needs US3 engine events (T070).
- **US5 (Phase 7)**: needs the screens from US1–US4 to exist; T085–T086 can start after T047.
- **Polish (Phase 8)**: after desired stories.
- **Phase 9 (US6–US7, redesign)**: after US5; sensors need the adapters from US1, history columns need US4.
- **Phase 10 (US8 and owner requests)**: programs need US2 plans, US3 playback and US4 history; access items need US1 pairing.

```text
Setup ─▶ Foundational ─▶ US1 (MVP) ─▶ US2 ─▶ US3 ─▶ US4
                          │             └──────────────┐
                          └─ T047 ─▶ US5 tokens/shell ──┴─▶ US5 e2e ─▶ Polish
```

### Within Each Story

Tests (must fail) → core modules → storage → API handlers → app wiring → UI → rebuild web-dist.

### Parallel Opportunities

- Phase 1: T003, T004, T005, T006, T008 in parallel; T007 runs alongside on the WSL machine.
- Phase 2: all tests T009–T021 in parallel; implementations T022–T026, T029, T031 in parallel.
- US1: T035–T040 in parallel; T041, T042, T043 in parallel (separate adapters).
- US2: T054–T058 in parallel; T059–T062 in parallel.
- US4: T073–T076 in parallel; T077, T078 in parallel.
- US5: T082–T084 in parallel.

---

## Parallel Example: User Story 1

```bash
# Tests first (all must fail):
Task: "Unit test test/unit/adapters/wifi.test.js against a fake iFit WebSocket server"
Task: "Unit test test/unit/adapters/ble.test.js with an injected fake noble"
Task: "Unit test test/unit/adapters/bleno.test.js with an injected fake bleno"
Task: "Integration test test/integration/startup.test.js"
Task: "Integration test test/integration/control.test.js"

# Then the three adapters together:
Task: "Port src/ifit.js into src/adapters/treadmill/wifi.js"
Task: "Port src/ble/ifit/index.js into src/adapters/treadmill/ble.js"
Task: "Port src/bluetooth/index.js into src/adapters/broadcast/bleno.js"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 incl. WSL spike T007 (stop and escalate if Bluetooth can't be made to work in WSL).
2. Phase 2 — secure server foundation.
3. Phase 3 — US1; **validate** with quickstart §1 on WSL (T053). This alone fixes the security
   hole in the legacy API and makes Zwifit run on modern Node across OSes.

### Incremental Delivery

US1 → US2 (plans, saved but not played) → US3 (playback) → US4 (history) → US5 (polish). Each
checkpoint is a releasable state; feature 002 (Grafana) can start after US4 because it reuses the
1 s workout samples.

---

## Notes

- Commit after each task or logical group; keep `npm test` green at every commit.
- Never relax a safety test to make an implementation pass.
- Legacy files are moved, not duplicated; delete originals in the same task that ports them.
