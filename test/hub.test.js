// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a fake Duplicati: discovery,
// states, scene events on runs and overdue jobs, persistence across restarts,
// the backup running, the start action, errors, quiet logs, the widget and
// the reading timer of the container.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS, SERVER_KEYS, overdueAfterMs, serverIds } from '../src/devices.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import {
  BASE,
  FakeDuplicati,
  HOUR,
  PASSWORD,
  START,
  createClock,
  createDevices,
  createWorld,
  idsOf,
} from './helpers/world.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const state = (world, name, key) => world.fake.lastState(idsOf(world, name).feature(key));

test('one device per job and one for the server, proposed in Discovery, nothing polled by Gladys', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.name),
    ['Duplicati', 'Documents NAS', 'Photos offsite', 'Archive'],
  );
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
  }
  // Nothing is published for devices not added, and the first read fires nothing.
  assert.equal(world.fake.states.length, 0);
  assert.equal(world.fake.sceneEvents.length, 0);
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('the states of the added devices: success, failure, never run', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(state(world, 'Documents NAS', FEATURE_KEYS.STATE), 'OK');
  assert.equal(state(world, 'Documents NAS', FEATURE_KEYS.HOURS_SINCE_SUCCESS), 8);
  assert.equal(state(world, 'Documents NAS', FEATURE_KEYS.LAST_DURATION), 421);
  assert.equal(state(world, 'Documents NAS', FEATURE_KEYS.VERSIONS), 2);
  assert.equal(state(world, 'Documents NAS', FEATURE_KEYS.DESTINATION_SIZE), 1234.6);
  assert.equal(state(world, 'Documents NAS', FEATURE_KEYS.RUNNING), 0);
  assert.notEqual(state(world, 'Documents NAS', FEATURE_KEYS.NEXT_RUN), '-');

  assert.equal(state(world, 'Photos offsite', FEATURE_KEYS.STATE), 'Failed');
  assert.equal(state(world, 'Photos offsite', FEATURE_KEYS.ERRORS), 1);
  // The last success is the run before the failure.
  assert.equal(state(world, 'Photos offsite', FEATURE_KEYS.HOURS_SINCE_SUCCESS), 26);

  assert.equal(state(world, 'Archive', FEATURE_KEYS.STATE), 'Never run');
  assert.equal(state(world, 'Archive', FEATURE_KEYS.LAST_SUCCESS), '-');
  assert.equal(state(world, 'Archive', FEATURE_KEYS.HOURS_SINCE_SUCCESS), undefined);

  const server = serverIds(world.gladys);
  assert.equal(world.fake.lastState(server.feature(SERVER_KEYS.FAILED)), 1);
  assert.equal(world.fake.lastState(server.feature(SERVER_KEYS.RUNNING)), 0);
  assert.equal(world.fake.lastState(server.feature(SERVER_KEYS.CURRENT_JOB)), '-');
});

test('a new run fires "succeeded" or "failed", warnings both, once', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const { duplicati, clock } = world;

  clock.advance(HOUR);
  duplicati.run('Documents NAS', 'success', { end: clock.time, seconds: 600 });
  await world.hub.pollNow();
  assert.deepEqual(events(world, TRIGGERS.SUCCEEDED).at(-1).data, {
    device: idsOf(world, 'Documents NAS').device,
    job: 'Documents NAS',
    duration_minutes: 10,
    warnings: 0,
    versions: 3,
    destination_size: '1.2 GB',
  });
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SUCCEEDED).length, 1, 'not twice');

  clock.advance(HOUR);
  duplicati.run('Documents NAS', 'error', { end: clock.time, message: 'Disk full' });
  await world.hub.pollNow();
  assert.deepEqual(events(world, TRIGGERS.FAILED).at(-1).data, {
    device: idsOf(world, 'Documents NAS').device,
    job: 'Documents NAS',
    result: 'error',
    message: 'Disk full',
    errors: 1,
    warnings: 0,
  });

  clock.advance(HOUR);
  duplicati.run('Documents NAS', 'warning', { end: clock.time, message: 'File locked' });
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SUCCEEDED).length, 2);
  assert.equal(events(world, TRIGGERS.FAILED).at(-1).data.result, 'warning');
  assert.equal(events(world, TRIGGERS.FAILED).at(-1).data.message, 'File locked');
  assert.equal(world.hub.find(idsOf(world, 'Documents NAS').device).lastSuccess, clock.time);
});

test('a job becomes overdue once, by its schedule, and back when it succeeds', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const { duplicati, clock } = world;
  // Documents NAS: daily, last success 8 hours ago; overdue after 24 + 6 hours.
  clock.advance(21 * HOUR);
  await world.hub.pollNow();
  const documents = () =>
    events(world, TRIGGERS.OVERDUE).filter((event) => event.data.job === 'Documents NAS');
  assert.equal(documents().length, 0);
  clock.advance(2 * HOUR);
  await world.hub.pollNow();
  const overdue = documents();
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].data.job, 'Documents NAS');
  assert.equal(overdue[0].data.hours_since_success, 31);
  assert.equal(state(world, 'Documents NAS', FEATURE_KEYS.STATE), 'Overdue');
  // Photos offsite is overdue too, but failed: its state says "Failed".
  assert.equal(state(world, 'Photos offsite', FEATURE_KEYS.STATE), 'Failed');
  assert.equal(world.fake.lastState(serverIds(world.gladys).feature(SERVER_KEYS.OVERDUE)), 2);

  await world.hub.pollNow();
  assert.equal(documents().length, 1, 'not twice');
  duplicati.run('Documents NAS', 'success', { end: clock.time });
  await world.hub.pollNow();
  assert.equal(state(world, 'Documents NAS', FEATURE_KEYS.STATE), 'OK');
});

test('a log unreadable for a while fires nothing, and the run after it fires once', async (t) => {
  const world = await createWorld({ timings: { resultsEveryMs: 0 } });
  t.after(() => world.app.stop());
  world.duplicati.logFailure = 500;
  await world.hub.pollNow();
  world.duplicati.logFailure = null;
  await world.hub.pollNow();
  assert.equal(world.fake.sceneEvents.length, 0);
  assert.equal(world.fake.connectionStatus.connected, true);
  world.clock.advance(HOUR);
  world.duplicati.run('Archive', 'success', { end: world.clock.time });
  world.duplicati.logFailure = 500;
  await world.hub.pollNow(); // the Metadata changed, the log cannot be read yet
  world.duplicati.logFailure = null;
  await world.hub.pollNow();
  assert.deepEqual(
    world.fake.sceneEvents.map((event) => [event.key, event.data.job]),
    [[TRIGGERS.SUCCEEDED, 'Archive']],
  );
});

test('the last success stays known when the failures push it out of the log page', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const before = world.hub.find(idsOf(world, 'Photos offsite').device).lastSuccess;
  for (let i = 0; i < 12; i += 1) {
    world.clock.advance(HOUR);
    world.duplicati.run('Photos offsite', 'error', { end: world.clock.time });
    // A run that went to its end with errors moves the Metadata too.
    world.duplicati.byName('Photos offsite').metadata.LastBackupFinished = new Date(
      world.clock.time,
    )
      .toISOString()
      .replace(/[-:]|\.\d+/g, '');
    await world.hub.pollNow();
  }
  assert.equal(world.hub.find(idsOf(world, 'Photos offsite').device).lastSuccess, before);
});

test('a failed backup running again still counts as failed, and actions recover after an outage', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.duplicati.activeJobId = world.duplicati.byName('Photos offsite').id;
  await world.hub.pollNow();
  assert.equal(world.fake.lastState(serverIds(world.gladys).feature(SERVER_KEYS.FAILED)), 1);
  world.duplicati.activeJobId = null;
  world.duplicati.failure = 'down';
  await world.hub.pollNow();
  world.duplicati.failure = null;
  world.clock.advance(60_000);
  const ack = await world.fake.sceneAction('get_backup_status', {
    device: idsOf(world, 'Archive').device,
  });
  assert.equal(ack.success, true, ack.error);
});

test('the overdue threshold: automatic, weekdays only, none without schedule, or fixed', () => {
  const daily = { schedule: { periodMs: 24 * HOUR, allowedDays: 7 } };
  const weekdays = { schedule: { periodMs: 24 * HOUR, allowedDays: 5 } };
  const hourly = { schedule: { periodMs: HOUR, allowedDays: 7 } };
  const weekly = { schedule: { periodMs: 7 * 24 * HOUR, allowedDays: 1 } };
  assert.equal(overdueAfterMs(daily, null), 30 * HOUR);
  assert.equal(overdueAfterMs(weekdays, null), 78 * HOUR);
  assert.equal(overdueAfterMs(hourly, null), 2 * HOUR);
  assert.equal(overdueAfterMs(weekly, null), 7 * 24 * HOUR + 42 * HOUR);
  assert.equal(overdueAfterMs({ schedule: null }, null), null);
  assert.equal(overdueAfterMs({ schedule: null }, 48), 48 * HOUR);
});

test('a run made while the integration was stopped is announced after a restart, once', async (t) => {
  const clock = createClock();
  const first = await createWorld({ clock });
  await first.app.stop();
  clock.advance(HOUR);
  first.duplicati.run('Documents NAS', 'fatal', { end: clock.time });
  const second = await createWorld({ clock, duplicati: first.duplicati, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.equal(events(second, TRIGGERS.FAILED).length, 1);
  await second.app.stop();
  const third = await createWorld({ clock, duplicati: first.duplicati, dataDir: first.dataDir });
  t.after(() => third.app.stop());
  assert.equal(events(third, TRIGGERS.FAILED).length, 0);
});

test('a backup running: the server shows it and its progress; the log is read again at its end', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const { duplicati, clock } = world;
  const server = serverIds(world.gladys);
  duplicati.activeJobId = duplicati.byName('Archive').id;
  duplicati.progress = { OverallProgress: 0, ProcessedFileSize: 300, TotalFileSize: 1000 };
  await world.hub.pollNow();
  assert.equal(world.fake.lastState(server.feature(SERVER_KEYS.RUNNING)), 1);
  assert.equal(world.fake.lastState(server.feature(SERVER_KEYS.PROGRESS)), 30);
  assert.equal(world.fake.lastState(server.feature(SERVER_KEYS.CURRENT_JOB)), 'Archive');
  assert.equal(state(world, 'Archive', FEATURE_KEYS.RUNNING), 1);
  assert.equal(state(world, 'Archive', FEATURE_KEYS.STATE), 'Running');

  // While it runs, the logs are not read again.
  const logs = () => duplicati.requests.filter((r) => r.url.includes('/log?')).length;
  const before = logs();
  await world.hub.pollNow();
  assert.equal(logs(), before);

  clock.advance(10 * 60_000);
  duplicati.activeJobId = null;
  duplicati.run('Archive', 'success', { end: clock.time });
  await world.hub.pollNow();
  assert.equal(world.fake.lastState(server.feature(SERVER_KEYS.RUNNING)), 0);
  assert.equal(world.fake.lastState(server.feature(SERVER_KEYS.PROGRESS)), 0);
  assert.equal(state(world, 'Archive', FEATURE_KEYS.STATE), 'OK');
  assert.equal(events(world, TRIGGERS.SUCCEEDED).at(-1).data.job, 'Archive');
});

test('"Start a backup" starts it in Duplicati, unless disabled in the configuration', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const device = idsOf(world, 'Archive').device;
  const ack = await world.fake.sceneAction('start_backup', { device });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(world.duplicati.started, [world.duplicati.byName('Archive').id]);
  assert.equal(world.hub.activeJobId, world.duplicati.byName('Archive').id);

  await world.fake.configUpdated({
    url: BASE,
    password: PASSWORD,
    language: 'fr',
    allow_start: false,
  });
  const refused = await world.fake.sceneAction('start_backup', { device });
  assert.equal(refused.success, false);
  assert.match(refused.error, /désactivé/);
  assert.equal(world.duplicati.started.length, 1);

  const unknown = await world.fake.sceneAction('get_backup_status', { device: 'nope' });
  assert.equal(unknown.success, false);
});

test('"State of a backup" gives a sentence in the language of the configuration', async (t) => {
  const world = await createWorld({ config: { url: BASE, password: PASSWORD, language: 'fr' } });
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('get_backup_status', {
    device: idsOf(world, 'Photos offsite').device,
  });
  assert.equal(ack.success, true, ack.error);
  const outputs = ack.data.outputs;
  assert.equal(outputs.failed, true);
  assert.equal(outputs.state, 'En échec');
  assert.equal(outputs.hours_since_success, 26);
  assert.match(
    outputs.sentence,
    /^Photos offsite : En échec, dernière réussite \d\d\/10 \d\d:\d\d\.$/,
  );
  const never = await world.fake.sceneAction('get_backup_status', {
    device: idsOf(world, 'Archive').device,
  });
  assert.equal(never.data.outputs.hours_since_success, -1);
  assert.match(never.data.outputs.sentence, /jamais réussie/);
});

test('Duplicati down, wrong password, no configuration: a status, the badge, no crash', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.duplicati.failure = 'down';
  await world.hub.pollNow();
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /does not answer/);
  assert.ok(
    world.fake.transports.some((entry) => entry.transport === 'unreachable'),
    'unreachable badge',
  );
  const action = await world.fake.sceneAction('get_backup_status', {
    device: idsOf(world, 'Archive').device,
  });
  assert.equal(action.success, false);
  world.duplicati.failure = null;
  await world.hub.pollNow();
  assert.equal(world.fake.connectionStatus.connected, true);

  await world.fake.configUpdated({ url: BASE, password: 'wrong', language: 'en' });
  assert.match(world.fake.connectionStatus.message.en, /password refused/);
  await world.fake.configUpdated({ url: '', password: '', language: 'en' });
  assert.match(world.fake.connectionStatus.message.en, /address of your Duplicati/);
  const report = await world.fake.action('test_connection', {});
  assert.equal(report.success, true);
});

test('"Test the connection" sums up the server', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  const message = ack.data?.message ?? ack.data;
  assert.equal(message.en, 'Duplicati: Connected, 3 backup(s), 1 failed');
  assert.equal(message.fr, 'Duplicati : Connecté, 3 sauvegarde(s), 1 en échec');
});

test('the widget: valid content, failed first, then the others', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const language of ['en', 'fr', 'de', 'es']) {
    const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language });
    assert.equal(ack.success, true, ack.error);
    const content = ack.data.content;
    assert.deepEqual(validateWidgetContent(content).errors ?? [], []);
    const status = content.components.find((c) => c.type === 'status');
    assert.deepEqual(
      status.items.map((item) => item.label),
      ['Photos offsite', 'Archive', 'Documents NAS'],
    );
  }
  const action = await world.fake.widgetAction(WIDGET_KEY, 'refresh', {}, { language: 'en' });
  assert.equal(action.success, true, action.error);
});

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}

test('a normal reading cycle writes nothing at the info level, nor the password', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const sent = world.fake.states.length;
  const lines = await captureLogs(t, 'info', async () => {
    for (let cycle = 0; cycle < 6; cycle += 1) {
      world.clock.advance(5 * 60_000);
      await world.hub.pollNow();
    }
  });
  assert.ok(world.fake.states.length >= sent);
  assert.ok(!lines.join('\n').includes(PASSWORD));
  assert.deepEqual(lines, []);
});

test('the internal timer reads Duplicati, every 30 seconds while a backup runs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const duplicati = new FakeDuplicati();
  duplicati.add('Documents NAS');
  duplicati.run('Documents NAS', 'success', { end: START - HOUR });
  duplicati.activeJobId = '1';
  const world = await createWorld({ duplicati, timers: true });
  t.after(() => world.app.stop());
  const reads = () => duplicati.requests.filter((r) => r.url.endsWith('/serverstate')).length;
  const before = reads();
  t.mock.timers.tick(30_000);
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(reads(), before + 1);
});
