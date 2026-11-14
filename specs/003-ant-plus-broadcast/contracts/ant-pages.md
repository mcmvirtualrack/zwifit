# Contract: ANT+ Data Pages Sent by Zwifit

Byte-exact payloads (8 bytes, little-endian) built by `src/core/antBroadcast/pages.js`. Each
encoder is pure and takes validated values; unit tests check these layouts with fixed vectors.

## Footpod (SDM, device type 124)

**Page 1, speed and distance**

| Byte | Content |
|---|---|
| 0 | `0x01` |
| 1 | Time fractional, 1/200 s |
| 2 | Time integer, s (mod 256) |
| 3 | Distance integer, m (mod 256) |
| 4 | bits 7–4 distance fractional (1/16 m), bits 3–0 speed integer (m/s) |
| 5 | Speed fractional, 1/256 m/s |
| 6 | Stride count (mod 256) |
| 7 | Update latency, 1/32 s (0) |

**Page 2, cadence and speed** (only while cadence is known)

| Byte | Content |
|---|---|
| 0 | `0x02` |
| 1–2 | `0xFF` reserved |
| 3 | Cadence integer, strides/min |
| 4 | bits 7–4 cadence fractional (1/16), bits 3–0 speed integer |
| 5 | Speed fractional |
| 6 | `0xFF` reserved |
| 7 | Status: location laces (00), battery new (00), health OK (00), use state (01 active while moving, 00 inactive) |

Order: page 1, page 2 alternate when cadence is known (else page 1 only). Pages 80 and 81 twice
each every 64 messages.

## Heart rate monitor (device type 120)

**Page 4, previous heart beat** (default)

| Byte | Content |
|---|---|
| 0 | `0x04`, bit 7 toggles every 4 messages |
| 1 | Manufacturer-specific `0xFF` |
| 2–3 | Previous heart beat event time, 1/1024 s |
| 4–5 | Heart beat event time, 1/1024 s |
| 6 | Heart beat count (mod 256) |
| 7 | Computed heart rate, bpm |

Background pages every 64 messages, 4 in a row: page 2 (`0x02`, manufacturer 255, serial
0xFFFF) and page 3 (`0x03`, hardware 1, software 1, model 1), bytes 4–7 as in page 4.

## Power meter (device type 11)

**Page 16, power only**

| Byte | Content |
|---|---|
| 0 | `0x10` |
| 1 | Update event count (mod 256) |
| 2 | Pedal power `0xFF` (not used) |
| 3 | Instantaneous cadence `0xFF` (invalid) |
| 4–5 | Accumulated power, W (mod 65 536) |
| 6–7 | Instantaneous power, W |

Pages 80 and 81 every 64 messages (2 each, interleaved).

## Fitness equipment: treadmill (device type 17)

**Page 16, general FE data**

| Byte | Content |
|---|---|
| 0 | `0x10` |
| 1 | Equipment type `19` (treadmill) |
| 2 | Elapsed time, 0.25 s (mod 256) |
| 3 | Distance travelled, m (mod 256) |
| 4–5 | Speed, 0.001 m/s |
| 6 | Heart rate, bpm (`0xFF` when missing) |
| 7 | bits 0–1 HR source (00 invalid, 01 other), bit 2 distance enabled (1), bit 3 virtual speed (0), bits 4–6 FE state (2 ready, 3 in use), bit 7 lap toggle |

**Page 17, general settings**

| Byte | Content |
|---|---|
| 0 | `0x11` |
| 1–2 | `0xFF` reserved |
| 3 | Cycle length `0xFF` (invalid) |
| 4–5 | Incline, 0.01 %, signed int16 |
| 6 | Resistance `0xFF` (invalid) |
| 7 | bits 0–3 `0`, bits 4–7 FE state and lap toggle as in page 16 |

**Page 19, treadmill-specific data**

| Byte | Content |
|---|---|
| 0 | `0x13` |
| 1–3 | `0xFF` reserved |
| 4 | Cadence, strides/min (`0xFF` when missing) |
| 5 | Negative vertical distance, 0.1 m (`0x00`, not tracked) |
| 6 | Positive vertical distance, 0.1 m (mod 256) |
| 7 | bits 0–3 capabilities (bit 1 positive vertical distance), bits 4–7 FE state and lap toggle |

Order per 64 messages: page 16 and page 17/19 alternating (16, 17, 16, 19, …) with pages 80
and 81 twice each. Any acknowledged message received on the channel (e.g. control pages
48–51 or a request page 70) is ignored: no reply, no change (FR-008).

## Common pages

- **80, manufacturer**: `0x50, 0xFF, 0xFF, hwRev 1, mfr 255 (LSB, MSB), model 1 (LSB, MSB)`
- **81, product**: `0x51, 0xFF, swRevSupplemental 0xFF, swRevMain 1, serial 0xFFFFFFFF`
