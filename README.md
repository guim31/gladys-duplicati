# Duplicati for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings the backup jobs of a [Duplicati](https://duplicati.com/) server
(2.1 or later) into Gladys: their state, and an alert when a backup fails or
stops running.

- **One device per backup job**: state (OK, with warnings, failed, overdue,
  running, never run), last successful backup, hours since then, duration of
  the last run, size at the destination, versions kept, errors and warnings of
  the last run, running, next scheduled run.
- **One server device**: a backup running, its progress and name, the number
  of backups failed and overdue.
- **Scene triggers**: a backup succeeds, a backup fails (errors, and warnings
  if chosen), a backup is overdue (no success for longer than its schedule, or
  a fixed delay) — for any backup, added to Gladys or not.
- **Scene actions**: state of a backup (with a ready-made sentence), start a
  backup (can be disabled in the configuration).
- **Dashboard widget**: failed backups first, then the overdue ones, then the
  others.
- Texts in English, French, German and Spanish.

Tested against a real Duplicati 2.4 (Docker image `duplicati/duplicati`): a
backup succeeded, one with warnings, one failed after its destination was
deleted, and a backup started from the integration. Not yet tested on a real
Gladys: feedback welcome on
[the issues](https://github.com/guim31/gladys-duplicati/issues).

## Requirements

- Gladys Assistant 5.1.0 or later.
- Duplicati 2.1 or later, its web interface reachable from the Gladys machine
  (port 8200 by default), and its password. Duplicati 2.0 is not supported.

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-duplicati`. Then open its configuration,
enter the address of Duplicati and the password of its interface, and add the
backups from the Discover tab.

The full guide: [docs/en.md](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

The container logs in to the REST API of Duplicati (`/api/v1/auth/login`, an
access token kept in memory) and reads the jobs, the server state and, when a
job ran, its log, every 5 minutes by default and every 30 seconds while a
backup runs. It publishes the states of the devices added to Gladys when they
change, and fires the scene events on the new runs and on the jobs turning
overdue. The last run seen of each job is kept in `/data`, so a backup that
failed during a restart is announced once. Redirects are not followed, so the
password is never sent to another host.

## Limits

- One Duplicati server per configuration.
- The integration watches and starts backups; it does not restore, repair or
  edit them.
- A self-signed HTTPS certificate is not accepted (use `http://` on the local
  network).

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the notes on the
Duplicati API.

## Credits

- [Duplicati](https://github.com/duplicati/duplicati) by its contributors
  (MIT): the API answers in `test/fixtures/duplicati` come from its Docker
  image. The logo on the cover is the Duplicati logo, from its repository.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and on the architecture of
  [gladys-healthchecks](https://github.com/guim31/gladys-healthchecks).

Not affiliated with Duplicati or Duplicati Inc.
