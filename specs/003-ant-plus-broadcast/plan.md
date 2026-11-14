# Implementation Plan: ANT+ Broadcast from Zwifit

**Branch**: `003-ant-plus-broadcast` (work happens on `ubuntu-svr`) | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-ant-plus-broadcast/spec.md`

## Summary

Add an **ANT+ broadcast** option that transmits Zwifit's live data from the ANT+ stick it already
uses for sensors. Zwifit appears as four standard ANT+ sensors, each with its own switch: footpod
(speed, distance, cadence), heart rate monitor, power meter, and treadmill (fitness equipment:
speed, incline, distance, time). Transmit channels 3–6 run beside the existing receive channels
0–2 on the same stick through `ant-plus-next`'s low-level message API. Byte-exact page encoders
and counters are pure core code. A new `AntBroadcast` adapter owns the channels, and
`AntSensors` keeps ownership of the stick and tells the broadcaster when it's ready or lost.
See [research.md](research.md).

## Technical Context

**Language/Version**: Node.js ≥ 24 (CommonJS) server; Angular (TypeScript) web UI in `src/api/web-src`

**Primary Dependencies**: `ant-plus-next` 0.4.0 (existing), `usb` (existing); no new dependencies

**Storage**: `settings.json` via `settingsRepo` (new `antBroadcast` object)

**Testing**: Jest (unit + integration), fake ANT stick test double

**Target Platform**: Linux (incl. Raspberry Pi, Ubuntu on WSL), macOS, Windows with a Garmin ANTUSB2/USB-m/USB3 stick

**Project Type**: Single Node service with an embedded web UI

**Performance Goals**: Each channel answers every `EVENT_TX` (~4 Hz) with the next page; a speed change reaches receivers within 3 s (SC-002)

**Constraints**: One stick shared with reception (FR-009); 7 of 8 channels used; no effect on the Bluetooth broadcast or ANT+ reception (SC-005); broadcast pauses during a 15 s ANT+ scan

**Scale/Scope**: 4 ANT+ profiles, ~6 new source files, 1 settings section, 1 socket message, status card

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design: still passes.*

| Principle | How this plan complies | Status |
|---|---|---|
| I. Security First | Broadcast is transmit-only for control: inbound messages on transmit channels are ignored (FR-008), nothing reaches `setTarget`. Settings and renumber are behind pairing (FR-013) and schema-validated. `deviceNumbers` aren't client-writable. Every broadcast value is range-checked (FR-011). No new dependency. Threat model below. | ✅ |
| II. Test-First | Tests first for encoders (fixed vectors), counters (rollover), adapter (fake stick: config sequence, rotation, close/reopen, inbound ignored, stick loss, scan pause) and integration (settings, renumber, auth, status). ≥ 80 % coverage on changed modules. | ✅ |
| III. Cross-Platform | Same stick and library as ANT+ sensors on all three OSes; no OS branches added; README updated for all OSes. | ✅ |
| IV. Isolation | Encoders and counters are pure (`src/core/antBroadcast`); USB lives in the adapter; the fake stick is the test double. | ✅ |
| Threat model required | Below. | ✅ |

### Threat model

- **Assets**: treadmill control (physical safety); settings; runner's live HR/power/pace.
- **Entry points**: (1) ANT+ messages from any nearby device on the transmit channels
  (acknowledged/control pages, requests); (2) `settings:write` and `ant-broadcast:renumber` over
  the authenticated socket; (3) values from the treadmill and sensors that get encoded.
- **Trust boundaries**: radio (untrusted, unauthenticated by design) → adapter; network client
  → socket guards; treadmill/sensor data → validation before encoding.
- **Mitigations**: (1) Inbound data on transmit channels is dropped without parsing beyond the
  channel/message ID; there's no code path from the broadcaster to treadmill commands (a test
  asserts `setTarget` is never called). (2) Pairing guard plus strict schemas; device numbers
  only from `crypto.randomInt`. (3) Range checks and integer clamping to field widths in the
  encoders, so malformed input becomes "missing", never an out-of-range byte.
- **Accepted risk**: ANT+ is unencrypted; anyone nearby can read pace/HR/power (spec
  Assumptions). The UI and README say so.

## Project Structure

### Documentation (this feature)

```text
specs/003-ant-plus-broadcast/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── ant-pages.md     # byte layouts of every page sent
│   └── api.md           # settings, socket messages, adapter interfaces
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── core/antBroadcast/
│   ├── pages.js            # NEW pure page encoders (contracts/ant-pages.md)
│   ├── counters.js         # NEW pure counters, rollover, input validation
│   └── schedule.js         # NEW pure page rotation per profile (common pages, toggles)
├── adapters/
│   ├── antBroadcast/
│   │   └── index.js        # NEW AntBroadcast: channels 3–6 on the shared stick
│   └── sensors/ant.js      # CHANGED listen option, 'stick' / 'stick-lost' events
├── api/socket/
│   ├── antBroadcast.js     # NEW ant-broadcast:renumber
│   └── status.js           # CHANGED status.antBroadcast
├── contracts/schemas/
│   ├── settings.schema.json            # CHANGED antBroadcast
│   ├── settings-write.schema.json      # CHANGED antBroadcast (no deviceNumbers)
│   └── ant-broadcast-renumber.schema.json  # NEW
├── storage/settingsRepo.js # CHANGED defaults for antBroadcast
├── app.js                  # CHANGED wiring, startup log line
└── api/web-src/src/app/
    ├── settings/settings.component.{html,ts}  # CHANGED "ANT+ broadcast" card
    ├── control/control.component.html         # CHANGED status pill
    └── core/api.types.ts                      # CHANGED types

test/
├── unit/core/antBroadcast/{pages,counters,schedule}.test.js   # NEW
├── unit/adapters/antBroadcast.test.js                          # NEW (fake stick)
├── unit/adapters/ant.test.js                                   # CHANGED listen + stick events
└── integration/antBroadcast.test.js                            # NEW

README.md                   # CHANGED "ANT+ broadcast" section
```

**Structure Decision**: Single project, following the existing split between `src/core` (pure),
`src/adapters` (hardware), `src/api` (socket + web UI) and `test/unit` + `test/integration`.

## Complexity Tracking

No constitution violations to justify.
