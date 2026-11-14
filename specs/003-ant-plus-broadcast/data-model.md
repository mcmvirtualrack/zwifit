# Data Model: ANT+ Broadcast

## AntBroadcastSettings (`settings.antBroadcast`, persisted in settings.json)

| Field | Type | Default | Rules |
|---|---|---|---|
| `enabled` | boolean | `false` | Master switch (FR-001). Independent of `broadcast.*` (Bluetooth) and `sensors.ant`. |
| `footpod` | boolean | `true` | Broadcast as an ANT+ footpod (SDM). |
| `hr` | boolean | `true` | Broadcast as an ANT+ heart rate monitor. |
| `power` | boolean | `true` | Broadcast as an ANT+ power meter. |
| `treadmill` | boolean | `true` | Broadcast as ANT+ fitness equipment (treadmill). |
| `rebroadcastAnt` | `{ hr: boolean, power: boolean }` | both `false` | Rebroadcast a value whose source is itself an ANT+ sensor (FR-006). |
| `deviceNumbers` | `{ footpod, hr, power, treadmill }` | created on first use | Integers 1–65 535. Not writable through `settings:write`; changed only by `ant-broadcast:renumber`. |

Missing `antBroadcast` = all defaults (existing installs behave as before).

## BroadcastInput (in memory, from the merged treadmill status at each update)

| Field | Source | Valid range (else treated as missing) |
|---|---|---|
| `kph` | `status.kph` when `status.connected`, else 0 | 0–30 and ≤ treadmill max |
| `incline` | `status.incline` when connected, else 0 | −10 to 40 % |
| `hr`, `hrSource` | merged status | 30–250 bpm |
| `cadence` (steps/min) | merged status | 1–300 |
| `power`, `powerSource` | merged status (already smoothed) | 0–2500 W |
| `at` | clock | monotonic ms |

## BroadcastCounters (pure state per sensor, `src/core/antBroadcast/counters.js`)

| Sensor | Counters (all wrap at the profile width) |
|---|---|
| Footpod | `metres` (float, sent mod 256 with 1/16 m), `seconds` (1/200 s, mod 256 s), `strides` (mod 256), message count |
| Heart rate | `beatTime` (1/1024 s, mod 65 536), previous beat time, `beats` (mod 256), message count, toggle |
| Power | `events` (mod 256), `accumulatedPower` (W, mod 65 536), message count |
| Treadmill | `elapsed` (0.25 s, mod 256), `metres` (mod 256), `climb` (0.1 m, mod 256), message count, lap toggle |

Rules: counters advance only while their sensor is broadcasting and (for distance and time)
while the belt moves. They never reset while Zwifit runs, so a treadmill reconnect continues
from the same values.

## TransmitChannel (adapter state, `src/adapters/antBroadcast/index.js`)

| Field | Values |
|---|---|
| `kind` | `footpod` · `hr` · `power` · `treadmill` |
| `channel` | 3 · 4 · 5 · 6 |
| `deviceNumber` | from settings |
| `state` | `closed` → `opening` → `open` → `closing` → `closed` |

Transitions: open when the broadcast is enabled, the kind is ticked, a stick is ready and (HR or
power) a valid value is present and allowed by `rebroadcastAnt`. Close on any of those
becoming false, on stick loss (no writes, state reset) and on stop. A device number change
closes and reopens the channel.

## AntBroadcastStatus (pushed in `status.antBroadcast`)

```text
{
  state: "off" | "starting" | "broadcasting" | "paused" | "error",
  reason?: string,                // why not broadcasting, with the fix (no paths, no stack)
  needsRestart?: boolean,         // turned on while the stick isn't opened (R2)
  sensors: [{ kind, deviceNumber, sending: boolean, note?: string }]
}
```

`note` explains a ticked sensor that isn't sending, e.g. "No heart rate right now" or "Heart rate
comes from an ANT+ sensor; pair your device with it directly".
