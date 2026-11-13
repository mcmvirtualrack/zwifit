# Feature Specification: Cross-Platform Runtime, Refreshed UI & Training Plans

**Feature Branch**: `001-cross-platform-training-plans`

**Created**: 2026-11-01

**Status**: Implemented; owner hardware checks pending (updated 2026-11-02: sensors, broadcast of
sensor data, redesign; 2026-11-13: training programs, HTTPS port, pairing code in app; 2026-11-14:
status)

**Input**: User description: "refactor the code so that it can run on linux, mac or windows, improve
the UI and ability to create a training plan that will configure the speed, incline and intervals of
every steps. Use the Ubuntu WSL installed on this windows to deploy the program as a start."

## Clarifications

### Session 2026-11-01

- Q: What should the treadmill do when a training plan reaches the end of its last step? → A: Slow
  to a walking speed (default 2 mph / 3 km/h at 0% incline) and hold it until the user stops the belt.
- Q: When the runner presses Pause during a plan, what should happen to the belt? → A: The belt
  comes to a full stop; Resume restarts it at the current step's speed and incline.
- Q: How long should a phone or tablet stay paired before it has to enter the pairing code again?
  → A: Expires after 90 days without use; every use renews it.
- Q: Should Zwifit keep a history of completed workouts in this feature? → A: Yes, a full log with
  per-step actual speed, incline and heart rate, exportable.
- Q: Should the runner enter a step's target as a speed, as a pace, or either? → A: Either, chosen
  per step: speed (mph or km/h) or pace (min/mile or min/km).

### Session 2026-11-13

- Q: How is a multi-week plan (e.g. 16 weeks) made? → A: Generated from a goal (5K, 10K, half
  marathon, marathon), a race date, 6–24 weeks, 3–6 run days and an easy-run speed. Syncing plans
  from other services (Garmin, TrainingPeaks, intervals.icu) is out of scope for now.
- Q: Should the pairing code be visible in the app? → A: Yes, to an already-paired device, on
  request (Settings → Paired devices → New pairing code). That code pairs one device and expires
  after 10 minutes.
- Q: What if a browser insists on HTTPS (a managed Edge on a Surface Hub)? → A: HTTPS can be
  served on a second port next to plain HTTP, with a certificate the owner provides.

### Session 2026-11-02

- Q: Where may heart rate, cadence and running power come from? → A: From the treadmill, from ANT+
  sensors through a USB ANT+ stick (chest strap or watch broadcasting heart rate, footpod, Stryd),
  and from Bluetooth sensors the user connects. Running power comes only from a sensor.
- Q: Which source wins when several report the same metric? → A: Per metric the user chooses Auto
  (ANT+ first, then Bluetooth, then the treadmill), ANT+, Bluetooth, Treadmill (heart rate only) or
  Off. Auto prefers ANT+ so the Bluetooth adapter stays free for the Zwift link.
- Q: How does the user pick a particular sensor? → A: A scan lists every sensor in range with icons
  for what it measures (heart, bolt, footprints); "Use" picks one and it is remembered; "Forget"
  goes back to the first one in range.
- Q: Should sensor data be passed on to Zwift? → A: Yes, over Bluetooth: heart rate as a Heart Rate
  sensor, cadence in the footpod (Running Speed and Cadence) service, and power optionally inside
  the Fitness Machine data and/or as a Cycling Power sensor. Re-broadcasting over ANT+ is deferred.
- Q: When should the live graphs and stat tiles for heart rate, cadence and power appear? → A: Only
  once that metric has been reported (autodetect); a tile that loses its signal says "signal lost".
- Q: Should the heart-rate graph show when no run is going or the treadmill is not connected? →
  A: Yes, whenever heart rate is coming in.
- Q: How should the app look? → A: As the approved mockups: dark by default, Inter for text and
  JetBrains Mono for numbers, page links as a segmented control at the top right, thin
  Grafana-style lines on a faint grid.
- Q: Where are heart-rate zones set? → A: From a maximum heart rate (default 190 bpm) set per
  browser in Settings → Display; zones are fixed shares of it (Z1 below 60 %, then 70, 80, 90 %).
- Q: On the Workout page, how are power and cadence shown? → A: As live lanes (heart rate, cadence,
  power) in a card under the Now card, when those sensors are present.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install and run on any desktop OS, starting with Ubuntu on WSL (Priority: P1)

A runner who owns an iFit treadmill installs Zwifit on the computer they have (Linux, macOS or
Windows) by following one set of documented steps per OS, starts it with a single command, and
reaches the control page in a browser. The first target is the Ubuntu distribution under WSL on
the owner's Windows PC.

**Why this priority**: Nothing else can be used or tested until the app installs and starts
reliably. Today the docs pin obsolete runtime versions, several setup steps are shell-only, and
Windows/macOS are marked "not well tested" or "does not work".

**Independent Test**: On a clean Ubuntu-on-WSL environment, follow the README steps, run the start
command and open the control page from a browser on the Windows host; repeat on macOS and native
Windows. Delivers a running app even before any UI or plan work.

**Acceptance Scenarios**:

1. **Given** a clean Ubuntu-on-WSL environment with only the documented prerequisites, **When** the
   user follows the Linux/WSL setup steps and runs the start command, **Then** the app starts
   without errors and the control page loads from a browser on the Windows host.
2. **Given** a clean macOS or Windows machine, **When** the user follows that OS's documented
   steps, **Then** the app starts and the control page loads.
3. **Given** the app is running on a machine with no treadmill reachable or no Bluetooth adapter,
   **When** the user opens the control page, **Then** the page loads and clearly shows which
   connections are unavailable and why, instead of the app crashing.
4. **Given** a first run with no saved settings, **When** the app starts, **Then** the user is
   guided through connecting to the treadmill and the answers are saved for next time.

---

### User Story 2 - Build a training plan step by step (Priority: P2)

The runner creates a named training plan made of ordered steps. Each step sets a target speed, a
target incline and how long the step lasts (by time or by distance). Steps can be grouped into a
repeating interval block (e.g. "repeat 6×: 2 min fast / 1 min recovery"). The runner can edit,
reorder, duplicate and delete steps and plans, and sees the plan's total duration/distance before
saving.

**Why this priority**: This is the main new capability requested and produces value (saved,
reviewable workouts) even before automatic playback exists.

**Independent Test**: Create a plan with a warm-up, a 6× interval block and a cool-down, save it,
restart the app and confirm the plan reloads unchanged with correct totals.

**Acceptance Scenarios**:

1. **Given** the plan editor, **When** the user adds steps with speed, incline and a duration or
   distance, **Then** each step is shown in order with its values and the plan total updates.
2. **Given** a set of consecutive steps, **When** the user groups them as an interval block with a
   repeat count, **Then** the totals reflect every repetition and the expanded sequence can be
   previewed.
3. **Given** a step value outside the treadmill's safe limits (e.g. negative speed, incline above
   the configured maximum, zero or negative duration), **When** the user tries to save, **Then** the
   save is refused and the offending field is clearly identified.
4. **Given** the user prefers metric or imperial units, **When** they view or edit a plan, **Then**
   speeds, paces and distances are shown and entered in their chosen units.
5. **Given** a step, **When** the user enters a pace of 10:00 min/mile instead of a speed, **Then**
   the editor shows the equivalent 6.0 mph, the step is checked against the speed limits, and the
   step still shows 10:00 min/mile when the plan is reopened.
6. **Given** a step, **When** the user enters a pace of 0:00 or a pace so fast it exceeds the
   maximum speed, **Then** the save is refused and the field is identified.
7. **Given** an existing recorded route from the previous "Routes" feature, **When** the user opens
   training plans, **Then** that route is available as a plan (or the user is told why it could not
   be converted).

---

### User Story 3 - Run a training plan on the treadmill (Priority: P3)

The runner starts a saved plan. The treadmill automatically changes speed and incline at each step
boundary while the control page shows the current step, time/distance remaining in the step and in
the plan, and the next step. The runner can pause, resume, skip to the next step or stop at any
time, and manual speed/incline changes on the treadmill always take effect immediately.

**Why this priority**: This is what turns a plan into a workout, but it depends on Stories 1 and 2
and carries the highest safety risk, so it ships last and with the most testing.

**Independent Test**: With a simulated treadmill, run a short plan (3 steps × 10 s) and verify each
speed/incline command is issued at the right boundary and that pause/skip/stop behave as described.
Then repeat on a real treadmill at low speed.

**Acceptance Scenarios**:

1. **Given** a saved plan and a connected treadmill, **When** the user starts the plan, **Then** the
   treadmill is set to the first step's speed and incline and the page shows step progress.
2. **Given** a running plan, **When** a step's time or distance is reached, **Then** the next step's
   speed and incline are applied and the display advances.
3. **Given** a running plan, **When** the user presses pause, **Then** the belt is brought to a
   full stop, plan progress (time and distance in the step) freezes, and no further automatic
   commands are sent until the user presses resume.
4. **Given** a paused plan, **When** the user presses resume, **Then** the belt restarts and is set
   to the current step's speed and incline, and the step continues from where it was paused.
5. **Given** a running plan, **When** the user presses stop, or the treadmill connection is lost, or
   the treadmill's own stop/safety key is used, **Then** the plan ends, no further commands are sent
   and the user is told why it ended.
6. **Given** a running plan, **When** the user changes speed or incline manually, **Then** the
   manual change wins for the remainder of the current step.
7. **Given** a running plan, **When** the last step ends, **Then** the treadmill is set to the
   cool-down walking speed at 0% incline, the plan is marked complete, and no further automatic
   commands are sent; the belt keeps moving until the user stops it.

---

### User Story 4 - Review and export workout history (Priority: P4)

After a plan ends (completed, stopped or ended by a lost connection), the runner can open a history
list, see each workout's summary and drill into a per-step breakdown of the actual speed, incline
and heart rate compared with the plan's targets. They can export any workout to a file to keep or
analyse elsewhere, and delete workouts they no longer want.

**Why this priority**: Adds lasting value to plan playback, but depends on Story 3 and is not
needed to run a workout.

**Independent Test**: Run a short plan on the simulated treadmill with simulated heart rate, stop it
mid-way, then confirm the history entry shows the correct end reason, step breakdown and heart-rate
values, and that the exported file contains the same data.

**Acceptance Scenarios**:

1. **Given** a plan has just ended for any reason, **When** the user opens history, **Then** the
   workout appears with plan name, start date/time, duration, distance, average and max heart rate,
   and how it ended (completed, stopped by user, connection lost, stopped from treadmill).
2. **Given** a workout in history, **When** the user opens it, **Then** each step shows target vs.
   actual average speed and incline, time and distance spent, and average/max heart rate.
3. **Given** a workout in history, **When** the user exports it, **Then** a file is produced that
   opens in a common spreadsheet program and contains the summary, per-step breakdown and the
   periodic samples.
4. **Given** no heart-rate sensor is connected to the treadmill, **When** a workout is recorded,
   **Then** heart-rate fields show "not available" rather than zero.
5. **Given** a workout in history, **When** the user deletes it, **Then** it is removed after
   confirmation and cannot be viewed or exported afterwards.

---

### User Story 5 - Clearer, responsive control page (Priority: P5)

The runner uses a redesigned control page that works on a phone, tablet or desktop browser placed
near the treadmill: large, readable live stats (speed, incline, distance, time, pace), clear
connection status for the treadmill and for the Bluetooth broadcast to Zwift, easy manual
speed/incline controls, and navigation to settings and training plans.

**Why this priority**: Improves everyday use, but the existing UI already works, so it follows the
functional work.

**Independent Test**: Open the control page at phone, tablet and desktop widths; confirm all live
stats and controls are visible without horizontal scrolling and that connection states are
distinguishable at a glance.

**Acceptance Scenarios**:

1. **Given** a phone-sized screen, **When** the control page is opened, **Then** live stats and
   speed/incline controls fit without horizontal scrolling and buttons are large enough to tap
   while running.
2. **Given** the treadmill or Bluetooth broadcast disconnects, **When** the user looks at the page,
   **Then** the affected connection is visibly marked as disconnected within a few seconds.
3. **Given** the user's OS or browser is in dark mode, **When** the page loads, **Then** it is
   legible in that mode.

---

### User Story 6 - Use heart-rate, cadence and power sensors (Priority: P6)

The runner wears a chest strap or broadcasts heart rate from a Garmin watch, and runs with a Stryd
or footpod. Zwifit picks these up over ANT+ (USB stick) or Bluetooth, shows heart rate, cadence and
running power live, charts them, and saves them in the workout history and exports. In Settings
the runner scans for sensors, sees what each one measures, and picks which to use.

**Why this priority**: Treadmill pulse sensors are unreliable; most runners already own a strap,
watch or Stryd. Builds on the dashboard (US5) and history (US4).

**Independent Test**: With an ANT+ stick and a strap, open the dashboard: a Heart rate tile and
lane appear within seconds. Scan in Settings: the strap is listed with a heart icon; press Use;
restart Zwifit; the same strap is used.

**Acceptance Scenarios**:

1. **Given** an ANT+ stick and a Stryd awake, **When** the dashboard is open, **Then** Power and
   Cadence tiles and lanes appear, and the Settings Power card marks the Stryd "In use".
2. **Given** two heart-rate straps in range, **When** the runner scans and presses Use on one,
   **Then** only that strap is used from then on, including after a restart.
3. **Given** a Bluetooth-only heart-rate sensor, **When** the runner scans Bluetooth and presses
   Use, **Then** it connects, its readings appear, and it reconnects whenever it is back in range.
4. **Given** Source "Auto (ANT+ first)" and the same pod on ANT+ and Bluetooth, **When** both
   report, **Then** the ANT+ reading is used and the Bluetooth one shows "Standby".
5. **Given** a run recorded with heart rate, cadence and power, **When** it is exported as FIT,
   **Then** the file carries all three per record, with lap and session averages and maxima.

---

### User Story 7 - Send sensor data to Zwift (Priority: P7)

Zwift (on an Apple TV, phone or PC) sees the treadmill as a Fitness Machine and a footpod, and can
also read the heart rate, cadence and running power that Zwifit receives from the sensors, so Zwift
needs no direct link to them.

**Why this priority**: Convenience; Zwift running moves the avatar by speed, so power is shown only.

**Independent Test**: Switch on the power meter broadcast, restart, and in Zwift pair "Zwifit" as
the power source: Zwift shows the Stryd's watts.

**Acceptance Scenarios**:

1. **Given** "Send heart rate to Zwift" on and a strap reporting, **When** Zwift pairs the Zwifit
   heart-rate sensor, **Then** it shows the strap's heart rate.
2. **Given** "Send cadence to Zwift" on and a Stryd reporting, **When** Zwift pairs the Zwifit
   footpod, **Then** it shows the Stryd's cadence.
3. **Given** "Also broadcast it as a Bluetooth power meter" on, **When** the power sensor stops
   reporting, **Then** the Zwifit power meter sends nothing (no false zeros).

---

### User Story 8 - Follow a multi-week training program (Priority: P8)

A runner training for a race picks a goal, race date, weeks and run days, and gets a week-by-week
schedule of treadmill runs (easy, hills, intervals, tempo, long runs, race pace, taper) with
speeds and inclines. Each day's run starts from the program and is recorded like any plan.

**Why this priority**: Turns single workouts into a plan toward a goal; builds on plans, playback
and history.

**Independent Test**: Generate a 16-week half-marathon program, start the first day's run, finish
it, and see the day marked done.

**Acceptance Scenarios**:

1. **Given** a goal, race date, 16 weeks and 4 run days, **When** the user previews, **Then** 16
   weeks are shown with phases (base, build, peak, taper), the long run on the last run day and
   the race on race day.
2. **Given** a saved program, **When** the user presses Start on a day, **Then** that day's run is
   saved once as a plan and played; finishing it marks the day done.
3. **Given** a treadmill whose maximum speed is below a generated speed, **When** the program is
   generated, **Then** that speed is lowered to the maximum.

---

### Edge Cases

- Treadmill reports no current speed (known for Pro-Form models): plan progress by distance must
  still advance using the configured fallback speed, and the user is told progress is estimated.
- Plan started while the treadmill belt is stopped or not in an active state: the plan waits and
  tells the user instead of sending commands.
- Two browser tabs or devices try to start or control a plan at the same time: only one plan runs;
  the other view reflects the running plan rather than starting a second.
- App restarts or crashes mid-plan: the plan does not auto-resume motion on restart.
- Resume pressed while the treadmill's safety key is removed or the treadmill refuses to start:
  the plan stays paused and the user is told why the belt did not restart.
- Treadmill connection drops while paused: the plan ends (per FR-017) rather than staying paused.
- Pause pressed while the belt is already stopped: the plan pauses without sending a stop command.
- A device's pairing expires or is revoked while a plan is running: that device loses control
  immediately; the plan keeps running and can still be stopped from the treadmill or another paired
  device.
- Saved plan file is corrupted, hand-edited or from an incompatible version: the app still starts,
  the bad plan is reported and skipped, and other plans load.
- Very long plans (e.g. 200 steps or a 3-hour workout) remain editable and runnable.
- Zwift incline tracker sends incline updates while a plan is running: plan step incline takes
  precedence unless the user disables plan incline control for that plan.
- WSL environment: Bluetooth hardware may not be visible to Linux under WSL; the app must report this
  clearly (see FR-004).
- The treadmill disconnects while a chest strap keeps reporting: the treadmill's last pulse is
  dropped; the strap's heart rate keeps showing and charting.
- No ANT+ stick, or it is unplugged or re-attached by usbipd under WSL: ANT+ shows why, retries every
  10 s, and reopens the stick by itself.
- A sensor stops reporting for more than 5 s: its value no longer counts; Auto falls back to the
  next source; tiles say "signal lost" instead of disappearing.
- An ANT+ scan pauses the ANT+ sensors for about 15 s (the stick cannot scan and listen at once);
  the sensor already in use keeps reporting through the scan.
- One Bluetooth adapter serves the treadmill, sensors and the Zwift broadcast: scans are shared, so
  one user stopping a scan never ends another's; Bluetooth is not touched for sensors unless a
  Bluetooth sensor is scanned for or remembered.
- Implausible sensor values (heart rate or cadence over 250, power over 2500) are ignored.
- The browser is refreshed after an update but Zwifit has not been restarted: the new page may send
  settings the old server does not know yet and they are rejected with a clear message; restarting
  Zwifit fixes it.

## Requirements *(mandatory)*

### Functional Requirements

**Cross-platform runtime**

- **FR-001**: The app MUST install and start with the same documented commands on Linux (including
  Ubuntu under WSL and Raspberry Pi), macOS and Windows, using a single currently supported runtime
  version declared by the project.
- **FR-002**: All setup, build and start steps MUST be runnable on all three OSes; any OS-specific
  step MUST have a documented equivalent for the other OSes.
- **FR-003**: Settings and training plans MUST be stored in a location that works on all three OSes
  and survives app updates.
- **FR-004**: When the treadmill connection or Bluetooth broadcast is unavailable on the current
  machine, the app MUST keep running, show the reason on the control page, and log it.
- **FR-005**: The app MUST provide a simulated-treadmill mode so the UI, plans and playback can be
  exercised without hardware.
- **FR-006**: The README MUST contain step-by-step setup for Ubuntu on WSL, other Linux, macOS and
  Windows, including how to reach the control page from another device.
- **FR-006a**: The first deployment on Ubuntu under WSL MUST be fully functional: it MUST connect to
  the real treadmill and broadcast to Zwift over Bluetooth using a USB Bluetooth LE adapter passed
  through from Windows to WSL. The README MUST document the Windows-side passthrough steps, how to
  re-attach the adapter after a reboot, and how to verify the adapter is visible inside WSL.
- **FR-006b**: When the Bluetooth adapter is not attached to WSL, the control page MUST say so and
  link to the re-attach instructions (per FR-004).

**Training plans**

- **FR-007**: Users MUST be able to create, rename, edit, duplicate and delete training plans.
- **FR-008**: Each step MUST have a target speed, a target incline and an end condition of either
  elapsed time or distance; a step MAY have an optional label (e.g. "Warm-up").
- **FR-008a**: For each step the user MUST be able to enter the target either as a speed (mph or
  km/h) or as a pace (min:sec per mile or per km). The editor MUST show the equivalent of the other
  form next to the entered value. Whatever form is entered, the safe-limit check (FR-012) MUST be
  applied to the equivalent speed, and the entered form MUST be preserved when the plan is reopened.
- **FR-009**: Users MUST be able to group consecutive steps into an interval block with a repeat
  count from 1 to 99.
- **FR-010**: Users MUST be able to reorder steps and blocks.
- **FR-011**: The editor MUST show each plan's total time and/or distance, including repetitions.
- **FR-012**: The system MUST reject any step whose speed, incline or duration is outside safe
  limits (speed and incline within the treadmill's configured min/max; duration greater than zero)
  both when saving and when loading a plan.
- **FR-013**: Plans MUST persist across app restarts and MUST be exportable and importable as a
  file, with imported plans validated by the same rules as FR-012.
- **FR-014**: Existing recorded routes MUST be migrated into training plans on first run of the new
  version, without deleting the original file.

**Plan playback**

- **FR-015**: Users MUST be able to start, pause, resume, skip to the next step and stop a plan.
- **FR-015a**: Pause MUST bring the belt to a full stop and freeze step progress. Resume MUST
  restart the belt at the current step's speed and incline only in response to an explicit resume
  action from a paired device; the system MUST NOT restart the belt by any other means (timer,
  reconnection, app restart, plan start from another view).
- **FR-016**: At each step boundary the system MUST send the step's speed and incline to the
  treadmill, and MUST NOT send any command outside safe limits.
- **FR-017**: Playback MUST stop and send no further commands when the user stops it, the treadmill
  connection drops, the treadmill is stopped from its own controls, or the app restarts.
- **FR-017a**: When the last step completes, the system MUST send one final command setting the
  cool-down walking speed (default 2 mph / 3 km/h, configurable in settings within safe limits) and
  0% incline, then end playback. The system MUST NOT stop the belt automatically.
- **FR-018**: Only one plan MUST be able to run at a time; all connected views MUST show the same
  playback state.
- **FR-019**: Manual speed/incline changes during playback MUST take effect immediately and override
  the plan for the rest of the current step.

**Workout history**

- **FR-019a**: Every plan playback MUST be recorded as a workout, including plans that end early,
  with its end reason.
- **FR-019b**: While a plan runs, the system MUST record samples of actual speed, incline, distance
  and heart rate at least every 5 seconds, plus each step boundary and every manual override.
- **FR-019c**: Heart rate MUST come from the source chosen per FR-028 (the treadmill's pulse, an
  ANT+ sensor or a Bluetooth sensor); when none is reported, it MUST be stored as missing, not
  zero. Cadence and running power, when reported, MUST be recorded in samples and summarised per
  step and per workout (average; also maximum for power).
- **FR-019g**: A workout MUST be exportable as a FIT activity file (for Garmin Connect, Strava and
  similar) with per-record heart rate, cadence, power, speed, distance and grade, and lap and
  session averages and maxima.
- **FR-019d**: Users MUST be able to list, view, export and delete workouts. Export MUST produce a
  file readable by common spreadsheet programs containing summary, per-step and sample data.
- **FR-019e**: Workouts MUST be kept until the user deletes them, and MUST survive app restarts and
  upgrades. A workout interrupted by an app crash MUST still be saved up to the last sample.
- **FR-019f**: Workout history and heart-rate data are personal health data: they MUST only be
  viewable or exportable by paired devices and MUST NOT be written to application logs.

**User interface**

- **FR-020**: The control page MUST display live speed, incline, distance, elapsed time, pace and
  heart rate (when available) in the user's chosen units, and connection status for the treadmill and for the Bluetooth broadcast.
- **FR-021**: The control page, plan editor and settings MUST be usable at phone, tablet and desktop
  widths without horizontal scrolling, and legible in light and dark modes.
- **FR-022**: During playback the page MUST show current step, time/distance remaining in the step
  and in the plan, and the next step.

**User interface (redesign, 2026-11-02)**

- **FR-020a**: The app MUST follow the approved mockups: dark theme by default (light and "follow
  the system" selectable per browser), Inter for text and JetBrains Mono for numbers, both served by
  Zwifit itself (no external font requests, per the Content-Security-Policy).
- **FR-020b**: The page links (Dashboard, Workout, Plans, History, Settings) MUST be a segmented
  control at the top right of the header, wrapping under the logo on phones; the header MUST show
  the running plan and step next to the logo.
- **FR-020c**: The dashboard MUST show: status pills (treadmill, power source, Zwift, ANT+,
  Bluetooth sensors); stat tiles for distance and time (with plan progress) and, once detected,
  heart rate, cadence and power (each with a sparkline); a live chart with the speed readout over a
  speed lane and separate heart-rate, cadence and power lanes on one time axis, with a
  2 min / 10 min / whole-workout switch; the plan step strip; Start / Stop, speed −/+ and speed
  presets (km/h: 4, 6, 8, 10, 12, 14, 16, 20, 22); an incline card with its graph, −/+ and presets
  0–12 % in 2 % steps; and time in each heart-rate zone.
- **FR-020d**: Heart-rate, cadence and power lanes, tiles and the zone card MUST appear only after
  that metric has been reported (FR-030). The heart-rate graph MUST show whenever heart rate is
  reported, with or without a run or a connected treadmill.
- **FR-020e**: Heart-rate zones MUST be derived from a maximum heart rate set per browser (default
  190, 120–230): Z1 below 60 %, Z2 60–70 %, Z3 70–80 %, Z4 80–90 %, Z5 from 90 %. The heart-rate
  lane MUST shade Z3–Z4.
- **FR-022a**: The Workout page MUST show the plan name, elapsed / total time and Pause / Skip step /
  Stop at the top; the plan as a speed profile with done, current and remaining steps; a Now card
  with the actual speed, an "On target" (or target) chip, incline and pace, faint power and
  heart-rate traces behind it and a countdown ring for the step; the next four steps; live
  heart-rate, cadence and power lanes when those sensors are present; and stat tiles with step
  averages and the heart-rate zone.
- **FR-022b**: The plans list MUST show each plan as a card with a speed-profile thumbnail,
  duration, distance, top speed, Edit and Run, with search. The history list MUST show this week's
  distance, time, runs and average power (or heart rate) with 12 weeks of distance bars, then the
  runs.

**Sensors (ANT+ and Bluetooth)**

- **FR-026**: The app MUST read heart rate (ANT+ heart-rate profile), cadence (ANT+ stride-based
  speed and distance, converted to steps per minute) and running power (ANT+ power) from a USB
  ANT+ stick, and heart rate (0x180D), running power (Cycling Power 0x1818) and cadence (Running
  Speed and Cadence 0x1814) from Bluetooth sensors.
- **FR-027**: Settings MUST let the user scan ANT+ and Bluetooth for about 15 s and list, per metric,
  every sensor heard with an ANT+ or BLE badge, its ANT+ device number or Bluetooth name, battery
  when reported, live value and "In use" / "Standby"; the user MUST be able to Use (pick and
  remember), Pin (keep the one in use) and Forget a sensor. Remembered Bluetooth sensors MUST
  reconnect whenever they are in range.
- **FR-028**: For each metric the user MUST be able to choose the source: Auto (ANT+ first, then
  Bluetooth, then the treadmill), ANT+, Bluetooth, Treadmill (heart rate only) or Off. The status
  MUST say which source each value came from.
- **FR-029**: Power MUST be averaged over a chosen 1, 3 (default) or 10 s. The user MAY set a
  threshold power (drawn as a dashed line and shown as a percentage) and body weight (shown as
  W/kg); both are kept in the server settings.
- **FR-030**: A sensor reading older than 5 s MUST no longer be used. While the treadmill is
  disconnected, its own heart rate and cadence MUST be ignored. Implausible readings MUST be
  ignored.
- **FR-031**: Without an ANT+ stick, or without Bluetooth, the app MUST keep running, say why in
  Settings and keep retrying (ANT+ every 10 s, including after the stick is removed or
  re-attached).
- **FR-032**: Bluetooth sensors MUST NOT be connected unless the user chose them, and the Bluetooth
  library MUST NOT be loaded for sensors until a Bluetooth scan or a remembered Bluetooth sensor
  needs it. Scanning MUST be shared with the Bluetooth treadmill so one never stops the other's.

**Broadcast to Zwift**

- **FR-033**: The Zwift broadcast MUST offer, each switchable: Fitness Machine (speed and incline),
  footpod (Running Speed and Cadence, carrying the chosen cadence), Heart Rate (the chosen heart
  rate, once a second, nothing while none is reported), running power inside the Fitness Machine
  data (off by default), and a Cycling Power sensor carrying the chosen power (off by default,
  silent while no power is reported). Broadcast changes apply after a restart.
- **FR-034**: Settings MUST list devices that have connected to the broadcast, with the services
  they read, and let the user rename and forget them.

**Training programs**

- **FR-035**: Users MUST be able to generate a training program from a goal (5K, 10K, half
  marathon, marathon), a race date (today to two years ahead), 6–24 weeks, 3–6 weekdays to run, an
  easy-run speed and a base incline, preview it week by week, and save it.
- **FR-036**: A program MUST progress through base, build, peak and taper phases, make every 4th
  week before the taper easier, put the long run on the last run day, and end with the race on
  race day; speeds are multiples of the easy speed within the treadmill's limits.
- **FR-037**: Starting a program day MUST save its run as a plan (once) and play it; the program
  MUST show each day as done, missed, today or upcoming, and link to its result in History.
  Deleting a program keeps plans and history made from it.

**Security**

- **FR-023**: Any action that changes treadmill motion or saves/imports plans or settings MUST be
  restricted to paired devices.
- **FR-023a**: On first run (and on demand from the host machine) the app MUST generate a short
  pairing code and show it in the app's console/log output. A paired device MAY ask for a new
  code in Settings; it is shown there (and in the console), pairs one device only and expires
  after 10 minutes. A device becomes paired by entering
  the code once on the control page; the pairing is remembered on that device.
- **FR-023f**: For a browser that will not keep its pairing (e.g. a locked-down Surface Hub), a
  paired device MAY be trusted by its network address from Settings → Paired devices (per device,
  with a warning); requests from that address then count as that device without a code. Untrust
  or removing the device ends it. A device MAY also be added by typing a name and an IP address
  (no pairing at all), and a trusted device's address MAY be edited when it changes.
- **FR-023e**: A pairing MUST expire after 90 consecutive days without use; each authorized request
  from the device renews it. An expired device MUST be treated as unpaired and asked for the code.
- **FR-023b**: Unpaired devices MAY view a page that asks for the pairing code but MUST NOT see live
  data or send any control, plan or settings action.
- **FR-023c**: Repeated wrong pairing codes MUST be rate-limited, and the user MUST be able to list
  and revoke paired devices and regenerate the code.
- **FR-023d**: Pairing secrets MUST NOT appear in logs (other than the one-time code display), in
  the web page source, or in exported plan files.
- **FR-024**: All input from the control page, imported plan files and settings files MUST be
  validated; invalid input MUST be rejected with a clear message and without changing treadmill
  state.
- **FR-025**: Errors shown in the UI MUST NOT reveal internal file paths, stack traces or secrets.

### Key Entities

- **Training Plan**: A named, ordered workout. Attributes: name, optional description, units used
  when authored, list of steps and interval blocks, created/updated dates, computed total
  time/distance.
- **Step**: One segment of a plan. Attributes: optional label, target speed (with the form it was
  entered in: speed or pace, and its unit), target incline, end condition (time or distance) and
  its value.
- **Interval Block**: An ordered group of steps with a repeat count; belongs to a plan.
- **Playback Session**: The single active run of a plan. Attributes: plan, current step index,
  repetition number, elapsed time/distance in step and plan, state (running, paused, stopped) and
  reason for stopping.
- **Workout**: A recorded playback of a plan. Attributes: plan name and a snapshot of the plan as
  run, start/end date-time, end reason, totals (time, distance), average/max heart rate, per-step
  results and samples. Kept until deleted.
- **Step Result**: Actual outcome of one step in a workout. Attributes: step target values, actual
  average speed/incline, time and distance spent, average/max heart rate, whether manually
  overridden.
- **Training program**: Name, goal, weeks, race and start dates, run days and easy speed; and its
  run days, each with date, week, phase, title, description, the run's steps and, once started,
  the plan it was saved as. A day is done when a workout of that plan completed.
- **Sample**: A point-in-time reading during a workout: timestamp, speed, incline, distance, heart
  rate (or missing), and cadence and power when reported.
- **Treadmill Limits**: Min/max speed and incline that all plan steps and commands are checked
  against; part of settings.
- **Settings**: Existing connection and broadcast settings plus units, treadmill limits,
  cool-down walking speed, sensor sources, chosen sensors, power smoothing, threshold power, body
  weight and the power broadcast switches.
- **Sensor**: An ANT+ device (device number, what it measures, maker and battery when it says) or a
  Bluetooth peripheral (id, advertised name, battery) that reports heart rate, cadence and/or
  running power. Chosen sensors are remembered in settings.
- **Browser preferences**: Theme and maximum heart rate, kept in each browser.
- **Paired Device**: A browser/device allowed to control the app. Attributes: display name, paired
  date, last seen, expiry (last seen + 90 days); revocable.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user following only the README can go from a clean Ubuntu-on-WSL environment to a
  loaded control page in under 15 minutes, excluding download time.
- **SC-002**: The same automated test suite passes on Linux, macOS and Windows on every change.
- **SC-003**: A user can create a plan with a warm-up, a 6× interval block and a cool-down in under
  3 minutes on first use.
- **SC-004**: During playback, each step's speed and incline are applied within 2 seconds of the
  step boundary in at least 99% of transitions.
- **SC-005**: When the user presses stop, or the treadmill connection drops, zero further automatic
  speed/incline commands are sent.
- **SC-006**: 100% of out-of-range steps, malformed imports and unauthorized control attempts are
  rejected in automated tests.
- **SC-007**: 100% of plan playbacks, including those ended by stop, connection loss or app crash,
  appear in history with the correct end reason.
- **SC-008**: An exported workout opens in a common spreadsheet program with no manual cleanup, and
  its totals match the history view.
- **SC-009**: All control-page features are usable on a 360-pixel-wide screen without horizontal
  scrolling.
- **SC-010**: A heart-rate, cadence or power sensor appears on the dashboard within 5 s of it
  starting to report, and its value stops being used within 5 s of it going quiet.
- **SC-011**: In automated tests, a sensor picked in Settings is the one used after a restart, and
  Auto prefers ANT+ over Bluetooth over the treadmill, in 100 % of cases.
- **SC-012**: With no sensor reporting power, the Cycling Power broadcast sends no packets and the
  Fitness Machine data carries no power field.
- **SC-013**: In automated tests, every generated program day for every goal and 3–6 run days
  is a valid plan within the treadmill's limits, and a completed run marks its day done.

## Assumptions

- The target user is a single household runner; multi-user accounts and cloud sync are out of scope.
- "Intervals" means repeating groups of steps; heart-rate- or power-driven targets are out of scope.
- Heart rate, cadence and power are recorded and displayed only; they do not drive plan targets.
- Zwift running moves the avatar by speed; power sent to Zwift is for display only.
- Re-broadcasting sensor data over ANT+ (as an ANT+ power meter or footpod) is out of scope for now:
  Zwift on Apple TV and phones cannot receive ANT+, and the stick would have to transmit and receive
  at once.
- ANT+ is the preferred path for sensors; a second Bluetooth adapter is recommended when Bluetooth
  sensors are used alongside the Zwift broadcast.
- Running cadence over Bluetooth (RSC) is taken as steps per minute, the same unit Zwifit sends.
- Workouts are recorded only for plan playbacks; free runs without a plan are not logged in this
  feature. Uploading to third-party fitness services is out of scope.
- Step end conditions support both time and distance, matching the existing Routes feature.
- The existing Routes feature is replaced by Training Plans; its unfinished "play" function is
  superseded by plan playback.
- The existing manual-control and settings features are kept, restyled rather than removed.
- Treadmill speed and incline limits default to conservative values (e.g. 0–12 mph / 0–20 km/h and
  0–15% incline) and can be adjusted in settings.
- The Bluetooth broadcast to Zwift and the treadmill protocols themselves do not change in this
  feature, apart from moving platform-specific code behind clear boundaries.
- The Ubuntu WSL distribution is already installed on the owner's Windows PC, and the owner has
  (or will obtain) a USB Bluetooth LE adapter that can be dedicated to WSL while Zwifit runs.
- The Windows PC has a WSL version and kernel that support USB device passthrough.
- The user's existing settings file continues to work after the upgrade.
