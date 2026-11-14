# Quickstart: Validating ANT+ Broadcast

## Automated (no hardware)

```bash
npm test -- test/unit/core/antBroadcast   # page encoders and counters (contracts/ant-pages.md)
npm test -- test/unit/adapters/antBroadcast.test.js   # channel setup, rotation, stick loss, FR-008
npm test -- test/integration/antBroadcast.test.js     # settings → status, renumber, auth
npm test                                               # whole suite, coverage ≥ 80 % on changed modules
```

Expected: all pass. The adapter tests use the fake stick (research R8): no USB access.

## Simulated treadmill + real stick (the dev server has an ANTUSB2)

1. `npm run start:sim`, open the control page and pair.
2. Settings → **ANT+ broadcast**: turn it on; leave footpod, heart rate, power and treadmill
   ticked. The status shows "Broadcasting" with four device numbers. Heart rate and power show
   "No heart rate right now" until a source exists.
3. The server log shows one line: `ANT+ broadcast ready: footpod #NNNNN, treadmill #NNNNN`.

## Real receiver checks

| Check | Steps | Expected (spec ref) |
|---|---|---|
| Pair footpod | Watch → Sensors → Add → Foot Pod; start a treadmill run on the watch | Finds "Foot Pod NNNNN" matching the footpod number in Settings (US1-1) |
| Pace follows | Change speed on the control page | Watch pace follows within 3 s (SC-002) |
| Belt stops | Pause the belt | Pace goes to 0 and distance stops (US1-4) |
| Distance | Run 1 km on the simulator | Watch distance within 1 % (SC-003) |
| Restart | Restart Zwifit, start a new watch run | Watch reconnects without re-pairing (SC-004) |
| HR / power | Connect a Bluetooth HR strap or Stryd; watch → add HR / power sensor | Same values as the control page; strap off → watch shows sensor lost, not 0 (US2) |
| Treadmill | On a device that supports ANT+ FE treadmills (e.g. Zwift on a PC with an ANT+ stick, or a head unit) pair "Treadmill" | Speed, incline, distance, time shown; nothing the device sends changes the treadmill (US3, SC-006) |
| Stick unplug | Unplug the stick for 5 s, plug it back in | Status shows the reason, then broadcasting again within 10 s, same numbers (US4-2) |
| Scan | Settings → Sensors → Scan ANT+ | Broadcast shows "paused while scanning", resumes after ~15 s |
| Off | Turn ANT+ broadcast off | Watch loses the sensors; Bluetooth broadcast to Zwift and ANT+ sensor reception unaffected (US4-3) |

## Platform notes for the README

Same stick setup as ANT+ sensors, nothing new per OS: Linux and Ubuntu on WSL use
`scripts/wsl/99-zwifit-ant.rules` (WSL also `attach-bluetooth.ps1 -BusId <stick>`); Windows and
macOS as already described in the README's ANT+ sensor section. The README gains an
"ANT+ broadcast" section: what it does, how to pair a watch, and that a scan pauses it.
