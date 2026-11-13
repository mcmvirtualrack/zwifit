<!--
Sync Impact Report
- Version: 1.0.0 (no principle changes since adoption)
- Follow-up TODOs from adoption: all resolved by feature 001-cross-platform-training-plans
  (CI on ubuntu/macos/windows x Node 24/26, Jest coverage thresholds, Node-based web build,
  README on Node 24 LTS, npm audit gate, paired-device authentication on the control API).
  raspberrypi.sh stays a shell script: it only runs on a Pi (plan.md Complexity Tracking).
-->
# Zwifit Constitution

## Core Principles

### I. Security First (NON-NEGOTIABLE)

Security outranks features, performance and convenience. When principles conflict, this one wins.

- All external input MUST be treated as untrusted and validated: WebSocket/HTTP messages,
  BLE characteristic writes, treadmill responses, settings files and CLI arguments.
- Commands that change treadmill speed or incline MUST be bounds-checked against safe limits
  before being sent; out-of-range or malformed values MUST be rejected, never clamped silently
  into motion.
- Network-exposed endpoints that can control hardware MUST require authentication or an
  explicit, documented opt-in, and MUST default to the narrowest practical bind address.
- Secrets (credentials, tokens, device keys) MUST NOT be committed, logged or sent to the web
  client; they live in local, git-ignored configuration.
- The app MUST run with least privilege: no `sudo` at runtime; use scoped capabilities
  (e.g. `cap_net_raw`) where hardware access requires it.
- Dynamic code execution (`eval`, `new Function`) and shell command construction from input
  are prohibited.
- New or upgraded dependencies MUST pass `npm audit` with no high or critical findings, or
  carry a documented, time-boxed exception.

Rationale: this software controls a moving machine a person stands on and listens on local
networks; a security flaw can become a physical-safety incident.

### II. Thorough, Test-First Verification (NON-NEGOTIABLE)

- Every feature and bug fix MUST ship with automated Jest tests; tests are written first and
  MUST fail before the implementation makes them pass.
- Tests MUST cover the happy path, edge cases, error handling and security cases (malformed,
  oversized, out-of-range and unauthenticated input).
- Every bug fix MUST include a regression test that reproduces the bug.
- Changed modules MUST reach at least 80% line and branch coverage; lowering coverage
  requires justification in the PR.
- Tests MUST run without physical hardware by using the isolation layer (Principle IV) and
  MUST be deterministic (no reliance on real network, Bluetooth, wall-clock timing or order).
- `npm test` MUST pass on macOS, Linux and Windows before merge.

Rationale: hardware and protocol bugs are hard to reproduce by hand; only automated tests make
them visible and keep them fixed.

### III. Cross-Platform Portability (macOS, Linux, Windows)

- Every feature MUST work on macOS, Linux (including Raspberry Pi / ARM) and Windows, or
  document a justified exception with graceful degradation.
- File paths MUST be built with `path`/`os` APIs; no hard-coded separators, home directories
  or line endings.
- Build, setup and run tooling MUST be invocable through `npm` scripts or Node scripts; shell-
  or PowerShell-only scripts MAY exist only as convenience wrappers with a cross-platform
  equivalent.
- Native dependencies MUST support all three platforms or be optional with a fallback.
- The supported Node.js LTS version MUST be declared in `package.json` `engines` and in the
  README, with per-OS setup instructions kept current.

Rationale: users run Zwifit on whatever machine sits next to their treadmill; portability must
be designed in, not patched in later.

### IV. Hardware & Platform Isolation

- Bluetooth, Wi-Fi/iFit transport and OS-specific code MUST sit behind small, documented
  interfaces so the core logic (speed/incline conversion, RSC/FTMS calculations, settings)
  is pure, platform-neutral and unit-testable.
- Platform-specific branches MUST be confined to adapter modules, never scattered through
  core logic.
- Each adapter MUST have a test double used by the test suite.

Rationale: isolation makes both Principle II (testing without hardware) and Principle III
(swapping platform adapters) achievable.

## Security & Safety Requirements

- Every feature plan (`/speckit-plan`) MUST include a short threat model: assets, entry
  points, trust boundaries and mitigations.
- Logs MUST NOT contain secrets or personal data beyond what is needed for debugging.
- Errors returned to clients MUST NOT leak stack traces or internal paths.
- Third-party code bundled in the web UI MUST be from the lockfile-pinned build, not loaded
  from remote CDNs at runtime.
- Suspected vulnerabilities MUST be fixed before unrelated feature work proceeds.

## Development Workflow & Quality Gates

A change merges only when all of these hold:

1. Tests written first and passing locally (`npm test`).
2. CI green on ubuntu, macos and windows runners.
3. Coverage thresholds from Principle II met.
4. `npm audit` shows no unresolved high or critical findings.
5. Review confirms compliance with every principle, with the threat model checked for
   changes touching network, Bluetooth, settings or treadmill control.
6. User-facing setup or behavior changes are reflected in the README for all three OSes.

## Governance

- This constitution supersedes other practices and conventions in this repository.
- Amendments are made by pull request that updates this file, states the rationale, bumps the
  version and lists any migration work for existing code.
- Versioning follows semantic versioning: MAJOR for removing or redefining a principle, MINOR
  for adding a principle or materially expanding guidance, PATCH for clarifications.
- Every spec, plan and review MUST check compliance; any deviation MUST be recorded with its
  justification in the plan's Complexity Tracking section.
- Code written before this constitution is brought into compliance when it is touched.

**Version**: 1.0.0 | **Ratified**: 2026-11-01 | **Last Amended**: 2026-11-01
