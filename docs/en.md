# Duplicati

[Duplicati](https://duplicati.com/) makes encrypted backups of your files to a
disk, a NAS or a cloud storage. This integration brings the backup jobs of a
Duplicati server into Gladys: each job becomes a device with its state, its
last successful backup, the size at the destination and the errors of its last
run. Scenes can react when **any** backup succeeds, fails or is overdue (no
success for too long), a dashboard widget lists the failed backups first, and
a scene can start a backup.

Tested against a real Duplicati 2.4 (Docker image `duplicati/duplicati`): a
backup that succeeds, one with warnings, one that fails after its destination
was deleted, and a backup started from the integration. Not yet tested on a
real Gladys: feedback welcome on
[the issues](https://github.com/guim31/gladys-duplicati/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- Duplicati **2.1 or later** (its web interface on port 8200 by default),
  reachable from the Gladys machine. Duplicati 2.0 and older have another API
  and are not supported.
- The password of the Duplicati web interface. Duplicati 2.1 always protects
  it: set it in the settings of Duplicati, or with the
  `DUPLICATI__WEBSERVICE_PASSWORD` variable of its Docker image.

The integration reads Duplicati every 5 minutes by default (every 30 seconds
while a backup runs): a handful of light requests on your own network.

## Getting started

### 1. Check the address of Duplicati

Open the Duplicati interface from a browser and note its address, for example
`http://192.168.1.2:8200`. If Duplicati only listens to its own machine
(`localhost`), allow the other machines of the network: option
`--webservice-interface=any` (already the case in the Docker image), and add
the name or address used by Gladys to `--webservice-allowed-hostnames` if you
reach it by name.

### 2. Configure the integration

In Gladys, **Integrations → Duplicati → Configuration**:

- **Duplicati address**: the address noted above. A bare address
  (`192.168.1.2`) uses port 8200; an address copied from the browser works too.
- **Password**: the password of the Duplicati interface.
- **Refresh interval**: 1, 5 (default) or 15 minutes.
- **Overdue after**: when a backup without success becomes overdue.
  _Automatic_ (default) follows the schedule of each backup: its period, plus
  the days it skips, plus a quarter of the period (an hour at least) — 30 hours
  for a daily backup. A backup without schedule is then never overdue. Or a
  fixed delay, from 12 hours to a week, for every backup.
- **Allow starting backups**: lets the scene action "Start a backup" work.
  Disable it if nobody should start a backup from Gladys.
- **Language of the names**: language of the feature names, of the states and
  of the scene results.

**Test the connection** reads Duplicati and sums up: the number of backups,
failed and overdue.

### 3. Add the backups

In the **Discover** tab, add the backups to follow, and the "Duplicati" device
for the server. Scene triggers work for every backup, added or not.

## The devices

Each backup job:

| Feature                  | Value                                                    |
| ------------------------ | -------------------------------------------------------- |
| State                    | OK, With warnings, Failed, Overdue, Running or Never run |
| Last successful backup   | day/month hours:minutes, "-" if none                     |
| Hours since last success | in hours                                                 |
| Last run duration        | in seconds                                               |
| Destination size         | the files at the destination, in MB                      |
| Versions                 | backup versions kept at the destination                  |
| Errors of the last run   | number of errors                                         |
| Warnings of the last run | number of warnings                                       |
| Running                  | 1 while this backup runs                                 |
| Next scheduled run       | day/month hours:minutes, "-" without schedule            |

The "Duplicati" device, for the server:

- **Backup running**: 1 or 0;
- **Progress**: in %;
- **Current backup**: its name, "-" if none;
- **Failed backups** and **Overdue backups**: how many.

A backup "succeeds" when Duplicati completes it, with or without warnings: a
version is made. It "fails" when it ends with errors (a destination
unreachable, files missing from the storage…). The state shows what needs
attention first: a failed backup shows "Failed" even when it is also overdue.

## Dashboard

The **Duplicati** widget shows the number of backups failed, overdue and OK,
then one row per backup: failed first, then overdue, running, with warnings,
never run, OK, with the last success (or the progress of the one running).
Every backup by default, or the ones chosen in its settings. The **Refresh**
button reads Duplicati again.

## Scenes

### Triggers

- **A backup succeeds**: a backup completes, with or without warnings.
  Information: backup name, duration (minutes), warnings, versions,
  destination size.
- **A backup fails**: a backup ends with errors. The **Result** filter chooses
  errors, warnings, or both (empty). Information: backup name, first error or
  warning, errors, warnings.
- **A backup is overdue**: a backup has not succeeded for longer than the
  "Overdue after" delay. Once per delay exceeded, again after a new success.
  Information: backup name, hours since last success, last success.

Each trigger can be limited to some backups (empty: any).

### Actions

- **State of a backup**: reads the state of a backup for the next actions:
  failed, overdue, the state in words, the name, the last success, hours since
  last success (-1 if none), and a ready-made sentence ("Photos: Failed, last
  success 18/10 02:05.").
- **Start a backup**: starts a backup now. Duplicati queues it when another one
  runs. Refused when "Allow starting backups" is disabled.

### Scene ideas

- **A backup fails** → send a message with the backup name and its first
  error, picked from the information of the trigger.
- **A backup is overdue** → notify with the backup name and the hours since
  its last success.
- Every Sunday at 10:00 → **State of a backup** → send the sentence; or start
  the backup of the photos when you leave home, with **Start a backup**.

## Troubleshooting

- **"Duplicati does not answer"**: check the address and the port from the
  Gladys machine, and that Duplicati listens to the network
  (`--webservice-interface=any`).
- **"password refused by Duplicati"**: type the password of the interface
  again. Duplicati may also refuse a host name it does not know: add it to
  `--webservice-allowed-hostnames`.
- **"no Duplicati 2.1 or later at this address"**: the address points at
  something else, or at Duplicati 2.0 (update it).
- **"certificate refused"**: a self-signed certificate; use the `http://`
  address on your network.
- **A backup never becomes overdue**: in _Automatic_, a backup without
  schedule cannot be overdue; choose a fixed delay. A backup that has never succeeded is not overdue either: it shows Failed or Never run.
- To see more, set the `LOG_LEVEL` variable of the integration to `debug`.

## Limits

- One Duplicati server per integration.
- Duplicati 2.1 or later only.
- The results come from the log of each backup kept by Duplicati: a backup
  whose local database was deleted shows only what its summary says.
- The integration does not restore, repair or edit backups: it watches them,
  and starts them if allowed.
- Not affiliated with Duplicati. Report a problem or an idea on
  [the issues](https://github.com/guim31/gladys-duplicati/issues).
