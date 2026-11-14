# Feature Specification: ANT+ Broadcast from Zwifit

**Feature Branch**: `003-ant-plus-broadcast`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: "add a new specs ANT+ broadcast from zwifit option"

## Clarifications

### Session 2026-11-13

- Q: Which ANT+ device types must ship in this release? → A: All of them: footpod, heart rate,
  power and treadmill (fitness equipment), each selectable under the ANT+ broadcast option.

**Depends on**: `001-cross-platform-training-plans` (ANT+ stick support for sensors, Settings
page, Zwift broadcast settings, paired-device security, cross-platform runtime).

## Overview

Today Zwifit *listens* on ANT+ (heart rate, cadence and power sensors through a USB stick) but
only *broadcasts* over Bluetooth. Many runners record treadmill runs on devices that pair over
ANT+ only, or more reliably over ANT+: Garmin and other sports watches, bike computers, gym
head units and apps on PCs with an ANT+ stick. This feature adds an **ANT+ broadcast** option so
Zwifit also transmits the treadmill's live data, and optionally the runner's sensor data, as
standard ANT+ sensors that those devices can pair with.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Watch records the treadmill run from Zwifit (Priority: P1)

The runner turns on **ANT+ broadcast** in Settings. Zwifit appears to ANT+ devices as a running
footpod (stride-based speed and distance sensor) carrying the treadmill's speed, distance and,
when known, cadence. The runner pairs their watch with it once; from then on every treadmill run
recorded on the watch shows the treadmill's real pace and distance instead of the watch's wrist
estimate.

**Why this priority**: This is the core request. It gives accurate pace and distance to the most
common ANT+ device (a running watch) and is useful on its own.

**Independent Test**: With the simulated treadmill and the ANT+ test double, turn on ANT+
broadcast, change the speed and confirm the broadcast footpod data follows it. With real
hardware, pair a watch with "Zwifit" and confirm its live pace matches the control page.

**Acceptance Scenarios**:

1. **Given** an ANT+ stick is connected and ANT+ broadcast is on, **When** a watch searches for
   a footpod, **Then** it finds Zwifit and can pair with it.
2. **Given** a watch is paired, **When** the treadmill speed changes, **Then** the watch shows the
   new pace within 3 seconds.
3. **Given** a run of known length on the treadmill, **When** the run ends, **Then** the distance
   recorded by the watch is within 1% of the distance Zwifit recorded.
4. **Given** the belt is stopped or paused, **When** the watch is paired, **Then** it shows zero
   speed and distance stops increasing; it does not keep the last speed.
5. **Given** a cadence source is available (footpod, Stryd or treadmill), **When** broadcasting,
   **Then** the cadence is included; when none is available, cadence is reported as unavailable,
   not as zero.
6. **Given** Zwifit restarts, **When** the watch searches again, **Then** it reconnects to the
   same Zwifit sensor without pairing again (the sensor identity stays the same).

---

### User Story 2 - Rebroadcast heart rate and power over ANT+ (Priority: P2)

The runner's heart rate (from a Bluetooth strap, the treadmill's grips or strap) and running
power (from a Bluetooth Stryd) reach Zwifit over Bluetooth or the treadmill, but their watch only
accepts these over ANT+. In **Settings → ANT+ broadcast** the runner ticks heart rate and power,
and Zwifit transmits them as an ANT+ heart rate monitor and an ANT+ power meter.

**Why this priority**: It extends Story 1 to the other numbers runners record, but depends on the
broadcast from Story 1 already working.

**Independent Test**: With a simulated Bluetooth heart rate and power source, turn on heart rate
and power in ANT+ broadcast and confirm the broadcast values follow the sources and go
unavailable when the sources stop.

**Acceptance Scenarios**:

1. **Given** heart rate comes from a non-ANT+ source and heart rate is ticked, **When** a device
   searches for a heart rate monitor, **Then** it finds Zwifit and shows the same heart rate as
   the control page within 3 seconds.
2. **Given** power comes from a non-ANT+ source and power is ticked, **When** a device searches
   for a power meter, **Then** it finds Zwifit and shows the same (optionally smoothed) power as
   the control page.
3. **Given** a sensor drops out, **When** broadcasting, **Then** Zwifit stops sending that value
   so the receiving device shows it as missing, not zero, and resumes when the sensor returns.
4. **Given** the heart rate or power already comes from an ANT+ sensor, **When** the runner views
   the option, **Then** Zwifit explains that the device can pair with that sensor directly and,
   by default, does not rebroadcast it (avoiding two copies of the same sensor).

---

### User Story 3 - Treadmill as ANT+ fitness equipment (Priority: P3)

Devices and apps that pair with gym treadmills over ANT+ can pair with Zwifit as a treadmill and
see speed, distance, incline and elapsed time, so incline and vertical gain are recorded too.

**Why this priority**: Fewer devices support pairing with a treadmill than with a footpod, so this
adds less value than Stories 1 and 2. It is the only way to send incline over ANT+.

**Independent Test**: With the simulated treadmill and the ANT+ test double, set an incline and
speed and confirm the broadcast treadmill data carries both and the elapsed time.

**Acceptance Scenarios**:

1. **Given** fitness-equipment broadcast is on, **When** a supporting device searches for a
   treadmill, **Then** it finds Zwifit and shows speed, incline, distance and elapsed time.
2. **Given** a receiving device sends a command to change speed or incline, **When** Zwifit
   receives it, **Then** Zwifit ignores it and the treadmill does not change; the broadcast is
   read-only.

---

### User Story 4 - See and control the ANT+ broadcast (Priority: P2)

On the Dashboard and in **Settings → ANT+ broadcast**, the runner sees whether the ANT+ broadcast
is on, which ANT+ sensors Zwifit is broadcasting as (footpod, heart rate, power, treadmill) and
their device numbers, and a clear reason when it cannot broadcast (no stick, stick in use, stick
not permitted).

**Why this priority**: Without status, a runner whose watch doesn't find Zwifit has no way to
tell why.

**Independent Test**: Start Zwifit with no ANT+ stick and with the test-double stick, and confirm
the status reads "no ANT+ stick found" and "broadcasting as footpod #NNNN" respectively.

**Acceptance Scenarios**:

1. **Given** no ANT+ stick is connected, **When** ANT+ broadcast is on, **Then** Zwifit keeps
   running, the Bluetooth broadcast to Zwift is unaffected, and the status says no stick was
   found and how to fix it.
2. **Given** the stick is unplugged during a run, **When** it is plugged back in, **Then** the
   broadcast resumes on its own within 10 seconds, under the same device numbers.
3. **Given** the runner turns ANT+ broadcast off, **When** they save, **Then** Zwifit stops
   transmitting without affecting ANT+ sensor reception or the Bluetooth broadcast.

---

### Edge Cases

- One stick for both directions: the same ANT+ stick receives the runner's sensors and broadcasts
  Zwifit's data at the same time, without either one disrupting the other.
- Two Zwifit instances (or a real footpod) in range: each Zwifit keeps a stable device number of
  its own so watches pair with the intended one.
- Treadmill disconnects: speed is broadcast as zero, distance stops and Zwifit does not invent
  data; when the treadmill reconnects, distance continues from where it was rather than resetting
  mid-run.
- Speed reported above the treadmill's limits or malformed values from the treadmill are not
  broadcast; the last valid value is not repeated indefinitely.
- Distance counters roll over (receiving devices expect a wrapping counter): long runs keep
  counting correctly past the rollover.
- Units: ANT+ data is always sent in the standard's units regardless of the runner's mph/km
  setting.
- Platform without stick access (driver missing on Windows, missing USB permission on Linux/WSL):
  the status gives the platform-specific fix.
- Bluetooth broadcast off and ANT+ broadcast on (and vice versa): each works on its own.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Zwifit MUST offer an **ANT+ broadcast** option in Settings, off by default, that
  can be turned on and off independently of the Bluetooth broadcast to Zwift and of ANT+ sensor
  reception.
- **FR-002**: When on, Zwifit MUST broadcast as a standard ANT+ stride-based speed and distance
  sensor (footpod) carrying instantaneous speed, accumulated distance and, when available, cadence.
- **FR-003**: Zwifit MUST let the runner choose which additional ANT+ sensors to broadcast as:
  heart rate monitor, power meter and treadmill (fitness equipment). All four ANT+ device types
  (footpod, heart rate, power and treadmill/fitness equipment) MUST ship in this release, each
  with its own on/off choice under the single ANT+ broadcast option.
- **FR-004**: Broadcast values MUST come from the same live data shown on the control page
  (treadmill speed, distance and incline; heart rate, cadence and power from the sources chosen
  in Settings → Sensors), including any speed offset/multiplier and power smoothing settings.
- **FR-005**: Zwifit MUST stop sending a value (so receivers show it as missing) when its source
  stops, and MUST broadcast zero speed when the belt is stopped or the treadmill disconnects.
- **FR-006**: By default Zwifit MUST NOT rebroadcast a heart rate or power value whose source is
  itself an ANT+ sensor; the runner MAY override this per value.
- **FR-007**: Each broadcast sensor MUST keep a stable device identity across restarts so paired
  devices reconnect without pairing again; the runner MUST be able to see the device numbers and
  generate new ones.
- **FR-008**: The ANT+ broadcast MUST be transmit-only for treadmill control: any command or
  request a receiving device sends MUST NOT change treadmill speed, incline or any setting.
- **FR-009**: Zwifit MUST receive ANT+ sensors and broadcast over ANT+ on a single ANT+ stick at
  the same time.
- **FR-010**: When the stick is missing, unplugged, busy or not permitted, Zwifit MUST keep
  running with all other features working, show the reason and fix in the status, and resume
  broadcasting automatically when the stick becomes available.
- **FR-011**: Zwifit MUST validate every value before broadcasting it (range and type), and
  never broadcast malformed or out-of-range data.
- **FR-012**: The Dashboard and Settings MUST show the ANT+ broadcast status: on/off, active
  sensors with device numbers, and any error.
- **FR-013**: Only paired control-page devices MAY view or change ANT+ broadcast settings,
  consistent with the existing Settings security.
- **FR-014**: The feature MUST work on Linux (including Raspberry Pi and Ubuntu on WSL), macOS and
  Windows with a supported ANT+ stick, and the README MUST describe any per-OS setup.
- **FR-015**: The ANT+ broadcast MUST be testable without an ANT+ stick or treadmill by using the
  simulated treadmill and an ANT+ stick test double.

### Key Entities

- **ANT+ broadcast settings**: on/off; which sensor types to broadcast as (footpod, heart rate,
  power, treadmill); per-value rebroadcast override for ANT+-sourced sensors; stored with the
  runner's other settings.
- **Broadcast sensor identity**: for each sensor type, the device number (and transmission type)
  that receiving devices pair with; persisted so it survives restarts.
- **ANT+ broadcast status**: current state (off, starting, broadcasting, error), active sensors,
  last error with its fix; shown on the Dashboard and in Settings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A runner with a supported ANT+ stick and watch can turn on ANT+ broadcast and pair
  the watch in under 2 minutes, following only the in-app and README instructions.
- **SC-002**: Pace shown on a paired watch matches the control page within 3 seconds of every
  speed change.
- **SC-003**: Distance recorded by a paired watch over a 5 km treadmill run is within 1% of
  the distance Zwifit records.
- **SC-004**: After a Zwifit restart, a previously paired watch reconnects without re-pairing
  in 100% of attempts.
- **SC-005**: With ANT+ broadcast on, ANT+ sensor reception and the Bluetooth broadcast to Zwift
  run a 60-minute workout with no more dropouts than with ANT+ broadcast off.
- **SC-006**: No command sent by a receiving device changes the treadmill in any test.

## Assumptions

- The runner already has a supported ANT+ USB stick (Garmin USB2/USB-m or USB3), the same ones
  Zwifit supports for sensors; no new hardware type is needed.
- A single stick has enough channels to receive the runner's sensors and broadcast all chosen
  sensor types at once.
- ANT+ broadcast is off by default so existing setups behave exactly as before.
- Zwift itself keeps receiving data over Bluetooth as today; ANT+ broadcast mainly targets
  watches, bike/run computers and PC apps, though Zwift on a PC with an ANT+ stick can also pair
  with the footpod.
- ANT+ broadcasts are unencrypted and readable by anyone nearby; the data (pace, heart rate,
  power) is considered acceptable to transmit openly, as with any ANT+ sensor.
- Out of scope: other ANT+ profiles (bike speed/cadence, ANT-FS file transfer), broadcasting
  workout or plan structure, and controlling the treadmill from ANT+ devices.
