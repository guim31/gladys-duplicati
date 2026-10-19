// -----------------------------------------------------------------------------
// The Duplicati client against the real answers of a Duplicati 2.4.0.1
// (test/fixtures/duplicati, recorded from the duplicati/duplicati image: a job
// succeeded, one failed after its destination was deleted, one with warnings,
// one never run), and its errors against the fake.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DuplicatiClient,
  ERROR_KINDS,
  normalizeJob,
  normalizeResult,
  normalizeServerState,
  parseDate,
  parseRepeat,
  parseTimeSpan,
  progressOf,
} from '../src/duplicati/client.js';
import { parseServerUrl } from '../src/config.js';
import { BASE, FakeDuplicati, PASSWORD } from './helpers/fakeDuplicati.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/duplicati/${name}`, import.meta.url), 'utf8'));

test('the jobs of a real Duplicati, normalized', async () => {
  const jobs = (await fixture('backups.json')).map(normalizeJob);
  assert.deepEqual(
    jobs.map((job) => [job.id, job.name]),
    [
      ['1', 'Documents NAS'],
      ['2', 'Photos offsite'],
      ['3', 'Warn job'],
      ['4', 'Never run'],
    ],
  );
  const [documents, photos, , never] = jobs;
  assert.equal(documents.lastFinished, Date.UTC(2026, 9, 19, 19, 48, 35));
  assert.equal(documents.versions, 2);
  assert.ok(documents.destinationBytes > 400_000_000);
  assert.deepEqual(documents.schedule, { periodMs: 86_400_000, allowedDays: 7 });
  assert.equal(photos.lastErrorAt, Date.UTC(2026, 9, 19, 19, 46, 49));
  assert.match(photos.lastError, /missing from the remote storage/);
  assert.equal(never.lastFinished, null);
  assert.equal(never.versions, null);
  assert.deepEqual(never.schedule, { periodMs: 7 * 86_400_000, allowedDays: 1 });
});

test('the results of a real Duplicati: success, warning, fatal error, none', async () => {
  const success = (await fixture('log-success.json')).map(normalizeResult);
  assert.deepEqual(
    success.map((run) => run.result),
    ['success', 'success'],
  );
  assert.equal(success[1].durationS, 2); // 00:00:01.53

  const [warning] = (await fixture('log-warning.json')).map(normalizeResult);
  assert.equal(warning.result, 'warning');
  assert.equal(warning.warnings, 1);
  assert.equal(warning.message, 'The source path /nope/ does not exist, skipping');

  const [fatal, before] = (await fixture('log-fatal.json')).map(normalizeResult);
  assert.equal(fatal.result, 'error');
  assert.equal(fatal.errors, 1);
  assert.equal(fatal.warnings, 3);
  assert.match(fatal.message, /missing from the remote storage/);
  assert.ok(!fatal.message.includes('\n'), 'one line');
  assert.equal(before.result, 'success');
  assert.ok(fatal.begin > before.begin);

  assert.deepEqual((await fixture('log-empty.json')).map(normalizeResult), []);
  assert.equal(normalizeResult({ Type: 'Result', Message: '{"MainOperation":"Restore"}' }), null);
  assert.equal(normalizeResult({ Type: 'Result', Message: 'not json' }), null);
});

test('the server state and the progress of a real Duplicati', async () => {
  const idle = normalizeServerState(await fixture('serverstate-idle.json'));
  assert.equal(idle.activeJobId, null);
  assert.equal(idle.nextRuns.get('4'), Date.UTC(2026, 9, 25, 3, 30));
  const running = normalizeServerState(await fixture('serverstate-running.json'));
  assert.equal(running.activeJobId, '1');
  // Files processed: OverallProgress stays at 0, the size share is used.
  assert.equal(progressOf(await fixture('progress-running.json')), 0);
  assert.equal(progressOf({ OverallProgress: 0, ProcessedFileSize: 50, TotalFileSize: 200 }), 25);
  assert.equal(progressOf({ OverallProgress: 1 }), 100);
  assert.equal(progressOf({ StillCounting: true, ProcessedFileSize: 5, TotalFileSize: 9 }), 0);
});

test('dates, durations and schedules', () => {
  assert.equal(parseDate('20261019T194626Z'), Date.UTC(2026, 9, 19, 19, 46, 26));
  assert.equal(parseDate('0001-01-01T00:00:00Z'), null);
  assert.equal(parseDate('garbage'), null);
  assert.equal(parseTimeSpan('00:07:00.5322848'), 421);
  assert.equal(parseTimeSpan('1.02:00:00'), 93_600);
  assert.equal(parseTimeSpan('soon'), null);
  assert.equal(parseRepeat('1D'), 86_400_000);
  assert.equal(parseRepeat('1D12h'), 129_600_000);
  assert.equal(parseRepeat('30m'), 1_800_000);
  assert.equal(parseRepeat(''), null);
  assert.equal(parseRepeat('daily'), null);
});

test('the address typed by the user', () => {
  assert.equal(parseServerUrl('192.0.2.10'), 'http://192.0.2.10:8200');
  assert.equal(parseServerUrl('nas.local:8300'), 'http://nas.local:8300');
  assert.equal(parseServerUrl('http://192.0.2.10:8200/ngclient/'), 'http://192.0.2.10:8200');
  assert.equal(
    parseServerUrl('https://backup.example.org/duplicati/'),
    'https://backup.example.org/duplicati',
  );
  assert.equal(parseServerUrl('https://backup.example.org'), 'https://backup.example.org');
  assert.equal(parseServerUrl('http://user:pass@192.0.2.10'), null);
  assert.equal(parseServerUrl('ftp://192.0.2.10'), null);
  assert.equal(parseServerUrl('  '), null);
});

test('logs in once, again when the token expires or is refused', async () => {
  const fake = new FakeDuplicati();
  fake.add('Documents');
  let now = 0;
  const client = new DuplicatiClient({
    url: BASE,
    password: PASSWORD,
    request: fake.request,
    now: () => now,
  });
  await client.jobs();
  await client.serverState();
  assert.equal(fake.logins, 1);
  now += 13 * 60_000; // past the token lifetime
  await client.jobs();
  assert.equal(fake.logins, 2);
  fake.tokens.clear(); // Duplicati restarted: tokens forgotten
  assert.equal((await client.jobs()).length, 1);
  assert.equal(fake.logins, 3);
  const loginBody = fake.requests.find((r) => r.url.endsWith('/auth/login'));
  assert.equal(loginBody.method, 'POST');
});

test('the errors, by kind, without the password in the message', async () => {
  const fake = new FakeDuplicati();
  fake.add('Documents');
  const kind = async (client, call = (c) => c.jobs()) => {
    try {
      await call(client);
    } catch (err) {
      assert.ok(!err.message.includes(PASSWORD));
      return err.kind;
    }
    return null;
  };
  const make = (options = {}) =>
    new DuplicatiClient({ url: BASE, password: PASSWORD, request: fake.request, ...options });
  assert.equal(await kind(make({ password: 'wrong' })), ERROR_KINDS.AUTH);
  fake.failure = 'down';
  assert.equal(await kind(make()), ERROR_KINDS.UNREACHABLE);
  fake.failure = 302;
  assert.equal(await kind(make()), ERROR_KINDS.REDIRECT);
  fake.failure = 404; // Duplicati 2.0, or another service
  assert.equal(await kind(make()), ERROR_KINDS.NOT_DUPLICATI);
  fake.failure = 500;
  assert.equal(await kind(make()), ERROR_KINDS.HTTP);
  fake.failure = null;
  assert.equal(await kind(make(), (c) => c.start('99')), ERROR_KINDS.NOT_FOUND);
  const tls = async () => {
    const error = new TypeError('fetch failed');
    error.cause = { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' };
    throw error;
  };
  assert.equal(await kind(make({ request: tls })), ERROR_KINDS.TLS);
  const html = async () => ({ status: 200, body: '<html>Router</html>' });
  assert.equal(await kind(make({ request: html })), ERROR_KINDS.NOT_DUPLICATI);
});

test('the log of a job without a database is empty, not an error', async () => {
  const fake = new FakeDuplicati();
  const client = new DuplicatiClient({ url: BASE, password: PASSWORD, request: fake.request });
  assert.deepEqual(await client.results('42'), []);
});
