# Contract: Workout Export CSV

Endpoint: `GET /api/workouts/:id/export.csv` (see [api.md](api.md)).
Filename: `zwifit-<YYYY-MM-DD>-<safe-plan-name>.csv` (only `[A-Za-z0-9-_]`, max 60 chars).

## Format

- UTF-8 with BOM (so Excel detects encoding), CRLF line endings, comma separator, RFC 4180 quoting.
- One header row; every row has every column (empty when not applicable).
- Units follow the user's setting at export time; unit is in the column name suffix.
- Any cell beginning with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'` (CSV injection guard).
  Negative numbers are written as numbers in numeric columns only, which are never user text.

## Columns (imperial example; metric uses `kph`, `km`)

| Column | summary row | step row | sample row |
|--------|-------------|----------|------------|
| `record_type` | `summary` | `step` | `sample` |
| `time_utc` | start time | step start | sample time |
| `elapsed_s` | total seconds | step seconds | seconds since start |
| `step_index` | — | flat index | flat index |
| `step_label` | plan name | label | — |
| `repetition` | — | n | — |
| `target_mph` | — | target | — |
| `target_incline_pct` | — | target | — |
| `speed_mph` | avg | avg actual | actual |
| `incline_pct` | avg | avg actual | actual |
| `distance_mi` | total | step distance | cumulative |
| `hr_bpm` | avg | avg | actual (empty if none) |
| `hr_max_bpm` | max | max | — |
| `event` | end reason | `overridden` / `skipped` / empty | `step` / `override` / `pause` / `resume` / `end` / empty |
| `estimated` | `true`/`false` | — | `true` when fallback speed used |

Row order: 1 summary row, then step rows in order, then sample rows in time order.
