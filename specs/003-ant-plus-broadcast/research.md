# Research: ANT+ Broadcast from Zwifit

All Technical Context unknowns are resolved here. Each entry: Decision, Rationale, Alternatives.

## R1. Transmitting with `ant-plus-next` 0.4.0

- **Decision**: Keep `ant-plus-next` (already a dependency, MIT) and drive transmit channels
  with its low-level API: `Messages.assignChannel(ch, 'transmit')`, `setDevice`, `setFrequency`,
  `setPeriod`, `openChannel`, `broadcastData`, `closeChannel`, `unassignChannel`, written with
  `stick.write()`. The stick emits every message it receives as `'read'` (a raw buffer); a
  transmitter listens for `MESSAGE_CHANNEL_EVENT` (0x40) with code `EVENT_TX` (0x03) on its own
  channel and answers with the next data page.
- **Rationale**: The library only ships receive-side sensor classes, but its message builders and
  `write()` are everything a master channel needs. No new dependency, so no new `npm audit` or
  native-build risk (Principles I and III).
- **Alternatives**: `ant-plus` (older, also receive-only); writing a USB ANT driver (duplicate of
  what the library already does); a separate stick for broadcasting (extra hardware, and FR-009
  requires one stick).

## R2. Sharing one stick between reception and broadcast

- **Decision**: `AntSensors` stays the only owner of the stick (open, retry, hot-plug, release).
  It gains a `listen` option (receive channels on/off) and emits `'stick'` (with the opened stick)
  after opening and `'stick-lost'` before releasing it. `AntBroadcast` attaches its transmit
  channels on `'stick'` and drops them on `'stick-lost'`. Receive channels keep 0–2; transmit
  channels use 3–6 (footpod 3, heart rate 4, power 5, treadmill 6).
- **Rationale**: The open/retry/WSL-reset handling in `ant.js` is hard-won. Duplicating it
  would mean two owners fighting over one USB device. Fixed channel numbers avoid collisions
  with the library's receive sensors. The ANTUSB2, ANTUSB-m and USB3 sticks report 8 channels;
  3 receive + 4 transmit = 7 fit.
- **Scans**: An ANT+ scan (`openRxScan`) needs the whole stick, so `AntSensors` already closes it
  for 15 s. The broadcast pauses for the scan (status "paused while scanning for sensors") and
  resumes on the following `'stick'` event. Receivers keep the pairing; most show a short
  dropout.
- **ANT+ sensors off but broadcast on**: `AntSensors` is created when either is on at start, with
  `listen: settings.sensors.ant !== false`. If both were off at start, turning the broadcast on
  needs a restart (the UI says so, like the existing ANT+ switch).
- **Alternatives**: Extracting a new `AntStick` host class (bigger refactor of tested code for
  no user-visible gain); dynamic channel allocation via `stick.canAttach()` (the library's
  counter is unreliable after detaches, see `_reattach` in `ant.js`).

## R3. ANT+ profiles and data pages

All channels use the ANT+ network key (set by the library at start-up), RF 57 (2457 MHz), and
bidirectional master type (`transmit`, 0x10). Inbound acknowledged or broadcast data on a
transmit channel is ignored (FR-008).

| Sensor | Device type | Period (counts) | Trans. type | Data pages sent |
|---|---|---|---|---|
| Footpod (SDM) | 124 | 8134 (4.03 Hz) | 5 | 1 (speed, distance, strides), 2 (cadence + speed, only when cadence known), 80/81 |
| Heart rate (HRM) | 120 | 8070 (4.06 Hz) | 1 | 4 (previous beat time), background 2 and 3 |
| Power (bike power) | 11 | 8182 (4.00 Hz) | 5 | 16 (power-only), 80/81 |
| Treadmill (FE) | 17 | 8192 (4.00 Hz) | 5 | 16 (general FE: type 19 treadmill, time, distance, speed, HR), 17 (incline), 19 (treadmill: cadence, vertical distance), 80/81 |

- **Common pages**: 80 (manufacturer 255 = development, hardware rev, model) and 81 (software
  rev, serial 0xFFFFFFFF = none) are sent twice in a row every 64 messages, as the profiles ask.
  HRM uses its own background pages 2 (manufacturer) and 3 (product) on the same cadence. The
  data page byte 0 toggle bit (bit 7) flips every 4 messages.
- **Units**: always the profile's units (FR edge case "Units"): m/s ×256 (SDM) or ×1000 (FE),
  metres with rollover, 1/200 s and 1/1024 s event times, 0.01 % incline.
- **Synthesised counters**: Zwifit only has instantaneous values, so the encoder integrates them:
  distance from speed, stride count from cadence (strides = steps/2), heart beat event time
  and count from heart rate (one beat every 60/HR s), power event count and accumulated power
  per message. Counters roll over at the profile's width (256 or 65 536) so long runs keep
  counting.
- **Rationale**: These are the pages every ANT+ watch, head unit and Zwift-on-PC reads. Pages
  are byte-exact and pure, so they're unit-tested against hand-computed vectors.
- **Alternatives**: SDM page 3 (calories) and FE page 18 (METs/calories) were skipped as not
  needed. Trainer control pages 48–51 are the opposite of FR-008.

## R4. Missing values, stopped belt, disconnects (FR-005, FR-011)

- **Decision**:
  - Footpod and treadmill channels stay open while the broadcast is on. Speed is 0 when the belt
    is stopped, paused or the treadmill is disconnected; distance and time counters freeze, so
    there are no jumps or resets on reconnect.
  - Heart rate and power channels open only while their merged value is present (the merge
    already drops readings older than 5 s). They close when the value disappears (receivers
    report the sensor as lost, not as 0) and reopen when it returns, under the same device
    number.
  - Cadence missing → SDM page 2 is not sent and FE page 19 cadence = 0xFF (invalid).
  - Every input is checked before encoding: finite number, speed 0–30 km/h and within the
    treadmill limits, incline −10–40 %, HR 30–250, cadence 0–300 steps/min, power 0–2500 W.
    Invalid → treated as missing; the last valid value is not repeated beyond the 5 s freshness
    window.
- **Alternatives**: Keeping HR/power channels open with "invalid" markers. HRM has no reliable
  invalid marker (watches show 0), so closing the channel is the only clean "missing".

## R5. Device numbers (FR-007)

- **Decision**: One 16-bit device number per sensor (1–65 535), from `crypto.randomInt`, stored
  in `settings.antBroadcast.deviceNumbers`, created when first needed and saved. A paired device
  can ask for new ones (`ant-broadcast:renumber`); they apply at once.
- **Rationale**: Stable across restarts (SC-004). Random numbers make two Zwifits (or a real
  footpod) in range unlikely to collide; the 20-bit extended form isn't needed.
- **Alternatives**: Deriving from the stick's serial number would change when the stick does and
  collide if both are derived the same way.

## R6. Avoiding double broadcasts (FR-006)

- **Decision**: The merged status already tags `hrSource` and `powerSource` (`ant`, `ble`,
  `treadmill`). A value whose source is `ant` is not rebroadcast unless
  `antBroadcast.rebroadcastAnt.hr` or `.power` is on (default off). The status shows "HR comes
  from an ANT+ sensor; pair your device with it directly".

## R7. Settings apply live

- **Decision**: `AntBroadcast` reads `getSettings()` on every update tick (4 Hz, cheap) and
  reconciles the open channels with the switches and device numbers, so Settings changes apply
  within a second without a restart (except the case in R2).

## R8. Test double and hardware check

- **Decision**: A fake stick in tests (EventEmitter with `write()` that records messages and a
  helper that emits `EVENT_TX` for a channel). It covers the configuration sequence, page
  rotation, inbound commands being ignored, stick loss and reattach (FR-015). Real-hardware
  checks are in `quickstart.md` (the ANTUSB2 on the dev server, a Garmin watch).
