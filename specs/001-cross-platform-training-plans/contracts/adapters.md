# Contract: Hardware & Platform Adapters

Constitution Principle IV: all Bluetooth, Wi-Fi and OS-specific code lives behind these interfaces.
Core logic (`src/core/**`) imports only these interfaces, never `noble`, `bleno`, `websocket` or
`os`. Every adapter has a test double used by the test suite.

## TreadmillAdapter

Implementations: `wifi` (iFit WebSocket, from `src/ifit.js`), `ble` (iFit BLE, from
`src/ble/ifit`), `simulated` (deterministic, for tests and `npm run start:sim`).

```text
interface TreadmillAdapter extends EventEmitter
  readonly transport: "wifi" | "ble" | "simulated"
  readonly capabilities: { canControl: boolean, canPause: boolean, canResume: boolean }

  start(): Promise<void>          // begin connecting; never throws for hardware absence
  stop(): Promise<void>           // release hardware, clear timers
  limits(): { minKph, maxKph, minIncline, maxIncline } | null   // reported by machine, if any

  // Commands. Each validates against limits() and REJECTS (never clamps) out-of-range input.
  setTarget({ kph?: number, incline?: number }): Promise<void>
  pauseBelt(): Promise<void>      // bring belt to stop
  resumeBelt(): Promise<void>     // restart belt; rejects RESUME_UNSUPPORTED when !canResume

  events:
    "status"   { connected, reason?, kph, incline, hr | null, estimatedSpeed, mode? }
    "connected"
    "disconnected" { reason }
    "error"    { code, message }   // message is safe to show; no secrets
```

Rules:

- Speeds passed in and emitted are **km/h** (conversion to the machine's units is internal).
- `hr` is `null` when absent or 0.
- `estimatedSpeed: true` when the machine doesn't report current speed and `fallbackKph` is used.
- Must not touch global `events` bus or settings directly; configuration is injected at
  construction.

## BroadcastAdapter (Zwift-facing)

Implementations: `bleno` (FTMS + RSC services, from `src/bluetooth`), `null` (tests / no adapter).

```text
interface BroadcastAdapter extends EventEmitter
  start(): Promise<void>       // resolves even if no adapter; status reports why
  stop(): Promise<void>
  update({ kph, incline, hr | null, cadence?, power? }): void   // merged status; sent at 5 Hz
  events:
    "status" { available, reason?, poweredOn, advertising, clients, devices: [{ address, services[] }] }
    "client" { address, services[] }   // remembered in zwift-devices.json
```

GATT services, each from `settings.broadcast` (read once at start):

| Service | Switch | Carries |
|---|---|---|
| Fitness Machine 0x1826 (Treadmill Data 0x2ACD, Feature 0x2ACC) | `ftms` | Speed, incline (ramped); heart rate; with `ftmsPower`, flag bit 12 + force 0 + power (feature bit 14 set). |
| Running Speed and Cadence 0x1814 (0x2A53) | `rsc` | Speed and the merged cadence (steps/min). |
| Heart Rate 0x180D (0x2A37) | `hr` (missing = on) | Merged heart rate once a second; nothing while none. |
| Cycling Power 0x1818 (Measurement 0x2A63, Feature 0x2A65, Location 0x2A5D) | `power` (missing = off) | Merged running power, flags 0; nothing while none. |

## Sensor adapters (ANT+ and Bluetooth)

```text
interface SensorSource extends EventEmitter      // AntSensors (src/adapters/sensors/ant.js),
                                                  // BleSensors (src/adapters/sensors/ble.js)
  start(): Promise<void>      // never throws for missing hardware; status says why
  stop(): Promise<void>
  latest(kind): { value, deviceId, at } | null    // kind: "hr" | "cadence" | "power"
  status(): AntStatus | BluetoothSensorsStatus     // see api.md
  startScan(): { endsAt }     // throws AppError SENSORS_UNAVAILABLE
  describe(id): { id, kinds, name }                // throws NOT_FOUND unless heard / in use
  AntSensors.reconnect()      // reopen the stick with settings.sensors.antDevices
  BleSensors.refresh()        // connect newly remembered, drop forgotten
  events:
    "reading" { kind, value, deviceId }
    "status"  status()
```

- **AntSensors**: one Garmin USB2/USB-m or USB3 stick; channels 0 heart rate, 1 stride-based speed
  and distance (cadence × 2 = steps/min), 2 power; device number 0 (first in range) unless chosen.
  A scan releases the stick, reopens it with the library's scanners for 15 s, then reopens the
  channels. The stick is released without the library's USB reset (usbip under WSL). Stick loss
  (endpoint error or USB detach) is noticed and retried every 10 s. Manufacturer and battery come
  from the common data pages.
- **BleSensors**: noble, loaded only when a Bluetooth scan or a remembered sensor needs it.
  Discovers peripherals advertising 0x180D / 0x1818 / 0x1814, connects only remembered ones,
  subscribes to 0x2A37 / 0x2A63 / 0x2A53, reads Battery Level 0x2A19 once. Missing remembered
  sensors are searched for 8 s every 30 s; connections time out after 15 s.
- **SensorHub** (`src/adapters/sensors/hub.js`): combines both; `latest(kind)` = the newest,
  `latestFrom(kind, "ant" | "ble")`, `status()` = `{ ant, bluetooth }`, re-emits readings tagged
  with `source`.
- **MergedTreadmill** (`src/core/sensorMerge.js`): wraps the treadmill adapter and fills
  `hr` / `cadence` / `power` and their `*Source` per settings (api.md `status`); power is averaged
  over `powerSmoothing` seconds per source.
- **Scan lease** (`src/adapters/bleScanLease.js`): one Bluetooth scan shared by the BLE treadmill
  and BLE sensors (`acquire(owner)` / `release(owner)`; scanning with duplicates while anyone holds
  it and the adapter is on), so one never stops the other's search.

## Platform services

```text
paths.dataDir(): string        // per OS, see research R7; honours ZWIFIT_DATA_DIR
paths.legacyDir(): string      // repository root, for settings.conf/routes.conf migration
clock.now(): number            // injected so playback/recorder are testable with fake time
```

## Loading rules

- Native modules are required lazily inside `start()` within try/catch. Failure produces
  `status.available = false` with a user-actionable `reason` (FR-004, FR-006b).
- Adapter selection comes from `settings.treadmill.transport` or `--simulate` /
  `ZWIFIT_SIMULATE=1`.
