# Contract: Settings, Socket API and Adapter for ANT+ Broadcast

Extends `specs/001-cross-platform-training-plans/contracts/api.md` and `adapters.md`. All
socket messages require a paired device (FR-013), like the rest of Settings.

## Settings (`settings.schema.json`, new property)

```json
"antBroadcast": {
  "type": "object", "additionalProperties": false,
  "properties": {
    "enabled":   { "type": "boolean" },
    "footpod":   { "type": "boolean" },
    "hr":        { "type": "boolean" },
    "power":     { "type": "boolean" },
    "treadmill": { "type": "boolean" },
    "rebroadcastAnt": {
      "type": "object", "additionalProperties": false,
      "properties": { "hr": { "type": "boolean" }, "power": { "type": "boolean" } }
    },
    "deviceNumbers": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "footpod":   { "$ref": "#/$defs/antBroadcastNumber" },
        "hr":        { "$ref": "#/$defs/antBroadcastNumber" },
        "power":     { "$ref": "#/$defs/antBroadcastNumber" },
        "treadmill": { "$ref": "#/$defs/antBroadcastNumber" }
      }
    }
  }
}
"$defs/antBroadcastNumber": { "type": "integer", "minimum": 1, "maximum": 65535 }
```

`settings-write.schema.json` accepts the same object **without** `deviceNumbers` (rejected as
`UNKNOWN_PROPERTY`), with `minProperties: 1`.

## Socket messages

| Direction | Name | Schema | Payload → Reply |
|---|---|---|---|
| client → server | `settings:write` | `settings-write` | `{ antBroadcast: { enabled?, footpod?, hr?, power?, treadmill?, rebroadcastAnt? } }` → public settings view |
| client → server | `ant-broadcast:renumber` | `ant-broadcast-renumber` (`{}` only, `additionalProperties: false`) | `{}` → `{ deviceNumbers: { footpod, hr, power, treadmill } }`, and `settings` is pushed to all clients |
| server → client | `status` | – | adds `antBroadcast: AntBroadcastStatus` (see data-model.md) |

Errors use the existing `{ code, message, details? }` shape; no stack traces or paths.

## Adapter: `AntBroadcast` (`src/adapters/antBroadcast/index.js`)

```text
class AntBroadcast extends EventEmitter
  constructor({ host, getSettings, saveDeviceNumbers, loadAnt?, now?, randomInt? })
    host: the AntSensors instance (or null when no stick is used) — emits 'stick'/'stick-lost'
  start(): Promise<void>      // never throws for missing hardware; status says why
  stop(): Promise<void>       // closes and unassigns channels 3–6; stick stays with host
  update(mergedStatus): void  // latest values; encoded on the next EVENT_TX per channel
  renumber(): Promise<deviceNumbers>
  status(): AntBroadcastStatus
  events: "status" AntBroadcastStatus (on change only)
```

## Changes to `AntSensors` (`src/adapters/sensors/ant.js`)

- New option `listen` (function or boolean, default true): when false, no receive channels
  (0–2) are attached, but the stick is still opened and watched.
- Emits `'stick'` `(stick)` after a successful open (and after a scan reopens it), and
  `'stick-lost'` `(stick)` before releasing a stick (close, unplug, scan start, reconnect).
- Exposes `stickReady(): boolean`.

Everything else (status, readings, scan behaviour) is unchanged; existing tests keep passing.
