---
description: "Task list for ANT+ Broadcast from Zwifit"
---

# Tasks: ANT+ Broadcast from Zwifit

**Input**: Design documents from `specs/003-ant-plus-broadcast/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ant-pages.md, contracts/api.md, quickstart.md

**Tests**: Required. Constitution Principle II says tests come first and must fail before
the code exists, with ≥ 80 % line/branch coverage on changed modules.

**Organization**: By user story, in priority order: US1 (P1), US4 (P2), US2 (P2), US3 (P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

**Purpose**: Settings schema and defaults that every story reads.

- [X] T001 [P] Add `antBroadcast` to `src/contracts/schemas/settings.schema.json` per contracts/api.md: `enabled`, `footpod`, `hr`, `power`, `treadmill` booleans; `rebroadcastAnt: { hr, power }` booleans; `deviceNumbers: { footpod, hr, power, treadmill }` each `$ref` to new `$defs/antBroadcastNumber` = "integer, minimum 1, maximum 65535"; `additionalProperties: false` on every object
- [X] T002 [P] Add `antBroadcast` to `src/contracts/schemas/settings-write.schema.json` with the same switches and `rebroadcastAnt`, **without** `deviceNumbers` (so it's rejected as `UNKNOWN_PROPERTY`), `minProperties: 1`
- [X] T003 [P] Create `src/contracts/schemas/ant-broadcast-renumber.schema.json`: `$id` `https://zwifit.local/schemas/ant-broadcast-renumber.json`, empty object only (`additionalProperties: false`)
- [X] T004 Add defaults `antBroadcast: { enabled: false, footpod: true, hr: true, power: true, treadmill: true, rebroadcastAnt: { hr: false, power: false } }` to `src/storage/settingsRepo.js`; existing settings files without `antBroadcast` load with these defaults
- [X] T005 [P] Contract tests in `test/unit/contracts/antBroadcastSchemas.test.js`: valid full object; `deviceNumbers` 0, 65536, 1.5 rejected; unknown property rejected; `settings-write` rejects `deviceNumbers`; renumber accepts `{}` only

**Checkpoint**: `npm test` passes; settings round-trip with and without `antBroadcast`.

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: Pure encoders, counters and rotation, plus the shared-stick hooks in `AntSensors`.

### Tests first (must fail before implementation)

- [X] T006 [P] Page encoder tests in `test/unit/core/antBroadcast/pages.test.js` with hand-computed vectors for every page in contracts/ant-pages.md: SDM 1 and 2, HRM 2/3/4 (toggle bit), power 16, FE 16/17/19, common 80/81; byte widths and rollover (distance 300.5 m → 44 + 8/16, beat time mod 65 536), negative incline as int16, missing HR → 0xFF in FE 16, missing cadence → 0xFF in FE 19
- [X] T007 [P] Counter and validation tests in `test/unit/core/antBroadcast/counters.test.js`: distance and time advance only while kph > 0; strides from cadence (steps/2); heart beats every 60/HR s; power event count + accumulated power per message; counters keep their value across a disconnect (kph 0) and continue; invalid inputs (NaN, negative, kph > 30 or > treadmill max, HR outside 30–250, cadence outside 1–300, power outside 0–2500, incline outside −10–40) become missing
- [X] T008 [P] Rotation tests in `test/unit/core/antBroadcast/schedule.test.js`: per profile the order from contracts/ant-pages.md: pages 80/81 twice each per 64 messages (HRM background 2/3), HRM toggle every 4 messages, SDM page 2 only when cadence present, FE 16/17/16/19 cycle
- [X] T009 [P] `AntSensors` stick-sharing tests in `test/unit/adapters/ant.test.js`: `'stick'` emitted after open and after a scan reopens; `'stick-lost'` emitted before release on stop, unplug (`usb` detach), scan start and `reconnect()`; `listen: false` opens the stick but attaches no receive sensors; `stickReady()` reflects state; existing tests still pass

### Implementation

- [X] T010 [P] Implement `src/core/antBroadcast/pages.js` (pure encoders returning 8-element byte arrays, clamped to field widths) to pass T006
- [X] T011 [P] Implement `src/core/antBroadcast/counters.js` (`validInput(status, limits)`, `createCounters()`, `advance(counters, input, dtMs)`) to pass T007
- [X] T012 [P] Implement `src/core/antBroadcast/schedule.js` (`nextPage(kind, state, values)` → `{ page bytes, state }`) using pages.js, to pass T008
- [X] T013 Change `src/adapters/sensors/ant.js`: `listen` option (boolean or function, default true) gates receive channels 0–2; emit `'stick'` after a successful open and `'stick-lost'` before `release()` in `_close`, `_lost`, `_runScan` start; add `stickReady()`; pass T009

**Checkpoint**: Core is fully unit-tested; `AntSensors` can share its stick.

---

## Phase 3: User Story 1: Watch records the treadmill run (P1) 🎯 MVP

**Goal**: With ANT+ broadcast on, Zwifit is an ANT+ footpod carrying treadmill speed, distance and cadence.

**Independent Test**: Simulated treadmill + fake stick: turn the broadcast on, change speed, check that SDM page 1 bytes follow; belt stop → speed 0, distance frozen; restart → same device number.

### Tests first

- [X] T014 [P] [US1] Adapter tests in `test/unit/adapters/antBroadcast.test.js` with a fake stick (EventEmitter, `write()` records messages, helper emits `MESSAGE_CHANNEL_EVENT`/`EVENT_TX` for a channel): footpod channel 3 configured in order assign(`transmit`) → setDevice(number, 124, 5) → setFrequency(57) → setPeriod(8134) → open; each `EVENT_TX` on channel 3 writes the next SDM page with current speed; nothing written before `'stick'`; `'stick-lost'` stops writes and the next `'stick'` reconfigures with the same number; `stop()` closes and unassigns channel 3; disabled or footpod unticked → no channel
- [X] T015 [P] [US1] Device number tests in the same file: missing `deviceNumbers.footpod` → one is drawn from injected `randomInt(1, 65536)` and saved through `saveDeviceNumbers`; an existing number is reused unchanged
- [X] T016 [P] [US1] Integration test in `test/integration/antBroadcast.test.js` (createApp with simulated treadmill and fake ANT lib): `settings:write { antBroadcast: { enabled: true } }` from a paired device → footpod channel opens within one update; unpaired socket is rejected (FR-013); speed set via `control:set` shows up in the next SDM page

### Implementation

- [X] T017 [US1] Create `src/adapters/antBroadcast/index.js` `AntBroadcast` per contracts/api.md: constructor `{ host, getSettings, saveDeviceNumbers, now, randomInt, loadAnt }`; channel table `{ footpod: 3, hr: 4, power: 5, treadmill: 6 }`; on `'stick'` reconcile channels, on `'stick-lost'` drop state without writing; listen to stick `'read'` and answer `EVENT_TX` on own channels with `schedule.nextPage`; `update(merged)` stores validated input and advances counters; reconcile with settings on each update (R7); implement the footpod profile; pass T014/T015
- [X] T018 [US1] Wire into `src/app.js`: create `AntSensors` when `sensors.ant !== false` **or** `antBroadcast.enabled` at start, with `listen: () => settingsRepo.get().sensors?.ant !== false`; create `AntBroadcast` with that host (or `host: null`); feed `treadmill.on('status')` into `antBroadcast.update` (kph and incline 0 when disconnected, like the Bluetooth broadcast); `start()`/`stop()` alongside the other adapters; persist new device numbers via `settingsRepo.replace`; pass T016

**Checkpoint**: MVP: a watch can pair with "Zwifit" as a footpod (quickstart rows 1–5).

---

## Phase 4: User Story 4: See and control the ANT+ broadcast (P2)

**Goal**: Status on Dashboard and Settings, clear reasons, renumber, live on/off.

**Independent Test**: No stick → "No ANT+ USB stick found …"; fake stick → "Broadcasting" with footpod number; renumber changes the number and reopens the channel.

### Tests first

- [X] T019 [P] [US4] Status tests in `test/unit/adapters/antBroadcast.test.js`: `status()` is `off` when disabled; `starting` before a stick; `error` with the host's reason (no stick, WSL hint) and `needsRestart: true` when enabled but `host` is null; `paused` with "paused while scanning for sensors" during a scan; `broadcasting` with `sensors: [{ kind, deviceNumber, sending }]`; `'status'` emitted only on change; stick unplug and re-plug resumes with the same numbers
- [X] T020 [P] [US4] Integration tests in `test/integration/antBroadcast.test.js`: `status.antBroadcast` present in the pushed `status`; `ant-broadcast:renumber` returns four new numbers in 1–65535, persists them, pushes `settings`, and rejects any non-empty payload; turning `enabled` off closes all transmit channels while ANT+ reception channels 0–2 stay attached

### Implementation

- [X] T021 [US4] Add status tracking and `renumber()` to `src/adapters/antBroadcast/index.js`; pass T019
- [X] T022 [US4] Add `antBroadcast` to the snapshot in `src/api/socket/status.js` (subscribe to its `'status'`; default `{ state: 'off', sensors: [] }`)
- [X] T023 [US4] Create `src/api/socket/antBroadcast.js` registering `ant-broadcast:renumber` (schema `ant-broadcast-renumber`) and register it in `src/app.js`; pass T020
- [X] T024 [US4] Startup/change log line in `src/app.js` via `logStatus`: "ANT+ broadcast ready: footpod #N, …" or "ANT+ broadcast unavailable: <reason>"
- [X] T025 [P] [US4] Types in `src/api/web-src/src/app/core/api.types.ts`: `AntBroadcastSettings`, `AntBroadcastStatus`, `status.antBroadcast`
- [X] T026 [US4] "ANT+ broadcast" card in `src/api/web-src/src/app/settings/settings.component.html` and `.ts`: master switch, per-sensor switches (footpod, heart rate, power, treadmill), "also rebroadcast ANT+ heart rate/power" switches, status pill, device numbers, per-sensor note, "New device numbers" button (confirm first; watches must re-pair), restart hint when `needsRestart`, note that ANT+ is unencrypted
- [X] T027 [US4] Dashboard pill in `src/api/web-src/src/app/control/control.component.html` (and `.ts` if needed): "ANT+ broadcasting" / reason, hidden when off

**Checkpoint**: Runner can see why a watch doesn't find Zwifit (quickstart rows "Stick unplug", "Scan", "Off").

---

## Phase 5: User Story 2: Rebroadcast heart rate and power (P2)

**Goal**: ANT+ heart rate monitor (channel 4) and power meter (channel 5) carrying the merged values.

**Independent Test**: Fake stick + merged status with `hr: 140, hrSource: 'ble'` → HRM page 4 shows 140 and beat count advances; HR goes null → channel 4 closes; returns → reopens with the same number; `hrSource: 'ant'` → not opened unless `rebroadcastAnt.hr`.

### Tests first

- [X] T028 [P] [US2] Adapter tests in `test/unit/adapters/antBroadcast.test.js`: HRM channel 4 configured with device type 120, trans type 1, period 8070; power channel 5 with type 11, trans type 5, period 8182; open only while a valid value is present; close when it disappears and reopen on return with the same number; ANT-sourced values skipped by default and sent when `rebroadcastAnt.hr`/`.power` is on; status `note` texts "No heart rate right now" / "Heart rate comes from an ANT+ sensor; pair your device with it directly"

### Implementation

- [X] T029 [US2] Add HR and power profiles to `src/adapters/antBroadcast/index.js` (open/close on value presence, FR-006 source check); pass T028

**Checkpoint**: Watch shows the Bluetooth strap's HR and Stryd's power over ANT+ (quickstart "HR / power").

---

## Phase 6: User Story 3: Treadmill as ANT+ fitness equipment (P3)

**Goal**: ANT+ FE treadmill (channel 6) with speed, incline, distance, elapsed time, HR, cadence, climb; read-only.

**Independent Test**: Fake stick: set kph 10 and incline 3 → FE page 16 speed 2778 mm/s, page 17 incline 300; send acknowledged data (page 48–51 and 70) on channel 6 → nothing written in reply, treadmill `setTarget` never called.

### Tests first

- [X] T030 [P] [US3] Adapter tests in `test/unit/adapters/antBroadcast.test.js`: FE channel 6 configured with type 17, trans type 5, period 8192; pages follow speed/incline/time; climb accumulates from speed × incline; inbound `MESSAGE_CHANNEL_ACKNOWLEDGED_DATA` and broadcast data on channel 6 are ignored with no write and no treadmill call (FR-008, SC-006)
- [X] T031 [P] [US3] Integration test in `test/integration/antBroadcast.test.js`: with all four ticked on the fake stick, channels 3–6 are open and receive channels 0–2 still attached (FR-009); a burst of inbound control pages leaves treadmill speed and incline unchanged

### Implementation

- [X] T032 [US3] Add the treadmill (FE) profile to `src/adapters/antBroadcast/index.js`, and climb tracking in `src/core/antBroadcast/counters.js` if not already there; pass T030/T031

**Checkpoint**: All four profiles broadcast together from one stick.

---

## Phase 7: Polish & Cross-Cutting

- [X] T033 [P] README "ANT+ broadcast" section in `README.md`: what it sends, pairing a watch (footpod, HR, power, treadmill), scans pause it, unencrypted, same per-OS stick setup as ANT+ sensors
- [X] T034 [P] Update `specs/001-cross-platform-training-plans/contracts/adapters.md` with the `AntBroadcast` interface and the `AntSensors` `listen` / `'stick'` / `'stick-lost'` additions
- [X] T035 Rebuild the web UI (`npm run build:web` or `node scripts/build-web.js`) into `src/api/web-dist`
- [ ] T036 Run `npm test` with coverage; changed modules ≥ 80 % line and branch; `npm audit` shows no high or critical findings
- [ ] T037 Real-hardware check on the dev server's ANTUSB2 per quickstart.md (simulated treadmill): status reaches "Broadcasting"; ANT+ reception still works; a scan pauses and resumes the broadcast; record the results in quickstart.md

---

## Dependencies & Execution Order

- **Setup (T001–T005)** → **Foundational (T006–T013)** → stories.
- **US1 (T014–T018)** needs Foundational. It's the MVP.
- **US4 (T019–T027)** needs US1's adapter (T017).
- **US2 (T028–T029)** and **US3 (T030–T032)** need US1's adapter; independent of each other and of US4 (all edit `src/adapters/antBroadcast/index.js`, so run them one after another).
- **Polish** after the stories it documents.

## Parallel Opportunities

- Setup: T001, T002, T003, T005 in parallel; T004 after T001.
- Foundational tests T006–T009 in parallel; then T010–T012 in parallel; T013 separately.
- US1: T014, T015, T016 in parallel (different test cases/files), then T017 → T018.
- US4: T019, T020, T025 in parallel; T026 and T027 after T025.
- Polish: T033, T034 in parallel.

## Implementation Strategy

1. **MVP**: Setup + Foundational + US1 → footpod pace and distance on a watch. Validate with quickstart rows 1–5.
2. **+US4**: status, renumber and the Settings card make it usable without the log.
3. **+US2**: heart rate and power.
4. **+US3**: treadmill FE with incline.
5. Polish: README, rebuilt UI, coverage, hardware check.
