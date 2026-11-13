# Feature Specification: Backup and Restore

**Feature Branch**: `004-backup-restore`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: "Ability to back up and restore settings, training plans, training programs, and workout history"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Download a backup (Priority: P1)

A runner has built up months of workout history, a set of training plans and programs, and settings
tuned to their treadmill. They want a copy of all of it somewhere safe (their laptop, a USB stick,
cloud storage) so that a failed SD card, a reinstall or a mistake does not wipe it out. From the
Zwifit settings they choose "Download backup" and get a single file containing everything.

**Why this priority**: Without a backup there is nothing to restore. A downloadable backup on its
own already protects the user's data, even before restore exists (it can be restored by hand).

**Independent Test**: With a few plans, programs and recorded workouts in place, download a
backup and confirm the file is produced, is named with the date, and lists every plan, program
and workout, plus the settings.

**Acceptance Scenarios**:

1. **Given** a paired device and existing plans, programs, workouts and settings, **When** the
   user chooses "Download backup", **Then** a single file is saved to their device containing all
   of them, named with "zwifit-backup" and the date and time it was made.
2. **Given** a Zwifit with no plans, programs or workouts yet, **When** the user downloads a
   backup, **Then** a valid backup is still produced containing the settings and empty
   collections.
3. **Given** a backup is being made, **When** a workout is running, **Then** the backup still
   succeeds and includes every workout completed before it started; the running workout is
   included as far as it has been recorded.
4. **Given** a device that has not been paired, **When** it tries to download a backup, **Then**
   it is refused.

---

### User Story 2 - Restore from a backup (Priority: P1)

After reinstalling Zwifit, moving it to a new computer or Raspberry Pi, or undoing a mistake, the
user opens Settings, chooses "Restore from backup", picks a backup file, sees a summary of what it
contains, confirms, and gets their settings, plans, programs and history back.

**Why this priority**: This is the reason backups exist: getting the data back. It is equally
critical to Story 1 but depends on it for test files.

**Independent Test**: Make a backup, delete or change some plans, programs and workouts, restore
the backup, and confirm everything matches the state at the time of the backup.

**Acceptance Scenarios**:

1. **Given** a valid backup file, **When** the user selects it, **Then** before anything changes
   they see a summary: when the backup was made, which Zwifit version made it, and how many
   plans, programs and workouts it holds, and are asked to confirm.
2. **Given** the user confirms a restore, **When** it completes, **Then** the settings, plans,
   programs and workouts match the backup (according to the chosen restore mode, see FR-010),
   and every open Zwifit page shows the restored data without a manual reload.
3. **Given** the user confirms a restore, **When** it starts, **Then** a safety backup of the
   current data is made automatically first, so the restore itself can be undone.
4. **Given** a file that is not a Zwifit backup, is damaged, or was made by a newer Zwifit that
   this one does not understand, **When** the user selects it, **Then** it is rejected with a
   clear message and nothing is changed.
5. **Given** a workout or plan is running on the treadmill, **When** the user tries to restore,
   **Then** they are told to stop it first and nothing is changed.
6. **Given** a restore fails part-way (for example the disk fills up), **When** the failure
   happens, **Then** the data is left exactly as it was before the restore began and the user is
   told it failed.

---

### User Story 3 - Move to a different machine (Priority: P2)

The user moves Zwifit from a Windows PC to a Raspberry Pi (or any other supported platform). They
restore a backup made on the old machine. Their plans, programs, history and preferences arrive,
but the new machine keeps its own network and security setup so it stays reachable.

**Why this priority**: Migration is a common reason for wanting a backup, but it only adds rules
about which settings travel; the core backup/restore flow is Stories 1 and 2.

**Independent Test**: Make a backup on one machine, restore it on another with a different server
port and HTTPS setup, and confirm the data arrives while the second machine's server address,
HTTPS setup and paired devices are unchanged.

**Acceptance Scenarios**:

1. **Given** a backup from another machine, **When** it is restored, **Then** the receiving
   machine keeps its own server address, port and HTTPS setup, and its own paired devices.
2. **Given** a backup from another machine, **When** it is restored, **Then** treadmill
   connection details, speed and incline limits, units, broadcast and sensor preferences are
   restored from the backup.
3. **Given** a restored backup whose speed or incline limits exceed what the connected treadmill
   supports, **When** it is restored, **Then** the treadmill's own limits still apply and no
   plan step can exceed them.

---

### Edge Cases

- A backup file far larger than any real backup (for example, hundreds of megabytes): rejected
  before it is processed, with a message saying it is too large.
- A backup containing a plan, program or workout that is malformed or fails validation: the whole
  restore is rejected and the message names what was wrong; nothing is partially applied.
- A backup containing entries with unexpected identifiers or names that try to escape Zwifit's
  data folder: rejected; nothing outside Zwifit's own data is ever written.
- A backup made by an older Zwifit version: accepted, and upgraded the same way Zwifit upgrades
  its own older data on start.
- Two devices start a restore at the same time: only one proceeds; the other is told a restore
  is already in progress.
- A program refers to a plan that is not in the backup: restored, and the program shows the
  missing plan the same way it does today when a plan has been deleted.
- The user closes the page during a restore: the restore either completes or leaves the data
  unchanged; it never leaves data half-restored.
- Safety backups accumulate over many restores: only the most recent few are kept.

## Requirements *(mandatory)*

### Functional Requirements

**Backup**

- **FR-001**: Users on a paired device MUST be able to download a backup from Settings as a
  single file.
- **FR-002**: A backup MUST contain: settings, all training plans, all training programs, all
  workout history (summaries and recorded samples), and the remembered Zwift devices list.
- **FR-003**: A backup MUST NOT contain secrets: no pairing code, no paired-device credentials,
  no HTTPS private keys or certificates.
- **FR-004**: A backup MUST record when it was made, the Zwifit version that made it, and a
  backup format version.
- **FR-005**: The backup file name MUST include "zwifit-backup" and the date and time it was made.
- **FR-006**: Making a backup MUST NOT interrupt a running workout or the Zwift broadcast.

**Restore**

- **FR-007**: Users on a paired device MUST be able to restore from a backup file chosen from
  their device, from Settings.
- **FR-008**: Before changing anything, the system MUST validate the whole backup and show a
  summary (date made, Zwifit version, counts of plans, programs and workouts) and require the
  user to confirm.
- **FR-009**: The system MUST validate every item in a backup with the same rules used for data
  entered normally (including speed and incline bounds), and reject the whole backup if any item
  is invalid, if the file is not a Zwifit backup, or if its format version is newer than this
  Zwifit understands.
- **FR-010**: A restore MUST [NEEDS CLARIFICATION: restore mode — should restoring replace all
  current data with the backup's contents, merge the backup into current data (adding items
  that are missing and keeping everything else), or let the user choose each time?]
- **FR-011**: Before applying a restore, the system MUST automatically save a safety backup of
  the current data on the Zwifit computer, keep the 3 most recent safety backups (deleting
  older ones), and let the user download any of them from Settings.
- **FR-012**: A restore MUST be all-or-nothing: if any part fails, all data MUST be left as it was
  before the restore started.
- **FR-013**: A restore MUST be refused while a plan or program workout is running, and while
  another restore is in progress.
- **FR-014**: A restore MUST keep the receiving machine's server address, port, HTTPS setup,
  pairing code and paired devices, regardless of what the backup contains.
- **FR-015**: After a restore, every connected Zwifit page MUST show the restored data without a
  manual reload, and settings that need a restart to take effect MUST be flagged the same way a
  normal settings change flags them.
- **FR-016**: The system MUST reject backup files larger than a fixed maximum size before reading
  their contents, with a message stating the limit.
- **FR-017**: Rejection and failure messages MUST tell the user what was wrong in plain language
  and MUST NOT reveal internal file paths or technical traces.
- **FR-018**: Backups and restores MUST be recorded in the Zwifit log (time, device name, counts,
  outcome) without logging the backup's contents.
- **FR-019**: Backup and restore MUST work the same on every platform Zwifit supports, and a
  backup made on one platform MUST restore on any other.

### Key Entities

- **Backup**: one file holding a snapshot of a Zwifit's user data. Has a format version, the
  Zwifit version that made it, when it was made, and the collections below.
- **Settings**: the user's preferences (units, limits, treadmill connection, broadcast and sensor
  choices). Split into portable settings, which a restore applies, and machine settings (server
  address, port, HTTPS), which a restore never changes.
- **Training plan**: a named sequence of speed/incline steps.
- **Training program**: a schedule of plans across days or weeks, with the user's progress.
- **Workout**: a recorded session: its summary and the recorded samples (speed, incline, heart
  rate, etc. over time).
- **Remembered Zwift device**: a Zwift device the broadcast has seen, with the name the user gave
  it.
- **Safety backup**: a backup made automatically on the Zwifit computer just before a restore,
  so the restore can be undone.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can download a complete backup in under 30 seconds and two actions from the
  dashboard, with a year of daily workout history.
- **SC-002**: A user can restore a backup, including reviewing its summary, in under 2 minutes.
- **SC-003**: Restoring a backup reproduces 100% of the plans, programs, workouts and portable
  settings it contains, identical to what was backed up.
- **SC-004**: 100% of invalid, damaged, oversized or hostile backup files are rejected with no
  change to existing data.
- **SC-005**: After restoring a backup made on another machine, the receiving machine remains
  reachable at its existing address, and already-paired devices stay paired, in 100% of cases.
- **SC-006**: Any restore can be undone by restoring the safety backup it created.

## Assumptions

- Any paired device may back up and restore; Zwifit has no separate administrator role, and
  pairing is already the gate for changing settings and controlling the treadmill.
- Backups are downloaded to and uploaded from the user's own device through the Zwifit page;
  scheduled or automatic off-device backups (cloud, network shares) are out of scope.
- Backups are not encrypted: they contain no secrets (FR-003), only workout data and
  preferences. Users who want encryption can store the file somewhere encrypted.
- Restoring only part of a backup (for example, only plans) is out of scope for this version.
- A year of daily workouts produces a backup of a few tens of megabytes at most; the maximum
  accepted file size will be set comfortably above that.
- Safety backups are kept in Zwifit's own data folder; to undo a restore, the user downloads the
  safety backup (FR-011) and restores it like any other backup.
- The existing settings-change behaviour (validation, restart-needed notice) is reused for
  restored settings.
