# Contract: Control Server API (HTTP + Socket.IO)

Server: Express 5 + Socket.IO 4 on `server.host:server.port` (default `0.0.0.0:1337`).
All JSON bodies are validated against JSON Schemas in `src/contracts/schemas/` before any handler
runs. Entity shapes are defined in [../data-model.md](../data-model.md).

## Common rules

| Rule | Applies to |
|------|-----------|
| **Auth**: valid `zwifit_device` cookie (hash matches a non-expired Paired Device). Otherwise `401 { error: "NOT_PAIRED" }`. Renews `lastSeenAt`. | Everything except the *Public* rows below |
| **Origin**: `Origin` header (or `Referer` when absent) must equal the server's own scheme+host+port. Otherwise `403 { error: "BAD_ORIGIN" }`. | All non-GET HTTP, Socket.IO handshake |
| **Body size**: 256 KB (1 MB on `/api/plans/import`). Otherwise `413`. | All bodies |
| **Errors**: `{ error: CODE, message: string, details?: [{ path, code, message }] }`. Never stack traces, file paths or tokens. | All |
| **Headers**: `Content-Security-Policy: default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on `/api/*`. | All responses |

## HTTP endpoints

| Method & path | Access | Request | Response |
|---------------|--------|---------|----------|
| `GET /` and static assets | Public | — | Web app shell (contains no data). |
| `GET /api/session` | Public | — | `{ paired: boolean, deviceName?: string }` |
| `POST /api/pair` | Public (rate-limited) | `{ code: string(8), deviceName?: string(1–40) }` | `204` + `Set-Cookie: zwifit_device=…; HttpOnly; SameSite=Strict; Path=/; Max-Age=7776000[; Secure]`. Wrong code → `401 BAD_CODE`. Locked out → `429 { retryAfterSeconds }`. |
| `POST /api/unpair` | Paired | — | `204`, cookie cleared, device removed. |
| `GET /api/devices` | Paired | — | `[{ id, name, pairedAt, lastSeenAt, expiresAt, current: boolean }]` |
| `POST /api/devices` | Paired, same Origin | `{ name (1–40), ip }` (an IPv4 / IPv6 address) | `201` with the device: a client let in by its address with no pairing (trusted at `ip`). `422 INVALID` bad name or address, `409 ADDRESS_TAKEN` if another device is trusted there. |
| `PATCH /api/devices/:id` | Paired, same Origin | `{ name?, ip?, trusted? }` (at least one; name 1–40 chars; `ip` changes the device's address, and its trusted address if trusted) | `200` with the device (no token hash; includes `ip` and `trusted`); `422` bad body or `NO_ADDRESS` (trusting a device whose address is not known yet), `404` unknown. `trusted: true` pins the device's last address: requests from it without a valid cookie count as this device (HTTP and live socket); a valid cookie always wins. Devices paired without a name are named from their User-Agent (e.g. "iPhone · Safari"); old "Device" entries are renamed that way on their next `GET /api/session`. |
| `DELETE /api/devices/:id` | Paired | — | `204`. Revoked device's sockets disconnected immediately. |
| `POST /api/pairing-code` | Paired | — | `200 { code: "XXXX-XXXX", expiresAt }`: a new code, also printed to the console, shown in Settings → Paired devices to pair another device. It pairs **one** device and expires after 10 minutes; the previous code stops working. (`npm run pair` codes are console-only, reusable and do not expire.) |
| `GET /api/plans/:id/export` | Paired | — | `application/json` attachment, plan-file schema; `Content-Disposition: attachment; filename="<safe-name>.zwifit-plan.json"` |
| `POST /api/plans/import` | Paired | plan-file JSON | `201 { id }` or `422` with `details`. |
| `GET /api/workouts/:id/export.csv` | Paired | — | `text/csv; charset=utf-8` attachment per [workout-export-csv.md](workout-export-csv.md). |
| `GET /api/workouts/:id/export.fit` | Paired | — | `application/vnd.ant.fit` attachment: a FIT activity (file_id, device_info, event, one `record` per sample with heart rate, cadence in strides/min, distance, speed, power and grade; one `lap` per step and a `session` with averages and maxima, incl. `avgPower`/`maxPower`). For Garmin Connect, Strava and similar (FR-019g). |

`:id` must match `^[0-9A-HJKMNP-TV-Z]{26}$`, otherwise `400`.

## Socket.IO

Namespace `/`. Handshake rejected (`connect_error` `NOT_PAIRED` / `BAD_ORIGIN`) unless the common
rules pass. Revoking or expiring a device disconnects its sockets.

### Client → server (`emit(event, payload, ack)`)

Every command returns via `ack({ ok: true, data? } | { ok: false, error, details? })`.
Unknown events are dropped and logged (event name only). Max 20 commands/second per socket.

| Event | Payload | Effect |
|-------|---------|--------|
| `control:set` | `{ kph?: number, incline?: number }` (at least one) | Manual change. Rejected `OUT_OF_RANGE` if outside effective limits. During playback becomes `override`. |
| `control:start` | none | Dashboard Start: restarts the belt (`resumeBelt`). Refused `RESUME_UNSUPPORTED` when the treadmill must be started from its console (iFit Wi-Fi), `PLAN_RUNNING` while a plan is active. |
| `control:stop` | none | Dashboard Stop / Pause: ends an active plan (saved as stopped by the user), then stops the belt (`pauseBelt`). A free run is only paused; it carries on with Start or the console. |
| `control:finish` | none | Finishes the free run: saved to History as completed, then the belt is stopped (best effort). Refused `NO_FREE_RUN` when none is going. |
| `zwift-devices:list` | none | Devices remembered from earlier Zwift broadcast connections (newest first, at most 20): `{ address, name, named, firstSeenAt, lastSeenAt, services[] }`. Live ones are in `status.broadcast.devices`. |
| `zwift-devices:rename` | `{ address, name }` (1–40 chars) | Names a remembered device; emits `zwift-devices:changed`. |
| `zwift-devices:forget` | `{ address }` | Removes a remembered device; emits `zwift-devices:changed`. |
| `settings:write` | partial Settings, allow-listed by `settings-write.schema.json`: units, transport/IP/BLE code, calibration, fallback and cool-down speed, limits, broadcast toggles (`ftms`, `rsc`, `hr`, `power`, `ftmsPower`), sensor settings (`ant`, `bluetoothWithZwift`, `hrSource`, `cadenceSource`, `powerSource`, `powerSmoothing`, `thresholdPower`, `weightKg`), `server.port` and `server.host` (one of `0.0.0.0`, `127.0.0.1`, `::`, `::1`; applies after restart). BLE internals, TLS file paths and the chosen sensors (`sensors.antDevices`, `sensors.bluetooth`, set only through `sensors:*`) are not writable here. The schema is loaded when Zwifit starts: after an update, restart Zwifit before saving from a refreshed page, or new fields are refused `INVALID` ("… is not allowed here"). | Validates, saves, broadcasts `settings`. |
| `sensors:scan` | `{ transport: "ant" \| "bluetooth" }` | Lists sensors in range for 15 s; results arrive in `status.sensors.<ant\|bluetooth>.found`. ANT+ closes its sensor channels while scanning (the stick cannot scan and listen at once) and reopens them after; the sensor already in use keeps reporting. `ack` `{ endsAt }`. Refused `SENSORS_UNAVAILABLE` (with the reason) without a stick / adapter. |
| `sensors:connect` | `{ transport, id }` (`id` `^[0-9A-Za-z:_-]{1,64}$`) | Use this sensor from now on. ANT+: its device number is saved in `sensors.antDevices` for every kind it measures and the stick reopens with it. Bluetooth: added to `sensors.bluetooth` (at most 8, `LIMIT` otherwise) and connected. `NOT_FOUND` if it was not heard. Emits `settings`. `ack` `{ id, kinds, name }`. |
| `sensors:rename` | `{ transport, id, name }` (name ≤ 40 chars; empty removes it) | Custom name for an ANT+ or Bluetooth device, kept in `sensors.names["<transport>:<id>"]` (at most 64). Emits `settings`. |
| `sensors:forget` | `{ transport, id }` | Stop using it: ANT+ goes back to the first sensor in range; a Bluetooth sensor is disconnected and removed. Emits `settings`. |
| `programs:preview` | `{ goal: "5k"\|"10k"\|"half"\|"marathon", weeks: 6–24, raceDate: "YYYY-MM-DD", runDays: [0–6] (3–6, Monday = 0), easyKph: 3–20, incline?: 0–15, name?: 1–60 }` | Generates a program without saving (`programs-input.schema.json`). Race date from today to two years ahead, else `INVALID`. |
| `programs:create` | as `programs:preview` | Generates and saves; emits `programs:changed`. `ack` with the program. |
| `programs:createCustom` | `{ name: 1–80, startDate: "YYYY-MM-DD", weeks: 1–52, days: [{ week, weekday: 0–6 (Monday = 0), planId }] (≤ 364) }` (`programs-custom.schema.json`) | Builds the user's own program (`goal: "custom"`, `raceDate: null`); week 1 starts on the Monday of `startDate`; each day copies its plan's steps and keeps `sourcePlanId`. `INVALID` for a day after the last week or two on one day; `NOT_FOUND` for a missing plan. Emits `programs:changed`. |
| `programs:updateCustom` | as `programs:createCustom` plus `id` | Replaces a custom program (refused `INVALID` for a generated one); days with the same plan on the same date keep their saved plan and progress. |
| `programs:list` | — | `[{ id, name, goal, weeks, raceDate, startDate, runs, done }]`, newest first. |
| `programs:get` | `{ id }` | The program; each day with `done` and `workoutId` (from the workouts of its plan). |
| `programs:start` | `{ id, date }` | Saves the day's run as a plan the first time (emits `plans:changed`), then starts it like `playback:start`. |
| `programs:delete` | `{ id }` | Removes the program; plans and workouts made from it stay. |
| `treadmill:console` | `{ after?: integer }` | Settings → Console readout / output: `{ transport, connected?, speedKey, calibrated, fields: [{ key, value, at }], log: [{ seq, at, dir: "in"|"out", text }], logSeq }`. `log` holds the raw WebSocket messages after sequence number `after` (last 300 kept, each ≤ 2000 chars): `in` from the console, `out` the commands Zwifit sent;, every field the Wi-Fi console sent (latest value as sent, as text ≤ 40 chars, at most 80 fields) and the field Zwifit reads speed from (`Current KPH`/`Current MPH` once the console sends one, else `KPH`/`MPH`). Simulated: the same shape from its values; Bluetooth: no fields. Polled once a second by the page. |
| `server:restart` | none | Restarts Zwifit (Settings → Restart Zwifit): it stops cleanly and the supervisor started by `npm start` (`app.js`) starts it again in the same terminal; clients reconnect by themselves. Refused `PLAN_RUNNING` while a plan is active, `RESTART_UNSUPPORTED` when run without the supervisor (`ZWIFIT_NO_SUPERVISOR=1`). `ack` `{ restarting: true }`. |
| `plans:list` | — | `ack` with `[{ id, name, totals, updatedAt }]` |
| `plans:get` | `{ id }` | `ack` with Plan |
| `plans:save` | Plan (without `createdAt`/`updatedAt`; `id` absent = create) | Validates (incl. limits), saves. |
| `plans:duplicate` | `{ id, name? }` | New plan. |
| `plans:delete` | `{ id }` | Refused `PLAN_RUNNING` if it is the running plan. |
| `playback:start` | `{ planId }` | Refused `ALREADY_RUNNING`, `NOT_CONNECTED`, `BELT_STOPPED` (with wait), `INVALID_PLAN`. |
| `playback:pause` | — | running → paused, sends stop. |
| `playback:resume` | — | paused → running, sends targets. `RESUME_REFUSED` if treadmill won't start. |
| `playback:skip` | — | Advance to next step (or complete). |
| `playback:stop` | — | → ended(`userStopped`). |
| `workouts:list` | `{ before?: timestamp, limit?: 1–100 }` | Summaries, newest first. |
| `workouts:get` | `{ id }` | Workout with step results (not samples). |
| `workouts:samples` | `{ id, fromIndex?, limit?: ≤ 3600 }` | Paged samples. |
| `workouts:delete` | `{ id }` | Removes files. |

### Server → client

| Event | Payload | When |
|-------|---------|------|
| `status` | `{ treadmill: TreadmillStatus, broadcast: BroadcastStatus, sensors: { ant: AntStatus, bluetooth: BluetoothSensorsStatus } }` (below). `treadmill.hr` / `cadence` / `power` are merged per `settings.sensors` (see [data-model.md](../data-model.md#settings--settingsjson)): `auto` = a fresh ANT+ reading, else a fresh Bluetooth one, else the treadmill's own (heart rate, cadence); `ant` / `ble` / `treadmill` = only that one; `off` = none. A reading counts while under 5 s old; a disconnected treadmill's own heart rate and cadence are ignored. `hrSource` / `cadenceSource` / `powerSource` (`ant` \| `ble` \| `treadmill`) say where each value came from. `power` (watts, averaged over `powerSmoothing` s) is present only while a power sensor reports. `treadmill.speedSource` (`measured` \| `set` \| `estimated`) says whether `kph` is the measured belt speed. `freeRun`: `{ state: "idle" \| "running" \| "paused", startedAt?, seconds?, metres? }` for a run without a plan. | On connect, on change, and at 1 Hz while belt moving. |
| `settings` | Settings (secrets/BLE internals omitted) | On connect and after save. |
| `playback` | `{ state, planId, planName, cursor, current: Step, next?: Step, stepRemaining, planRemaining, override, endReason?, message? }` | On connect, on any state change, 1 Hz while running. Same to all clients (FR-018). |
| `plans:changed` | `{ id, deleted?: true }` | After any plan mutation. |
| `programs:changed` | `{ id, deleted?: true }` | After a program is created, deleted, or a day gets its plan. |
| `workouts:changed` | `{ id, deleted?: true }` | After a workout ends or is deleted. |
| `zwift-devices:changed` | `{}` | After a device connects to the broadcast or is renamed / forgotten. |

### Sensor status shapes

```text
AntStatus {
  available: boolean, reason?: string            // e.g. "No ANT+ USB stick found. Under WSL, run …"
  devices: [{ kind: "hr"|"cadence"|"power", deviceId: number, value, lastSeenAt,
              manufacturer?: "Garmin"|"Stryd"|…, battery?: "82%"|"good"|… }]   // latest per kind
  scan:  { active: boolean, endsAt?: ISO time, reason?: string, lastAt?: ISO time }  // lastAt: last scan's start
  found: [{ id: "31877", kinds: [...], values: { hr?, cadence?, power? }, rssi: number|null,
            manufacturer: string|null, lastSeenAt: ISO time, battery? }]   // heard in the last scan
            // (kept until the next one), strongest first
}

BluetoothSensorsStatus {
  available: boolean, reason?: string            // e.g. "The Bluetooth adapter is off or missing."
  devices: [{ kind, deviceId: string, value, lastSeenAt }]
  scan:  { active: boolean, endsAt? }
  found: [{ id, name: string|null, kinds, rssi, values, battery? }]
  connections: [{ id, name, kinds, state: "connected"|"connecting"|"searching", battery? }]   // remembered
}
```

Readings outside 0–250 bpm, 0–250 spm or 0–2500 W are dropped. A Stryd shows as one ANT+ device
(same device number) with `kinds: ["power", "cadence"]`.

## Replaced legacy messages

The legacy `message` event with `{ event: 'control' | 'writeSettings' | 'writeRoutes' }` is
removed. Its unauthenticated `writeSettings` (which accepted any keys via `fromJSON`) is the main
vulnerability this contract closes.
