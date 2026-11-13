# Data Model: Cross-Platform Runtime, Refreshed UI & Training Plans

**Feature**: [spec.md](spec.md) | **Research**: [research.md](research.md)

Internal canonical units: speed in **km/h**, distance in **metres**, time in **seconds**, incline in
**percent**. Display and entry units are converted at the edges (`src/core/units.js`). All IDs are
random 128-bit values encoded as 26-char Crockford base32 strings. All timestamps are ISO 8601 UTC.

Storage paths are relative to the data directory from [research.md R7](research.md#r7-storage-location-and-format).

---

## Settings — `settings.json`

| Field | Type | Rules |
|-------|------|-------|
| `version` | integer | Schema version; current `2`. Version 1 = legacy `settings.conf`, migrated. |
| `metric` | boolean | Display/entry units. Existing field. |
| `treadmill.transport` | `"wifi"` \| `"ble"` \| `"simulated"` | Replaces legacy `ble` boolean. |
| `treadmill.ip`, `treadmill.lastIP` | string \| null | Wi-Fi only. Must be IPv4/hostname[:port]; no scheme, no path. |
| `treadmill.bleCode` | string \| null | BLE only. Exactly 4 hex chars. |
| `treadmill.bleActivation`, `bleDetails`, … | as today | Preserved verbatim from legacy file. |
| `speedOffset`, `speedMultiplier` | number | Existing calibration. Multiplier 0.5–1.5; offset −2…+2 km/h. |
| `fallbackKph` | number | Used when treadmill reports no current speed (Pro-Form). Within limits. |
| `limits.minKph` / `maxKph` | number | Defaults 0 / 20. `0 ≤ min < max ≤ 30`. |
| `limits.minIncline` / `maxIncline` | number | Defaults 0 / 15. `-10 ≤ min < max ≤ 40`. |
| `cooldownKph` | number | Default 3.2 km/h (≈2 mph). Must be within `limits`, `> 0`. |
| `broadcast.ftms`, `broadcast.rsc` | boolean | Existing `broadcastFTMS` / `broadcastRSC`. RSC carries the merged cadence (sensor or treadmill). |
| `broadcast.hr` | boolean, optional (missing = on) | Broadcast the merged heart rate (sensor or treadmill pulse) as a Bluetooth Heart Rate sensor (0x180D) at 1 Hz; nothing is sent while none is reported. Zwift ignores the heart rate inside FTMS. |
| `broadcast.power` | boolean, optional (missing = off) | Broadcast the merged running power as a Bluetooth Cycling Power sensor (0x1818); silent while no power is reported. |
| `broadcast.ftmsPower` | boolean, optional (missing = off) | Add running power to the FTMS Treadmill Data (force on belt 0 + power output). |
| `sensors.ant` | boolean, optional (missing = on) | Use a USB ANT+ stick. Applies after a restart. |
| `sensors.hrSource`, `sensors.cadenceSource` | `auto` \| `ant` \| `ble` \| `treadmill` \| `off` \| `sensor`, optional (missing = `auto`) | `auto`: ANT+, else Bluetooth, else the treadmill. `sensor` (older value): whichever sensor is newer. |
| `sensors.powerSource` | `auto` \| `ant` \| `ble` \| `off`, optional (missing = `auto`) | Power only comes from sensors. |
| `sensors.powerSmoothing` | `1` \| `3` \| `10`, optional (missing = 3) | Seconds power is averaged over. |
| `sensors.thresholdPower` | integer 50–1000 \| null | Running power threshold (e.g. Stryd critical power): dashed line on the power graph, "% threshold". |
| `sensors.weightKg` | number 30–250 \| null | Body weight, for W/kg. |
| `sensors.antDevices` | `{ hr?, cadence?, power? }`, each an integer 1–1048575 | ANT+ device numbers picked with `sensors:connect`; missing = first in range. Not writable through `settings:write`. |
| `sensors.bluetooth` | array (≤ 8) of `{ id, name: string(≤64) \| null, kinds: ("hr"\|"cadence"\|"power")[] }` | Bluetooth sensors picked with `sensors:connect`; reconnected whenever in range. Not writable through `settings:write`. |
| `server.port` | integer | Default 1337, 1024–65535. |
| `server.host` | string | Default `0.0.0.0`; `127.0.0.1` restricts to local machine. |
| `server.tls.certPath` / `keyPath` | string \| null | Optional HTTPS; both or neither. |

**Effective limits** = intersection of `limits` and limits reported by the treadmill adapter.

---

## Training Plan — `plans/<id>.json`

Exchanged/imported in the same shape — see [contracts/plan-file.schema.json](contracts/plan-file.schema.json).

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | Assigned by server; ignored on import (new id issued). |
| `schemaVersion` | integer | `1`. |
| `name` | string | 1–80 chars, trimmed, unique per user (case-insensitive); no control chars. |
| `description` | string | 0–500 chars. |
| `authoredUnits` | `"metric"` \| `"imperial"` | Informational. |
| `controlIncline` | boolean | Default `true`. When `false` the plan never sends incline, so Zwift's incline (or the console) keeps control. |
| `items` | array of `Step` \| `IntervalBlock` | 1–200 items; total expanded steps ≤ 2000. |
| `createdAt`, `updatedAt` | timestamp | Server-set. |

Derived (not stored): `totals.seconds`, `totals.metres`, `totals.estimated` (true when any
distance step's duration or time step's distance must be estimated from target speed).

### Step

| Field | Type | Rules |
|-------|------|-------|
| `kind` | `"step"` | Discriminator. |
| `id` | string | Unique within plan. |
| `label` | string | 0–40 chars. |
| `targetKph` | number | Canonical speed. Within effective limits; `> 0` (a zero-speed step is not allowed — use stop). |
| `entered` | object | How the user typed the speed: `{ form: "speed" \| "pace", unit: "mph" \| "kph" \| "min/mi" \| "min/km", value: number \| "m:ss" }`. Must round-trip to `targetKph` within 0.05 km/h. |
| `targetIncline` | number | Within effective limits, 0.5 % resolution. |
| `end` | object | `{ type: "time", seconds: 1–21600 }` or `{ type: "distance", metres: 10–100000 }`. |

### IntervalBlock

| Field | Type | Rules |
|-------|------|-------|
| `kind` | `"block"` | Discriminator. |
| `id` | string | Unique within plan. |
| `label` | string | 0–40 chars. |
| `repeat` | integer | 1–99. |
| `steps` | array of `Step` | 1–20 steps; blocks do **not** nest. |

Validation runs on save, import, load from disk, and immediately before playback starts (limits may
have changed since saving). Failures return a list of `{ path, code, message }` (e.g.
`items[2].steps[0].targetKph`, `ABOVE_MAX_SPEED`).

---

## Playback Session (in memory, single instance)

| Field | Type | Notes |
|-------|------|-------|
| `planId`, `planSnapshot` | string, Plan | Snapshot taken at start; edits to the plan don't affect a running session. |
| `state` | enum | See state machine. |
| `cursor` | `{ itemIndex, repetition, stepIndex, flatIndex }` | Position in expanded sequence. |
| `stepElapsed` | `{ seconds, metres }` | Frozen while paused. |
| `planElapsed` | `{ seconds, metres }` | |
| `override` | `{ kph?, incline? }` \| null | Manual change for remainder of step (FR-019). Cleared on step change. |
| `endReason` | enum \| null | `completed`, `userStopped`, `connectionLost`, `treadmillStopped`, `appRestart`. |
| `workoutId` | string | Recorder target. |
| `controllerDeviceId` | string | Paired device that started it (for audit only — any paired device may control). |

### State machine

```text
            start (paired, belt moving, limits OK)
  idle ───────────────────────────────────────────▶ running
   ▲                                                │  │  │
   │               pause → send stop                │  │  │ last step done →
   │      ┌─────────────────────────────────────────┘  │  │ send cooldownKph @ 0%
   │      ▼                                            │  ▼
   │   paused ── resume (explicit, paired) ──▶ running │ completed ──▶ idle
   │      │       (send step targets; if adapter       │
   │      │        canResume=false, wait for belt)     │
   │      │                                            │
   │      └──── stop / connection lost ─────┐          │ stop / connection lost /
   │                                        ▼          ▼ treadmill stopped
   └─────────────────────────────────── ended(reason) ◀┘
```

Rules:

- `start` is refused unless state is `idle`, the treadmill is connected, belt speed > 0 (the plan
  waits with a "Start the belt on your treadmill" message), and the plan passes validation.
- No transition from `paused` to `running` other than an explicit `resume` from a paired device.
- After `ended` or `completed` **no further commands** are emitted by the engine (SC-005).
- On process start the state is always `idle`; a workout left `running` on disk is closed with
  `appRestart`.

---

## Workout — `workouts/<id>.json` + `workouts/<id>.samples.ndjson`

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | |
| `planId`, `planName`, `planSnapshot` | | Snapshot so history is stable if plan is edited/deleted. |
| `startedAt`, `endedAt` | timestamp | `endedAt` null while running. |
| `endReason` | enum | As playback. |
| `totals` | `{ seconds, metres, avgHr?, maxHr?, avgCadence?, avgPower?, maxPower? }` | Each field absent when no sample had that reading. |
| `steps` | array of StepResult | One per expanded step actually reached. |

### StepResult

`{ flatIndex, label, repetition, target: { kph, incline }, actual: { avgKph, avgIncline }, seconds,
metres, avgHr?, maxHr?, avgCadence?, avgPower?, overridden: boolean, skipped: boolean }`

### Sample (one NDJSON line, every 1 s while running or paused)

`{ t: timestamp, kph: number, incline: number, metres: number, hr: number | null, flatIndex:
integer, event?: "step" | "override" | "pause" | "resume" | "end", estimated?: true,
cadence?: number, power?: number }`

- `hr` is `null` when no source reports one or it is 0 (FR-019c). `cadence` (steps/min) and
  `power` (watts) are present only when reported and above 0.
- Samples are appended and flushed each second; on crash the summary is rebuilt from samples at
  next start (FR-019e).
- Deleting a workout removes both files.

---

## Paired Device — `devices.json`

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | |
| `name` | string | 1–40 chars, from user agent or user-entered; HTML-escaped on display. |
| `tokenHash` | string | SHA-256 hex of the device token. Token itself never stored. |
| `pairedAt`, `lastSeenAt` | timestamp | `lastSeenAt` updated at most once per minute. |
| `expiresAt` | timestamp | `lastSeenAt + 90 days`. Expired entries pruned on load. |
| `ip` | string? | Address it paired from / last used its cookie from (IPv4 without `::ffff:`). |
| `trustedIp` | string? | Set by "Trust address": requests from this address without a valid cookie count as this device (for browsers that won't keep cookies). Cleared by "Untrust"; removing the device ends it. |

## Pairing code — `pairing.json`

`{ version: 1, codeHash, createdAt, suspended, expiresAt?, singleUse?, usedAt? }`. A code asked for in Settings has `expiresAt` (10 minutes) and `singleUse`; once used, `codeHash` is `null`. Kept separate from `devices.json` and re-read on
every pairing attempt, so `npm run pair` (a separate process) takes effect while the app runs. The
code itself is never stored; it is printed to the console once. `suspended` is set when the global
failure cap is hit and cleared by a new code, so a restart doesn't lift it. Per-IP failure counts
and lockouts are held in memory only (`src/security/rateLimit.js`).

---

## Training Program — `programs/<id>.json`

| Field | Type | Notes |
|-------|------|-------|
| `id`, `schemaVersion` (1), `createdAt` | | Server-set. |
| `name` | string | Default "<Goal> · <weeks> weeks". |
| `goal` | `5k` \| `10k` \| `half` \| `marathon` | |
| `weeks`, `raceDate`, `startDate` | | Week 1 starts on the Monday `weeks − 1` weeks before race week. |
| `runDays`, `easyKph`, `incline` | | As entered. |
| `days` | array | `{ date, week, weekday, type, phase, title, description, items, planId? }`; `items` as a plan's. `done` / `workoutId` are derived on read. |

Generated by `src/core/programs/generate.js` (research R18).

---

## Treadmill Status (in memory, broadcast to paired clients)

`{ transport, connected, reason?, kph, incline, metres, seconds, hr | null, hrSource, cadence?,
cadenceSource?, power?, powerSource?, estimatedSpeed: boolean, limits, capabilities: { canControl,
canPause, canResume } }` — merged with sensor readings (contracts/api.md `status`).

## Sensor status (in memory)

ANT+ and Bluetooth sensor state, scan results and remembered connections: see
[contracts/api.md](contracts/api.md#sensor-status-shapes). Not stored, except the chosen sensors
in `settings.sensors`.

## Browser preferences (localStorage / sessionStorage, per browser)

| Key | Value | Notes |
|---|---|---|
| `zwifit.theme` | `dark` (default) | `light` | `system` | |
| `zwifit.maxHr` | integer 120–230, default 190 | Heart-rate zones: Z1 < 60 %, Z2 60–70, Z3 70–80, Z4 80–90, Z5 ≥ 90 % of it. |
| `zwifit.hrHistory` (session storage) | up to 3 h of 1 s samples `{ t, bpm, w?, kph?, c?, inc? }` | Feeds the live graphs, sparklines and zone times; survives a reload, never sent to the server. |

## Broadcast Status (in memory)

`{ available, reason?, poweredOn, advertising, clients: integer }` — `reason` examples:
`"No Bluetooth adapter found. Under WSL, run scripts/wsl/attach-bluetooth.ps1"`.

## Zwift Device (zwift-devices.json)

| Field | Type | Notes |
|---|---|---|
| `address` | string `xx:xx:xx:xx:xx:xx` (lower case) | Bluetooth address of a client of the broadcast. Phones and Apple TVs may use a private address that changes, so one device can appear more than once. |
| `name` | string, 1–40 chars | `Bluetooth device ··5A:10` until the user renames it. |
| `named` | boolean | True once renamed. |
| `firstSeenAt`, `lastSeenAt` | ISO time | |
| `services` | string[] | Services it has read: `Fitness Machine`, `Footpod`, `Heart Rate`, `Power`. |
 most 20 are kept, newest first.
