# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.0] - 2026-10-19

### Added

- The backup jobs of a Duplicati server (2.1 or later) in Gladys: one device
  per job (state, last successful backup, hours since then, last run duration,
  destination size, versions, errors and warnings of the last run, running,
  next scheduled run) and one server device (backup running, progress, current
  backup, backups failed and overdue).
- Scene triggers: a backup succeeds, a backup fails (errors, and warnings if
  chosen), a backup is overdue (automatic delay from its schedule, or a fixed
  one) — for any backup, added to Gladys or not, kept across restarts.
- Scene actions: state of a backup (with a ready-made sentence), start a backup
  (can be disabled in the configuration).
- Dashboard widget: failed backups first, then the overdue ones, then the
  others, with a Refresh button.
- "Test the connection"; texts and documentation in English, French, German
  and Spanish.

[Unreleased]: https://github.com/guim31/gladys-duplicati/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-duplicati/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-duplicati/releases/tag/v1.0.0
