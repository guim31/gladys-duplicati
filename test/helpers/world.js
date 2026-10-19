// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Duplicati, a temporary
// /data and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs: the tests read Duplicati with
// `world.hub.pollNow()`. (Adapted from guim31/gladys-healthchecks.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { jobIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { BASE, FakeDuplicati, PASSWORD } from './fakeDuplicati.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const HOUR = 3_600_000;
export const START = Date.UTC(2026, 9, 19, 10, 0, 0);

/** A manual clock, shared by the hub, the fake and the tests. */
export function createClock(start = START) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * The default server: a daily backup made 8 hours ago, a daily backup that
 * failed 2 hours ago (last success 26 hours ago), a manual one never run.
 */
export function defaultDuplicati(now = START) {
  const fake = new FakeDuplicati();
  fake.add('Documents NAS', { next: now + 16 * HOUR });
  fake.run('Documents NAS', 'success', { end: now - 32 * HOUR });
  fake.run('Documents NAS', 'success', { end: now - 8 * HOUR, seconds: 420 });
  fake.add('Photos offsite', { next: now + 16 * HOUR });
  fake.run('Photos offsite', 'success', { end: now - 26 * HOUR });
  fake.run('Photos offsite', 'fatal', {
    end: now - 2 * HOUR,
    message: 'Found 3 files that are missing from the remote storage, please run repair',
  });
  fake.add('Archive', { schedule: null });
  return fake;
}

export async function createWorld({
  clock = createClock(),
  duplicati = defaultDuplicati(clock.time),
  config = { url: BASE, password: PASSWORD, language: 'en' },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-duplicati-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: duplicati.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, duplicati, app, hub: app.hub, clock, dataDir };
}

/** External ids of the device of a job of the fake, by name. */
export const idsOf = (world, name) => jobIds(world.gladys, world.duplicati.byName(name).id);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { BASE, FakeDuplicati, PASSWORD };
