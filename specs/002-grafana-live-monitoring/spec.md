# Feature Specification: Real-Time Grafana Monitoring

**Feature Branch**: `002-grafana-live-monitoring`

**Created**: 2026-11-01

**Status**: Draft

**Input**: User description: "i want to add a feature that will open a grafana dashboard and
eventually can be access by other grafana server so i can see a realtime monitoring of pace speed
and heatrate"

**Depends on**: `001-cross-platform-training-plans` (live heart rate, paired-device security,
cross-platform runtime, workout/plan state).

## Clarifications

### Session 2026-11-01

- Q: Should Grafana show only the live/current session, or also past workouts and long-term
  trends? → A: Live plus every past session, kept until the user deletes it.
- Q: Should Zwifit set up a local Grafana, or should the user install Grafana themselves? → A:
  Grafana is built into Zwifit: installed with Zwifit and started/stopped by Zwifit, with no
  separate Grafana install by the user.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Watch a live Grafana dashboard while running (Priority: P1)

From the Zwifit control page, the runner clicks "Open dashboard" and a Grafana dashboard opens in
the browser showing live speed, pace and heart rate as time-series graphs and current-value panels,
plus incline, distance and the current training-plan step when a plan is running. It works on the
same machine Zwifit runs on, starting with Ubuntu on WSL.

**Why this priority**: This is the core request and delivers value on its own, without any remote
access.

**Independent Test**: With the simulated treadmill producing changing speed and heart rate, click
"Open dashboard" and confirm the graphs update within the latency target and match the control
page values.

**Acceptance Scenarios**:

1. **Given** Zwifit is running and the dashboard is set up, **When** the user clicks "Open
   dashboard" on the control page, **Then** the Zwifit dashboard opens in a new browser tab.
2. **Given** the treadmill speed changes, **When** the user watches the dashboard, **Then** speed
   and pace panels reflect the new value within 5 seconds.
3. **Given** the treadmill reports heart rate, **When** the user watches the dashboard, **Then**
   current, average and max heart rate for the session are shown; when no heart rate is reported,
   the panel shows "no data" rather than zero.
4. **Given** the user's unit setting is imperial or metric, **When** the dashboard is viewed,
   **Then** speed is in mph or km/h and pace in min/mile or min/km accordingly.
5. **Given** a training plan is running, **When** the dashboard is viewed, **Then** it shows the
   plan name, current step and the target vs. actual speed and incline.
6. **Given** the treadmill disconnects or Zwifit stops, **When** the user watches the dashboard,
   **Then** the panels show a gap / "no data" rather than repeating the last value.

---

### User Story 2 - Built-in Grafana that just works (Priority: P2)

Installing Zwifit also installs its built-in Grafana. Starting Zwifit starts Grafana, already
configured with the Zwifit data source and dashboard; stopping Zwifit stops it. The runner never
installs or configures Grafana separately, on Linux/WSL, macOS or Windows.

**Why this priority**: Story 1 is only usable if setup is effortless; it is split out so Story 1
can be tested against a manually prepared Grafana first.

**Independent Test**: On a clean Ubuntu-on-WSL environment, install and start Zwifit using only
its normal steps, click "Open dashboard" and confirm live data appears with no Grafana setup.

**Acceptance Scenarios**:

1. **Given** a clean machine, **When** the user installs and starts Zwifit with its normal
   documented steps, **Then** the built-in Grafana is running with the Zwifit data source and
   dashboard already configured.
2. **Given** Zwifit is stopped, **When** the user checks, **Then** the built-in Grafana has also
   stopped.
3. **Given** the built-in Grafana fails to start (e.g. its port is taken), **When** Zwifit starts,
   **Then** Zwifit still runs and controls the treadmill, and the control page says why the
   dashboard is unavailable and how to fix it.
4. **Given** a newer Zwifit version ships an updated dashboard or Grafana, **When** the user
   upgrades, **Then** the dashboard and Grafana are updated and all stored session data is kept.
5. **Given** the built-in Grafana starts for the first time, **When** the user opens it, **Then** it
   has no default or shared admin password; a unique one is generated and shown to the user once
   (and can be reset from the host machine).
6. **Given** the user wants it off, **When** they disable the built-in dashboard in settings,
   **Then** Grafana is not started and Zwifit runs normally.

---

### User Story 3 - Review past sessions and trends in Grafana (Priority: P3)

The runner opens the dashboard after a workout, or weeks later, picks a time range or a past
session and sees speed, pace, heart rate and incline over time, and trend panels such as weekly
distance and average heart rate at a given pace.

**Why this priority**: Adds long-term value on top of live monitoring, but needs live data
(Story 1) to exist first.

**Independent Test**: Record three simulated sessions on different days, restart Zwifit and confirm
each session and the weekly-distance trend appear in the dashboard; delete one session and confirm
it disappears from Grafana.

**Acceptance Scenarios**:

1. **Given** past sessions exist, **When** the user selects a past time range, **Then** the
   dashboard shows that period's data at full detail.
2. **Given** several weeks of sessions, **When** the user opens the trends view, **Then** weekly
   distance, time and average heart rate are shown per week.
3. **Given** a workout is deleted in Zwifit's history (feature 001), **When** the user views
   Grafana, **Then** that session's data is gone from Grafana too.
4. **Given** the user chooses "delete monitoring data" for a date range in settings, **When** they
   confirm, **Then** all session data in that range is permanently removed.
5. **Given** Zwifit and Grafana restart or are upgraded, **When** the user views past sessions,
   **Then** all previously kept data is still there.

---

### User Story 4 - Let another Grafana server read live and past data (Priority: P4)

The runner (or a coach, or a home-lab server) connects a separate Grafana server on the network to
Zwifit as a data source, using a read-only access token created in Zwifit settings, and builds or
imports the same dashboard there.

**Why this priority**: Explicitly requested as "eventually"; it builds on Stories 1 and 3 and
needs the strongest security controls.

**Independent Test**: From a second machine running Grafana, add Zwifit as a data source with a
token, import the Zwifit dashboard and confirm live data; then revoke the token and confirm access
stops.

**Acceptance Scenarios**:

1. **Given** remote monitoring is off (the default), **When** another machine tries to read the
   data feed, **Then** the request is refused.
2. **Given** the user enables remote monitoring and creates a token, **When** a remote Grafana uses
   that token, **Then** it receives live data and can display it with the exported dashboard.
3. **Given** a token is revoked, **When** the remote Grafana next requests data, **Then** it is
   refused within 5 seconds of revocation.
4. **Given** a valid monitoring token, **When** it is used to try to change speed, incline, plans or
   settings, **Then** the action is refused.
5. **Given** remote monitoring is enabled, **When** a remote Grafana connects, **Then** the data is
   sent over an encrypted connection.

---

### Edge Cases

- Built-in Grafana crashes while Zwifit is running: Zwifit keeps controlling the treadmill, keeps
  storing session data, tries to restart Grafana, and the control page reports the problem.
- Disk nearly full: Zwifit warns the user before session storage fails, and treadmill control is
  never affected by storage errors.
- Zwifit is killed without a clean shutdown: no orphaned Grafana process is left running on the
  next start, and data recorded up to the crash is kept.
- Free runs (treadmill used without a plan) are kept as sessions too and can be deleted by date
  range.
- Treadmill reports no current speed (Pro-Form): pace and speed panels mark values as estimated.
- Speed is zero: pace shows "—" (not infinity or a huge number).
- Heart-rate sensor drops out mid-run: the heart-rate graph shows a gap, other panels continue.
- Many remote readers or a misbehaving client polling very fast: Zwifit keeps controlling the
  treadmill normally; excess requests are throttled.
- Clock differences between the Zwifit machine and a remote Grafana server: graphs still line up
  with the real time of the workout.
- Under WSL, Grafana's browser page must be reachable from the Windows host browser.
- Token leaked or device lost: the user can revoke a single token or all tokens at once.

## Requirements *(mandatory)*

### Functional Requirements

**Live data feed**

- **FR-001**: Zwifit MUST publish a live, read-only data feed containing at least: speed, pace,
  incline, distance, elapsed time, heart rate, treadmill connection status, Bluetooth broadcast
  status, and (when a plan runs) plan name, current step, step target speed and incline.
- **FR-002**: Each value MUST be updated at least once per second while the treadmill is
  connected, and MUST be published in both raw form and the user's display units.
- **FR-003**: Missing values (no heart rate, treadmill disconnected, zero speed for pace) MUST be
  published as absent, never as zero or a stale repeat.
- **FR-004**: The feed MUST run on Linux (including WSL), macOS and Windows without additional
  OS-specific steps beyond those already required by Zwifit.
- **FR-005**: The feed MUST be a format that Grafana can read with a standard, maintained data
  source, so a stock Grafana server can use it without custom plugins.
- **FR-006**: Zwifit MUST store every session's metrics (plan workouts and free runs) at the full
  one-second detail and keep them until the user deletes them; stored data MUST survive restarts and
  upgrades.
- **FR-006a**: Deleting a workout in Zwifit's history (feature 001) MUST delete its stored metrics;
  users MUST also be able to delete all metrics in a chosen date range, after confirmation.
- **FR-006b**: The dashboard MUST let users pick past time ranges and sessions, and MUST include
  weekly trend panels for distance, time and average heart rate.
- **FR-006c**: Zwifit MUST warn the user when free disk space for stored metrics is low, and storage
  failures MUST NOT affect treadmill control or the Zwift broadcast.

**Local dashboard**

- **FR-007**: Zwifit MUST ship a ready-made dashboard definition with panels for speed, pace,
  heart rate (current/avg/max), incline, distance, elapsed time, connection status and current
  plan step.
- **FR-008**: The control page MUST provide an "Open dashboard" action that opens the built-in
  dashboard, and explains the problem and fix if the dashboard is unavailable.
- **FR-009**: Grafana MUST be built into Zwifit: installed by Zwifit's normal install steps on
  Linux (including WSL and Raspberry Pi), macOS and Windows, and pre-configured with the Zwifit data
  source and dashboard. The user MUST NOT need to install or configure Grafana separately.
- **FR-009a**: Zwifit MUST start the built-in Grafana when it starts and stop it when it stops
  (including after a crash, on the next start), and MUST restart it if it exits unexpectedly.
- **FR-009b**: The built-in Grafana MUST be pinned to a tested version supplied with Zwifit and
  updated only through Zwifit upgrades; its integrity MUST be verified before first use.
- **FR-009c**: The built-in Grafana MUST NOT use a default or shared admin password: a unique one is
  generated on first start, shown to the user once, and resettable from the host machine. Anonymous
  editing and sign-up MUST be disabled.
- **FR-009d**: By default the built-in Grafana MUST be reachable only from the Zwifit machine
  (including the Windows host browser when Zwifit runs under WSL). Opening it to other devices on
  the network MUST be an explicit opt-in in settings and MUST require Grafana sign-in.
- **FR-009e**: Users MUST be able to disable the built-in Grafana in settings; Zwifit MUST run
  normally without it.
- **FR-010**: The dashboard definition MUST be exportable from Zwifit so it can be imported into
  any other Grafana server.

**Remote Grafana access & security**

- **FR-011**: Remote access to the data feed MUST be off by default; when off, only the local
  machine may read it.
- **FR-012**: When remote access is enabled, every request MUST present a valid monitoring token.
  Tokens are created, named, listed and revoked in Zwifit settings by a paired device.
- **FR-013**: Monitoring tokens MUST be read-only: they MUST NOT allow any control, plan, settings
  or pairing action, and MUST be separate from device pairings.
- **FR-014**: Remote access MUST use an encrypted connection; tokens MUST NOT be accepted over an
  unencrypted connection from another machine.
- **FR-015**: Token values MUST be shown only once at creation, stored only in a non-reversible
  form, and never written to logs or included in exported dashboards.
- **FR-016**: Failed or excessive token requests MUST be rate-limited and logged (without the token
  value or health data).
- **FR-017**: Heart rate is personal health data: the feed MUST NOT be readable by unpaired devices
  or without a token, and the dashboard export MUST NOT contain recorded data.
- **FR-018**: Serving the feed MUST NOT delay or interfere with treadmill control or the Bluetooth
  broadcast to Zwift.

### Key Entities

- **Live Metric**: A named, timestamped value (e.g. speed, pace, heart rate) with its unit and an
  "estimated" or "missing" flag.
- **Session**: The period from treadmill connection (or plan start) to disconnection (or plan end)
  that metrics belong to; either a plan workout (linked to the Workout from feature 001) or a free
  run. Kept until deleted.
- **Stored Metrics**: The full-detail time series of Live Metrics for every session; deletable per
  workout or by date range.
- **Built-in Grafana**: The Grafana instance supplied and managed by Zwifit. Attributes: pinned
  version, enabled flag, network exposure (local only / network), generated admin credential.
- **Dashboard Definition**: The shipped, versioned Grafana dashboard layout; exportable.
- **Monitoring Token**: A named, read-only credential for a remote Grafana. Attributes: name,
  created date, last used, revoked flag. Value is shown once.
- **Monitoring Settings**: Built-in Grafana on/off and network exposure, remote data access
  on/off, token list.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A speed or heart-rate change on the treadmill is visible on the local dashboard within
  5 seconds in at least 95% of observations.
- **SC-002**: After installing and starting Zwifit with its normal steps, the user sees a live
  dashboard with zero additional Grafana setup steps, on Linux/WSL, macOS and Windows.
- **SC-003**: A remote Grafana server can be connected to Zwifit and show live data in under
  10 minutes using only the documented steps and an exported dashboard.
- **SC-004**: 100% of requests without a valid token from another machine, and 100% of control
  attempts using a monitoring token, are refused in automated tests.
- **SC-005**: Running the dashboard and up to 3 remote Grafana readers does not delay treadmill
  commands or the Zwift broadcast by more than 100 ms compared with no monitoring.
- **SC-006**: A year of daily one-hour sessions uses less than 1 GB of disk, and any past session
  in that year loads in the dashboard within 5 seconds.
- **SC-007**: Starting Zwifit with the built-in Grafana enabled adds no more than 30 seconds before
  the dashboard is available on a Raspberry Pi 3B+ class device, and treadmill control is available
  without waiting for Grafana.
- **SC-008**: Dashboard values match the Zwifit control page values for speed, pace and heart rate
  in 100% of sampled comparisons (allowing for rounding).

## Assumptions

- Grafana is the only dashboard tool in scope; other monitoring tools are not.
- Heart rate comes from the treadmill's pulse sensor, as in feature 001.
- Pace is derived from speed; when speed is zero, pace is absent.
- "Other Grafana server" means a Grafana on the same home network or reached by the user's own
  network setup (e.g. VPN); exposing Zwifit directly to the public internet is out of scope.
- Dashboard alerts (e.g. heart-rate zone alarms) are out of scope.
- Grafana users beyond the generated admin are managed in Grafana itself, not by Zwifit.
- Grafana is distributed under its own open-source licence (AGPL), which differs from Zwifit's MIT
  licence; bundling it unmodified as a separate program, with its licence and source location
  included, is assumed acceptable. Planning must confirm this before release.
- The built-in Grafana adds a noticeable download size and memory use; low-memory devices (e.g.
  Raspberry Pi Zero W) may need it disabled, which FR-009e allows.
