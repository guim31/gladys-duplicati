// -----------------------------------------------------------------------------
// The Duplicati hub: the server read on a timer of the container (the
// interval chosen in the configuration, 30 seconds while a backup runs, for
// its progress); the states of the added devices published when they change,
// the scene events fired on the runs and on the overdue jobs, and the views
// the widget and the scene actions read.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 15 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire for every job, added to Gladys or not — "a backup fails"
// spares the user one scene per device.
//
// The last run seen of each job is kept in /data (src/store.js): a backup that
// failed while the integration or Gladys restarted is still announced, once.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  buildJobDevice,
  buildServerDevice,
  hoursSince,
  jobIds,
  jobValues,
  overdueAfterMs,
  parseJobId,
  serverIds,
  serverValues,
  stateOf,
} from './devices.js';
import { DuplicatiClient, DuplicatiError, ERROR_KINDS } from './duplicati/client.js';
import { hostOf, normalizeConfig } from './config.js';
import { ProblemLog } from './problems.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  formatTime,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'duplicati-hub' });

export const WIDGET_KEY = 'duplicati';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  SUCCEEDED: 'backup_succeeded',
  FAILED: 'backup_failed',
  OVERDUE: 'backup_overdue',
});

export const HUB_TIMINGS = {
  // While a backup runs: its progress and its end, read this often.
  runningPollMs: 30_000,
  // The results of a job are read again when its metadata change, and at
  // least this often (a run interrupted leaves the metadata as they were).
  resultsEveryMs: 3600_000,
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action reads Duplicati again when the last read is older.
  freshMs: 15_000,
};

const MAX_TRANSPORTS_PER_REQUEST = 100;

/** "1.2 GB", for a scene message. */
export function formatBytes(bytes) {
  if (bytes === null) {
    return '';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/**
 * The view of a job: its metadata, its last run, its last success, whether it
 * runs, its next run and whether it is overdue.
 */
export function viewOf(job, results, server, { now, overdueHours, knownSuccess = null }) {
  let lastRun = results[0] ?? null;
  if (!lastRun && (job.lastErrorAt !== null || job.lastFinished !== null)) {
    // No log readable (its local database is missing): the metadata tell the essentials.
    lastRun =
      job.lastErrorAt !== null && (job.lastFinished === null || job.lastErrorAt > job.lastFinished)
        ? {
            // Another kind of id than the log's: a change of source is no new run.
            id: `meta:${job.lastErrorAt}`,
            result: 'error',
            begin: job.lastErrorAt,
            end: job.lastErrorAt,
            durationS: null,
            errors: 1,
            warnings: 0,
            message: job.lastError,
          }
        : {
            id: `meta:${job.lastStarted ?? job.lastFinished}`,
            result: 'success',
            begin: job.lastStarted ?? job.lastFinished,
            end: job.lastFinished,
            durationS: job.lastDurationS,
            errors: 0,
            warnings: 0,
            message: '',
          };
  }
  // The last success: the end of the last run that completed (with or without
  // warnings), or the metadata when the log does not reach it — unless they
  // describe the failed run itself.
  const candidates = results.filter((run) => run.result !== 'error').map((run) => run.end);
  if (
    job.lastFinished !== null &&
    !(lastRun?.result === 'error' && job.lastFinished >= lastRun.begin)
  ) {
    candidates.push(job.lastFinished);
  }
  // The last success already seen: the log page only holds the last runs.
  if (knownSuccess !== null) {
    candidates.push(knownSuccess);
  }
  const lastSuccess = candidates.length > 0 ? Math.max(...candidates) : null;
  const view = {
    ...job,
    lastRun,
    lastSuccess,
    lastDurationS: lastRun?.durationS ?? job.lastDurationS,
    running: server.activeJobId === job.id,
    nextRun: server.nextRuns.get(job.id) ?? null,
  };
  const limit = overdueAfterMs(view, overdueHours);
  view.overdue = limit !== null && lastSuccess !== null && now - lastSuccess > limit;
  return view;
}

export class DuplicatiHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/duplicati/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    /** @type {Map<string, object>} views of the jobs of the last read, by id */
    this.jobs = new Map();
    /** @type {Map<string, { signature: string, results: object[], at: number }>} */
    this.results = new Map();
    this.activeJobId = null;
    this.progress = null;
    this.readAt = 0;
    this.error = null;
    this.polling = null;
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = { jobs: {} };
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = { jobs: saved?.jobs && typeof saved.jobs === 'object' ? saved.jobs : {} };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.signature !== null && this.config.language !== config.language;
    const overdueChanged = this.config.overdueHours !== config.overdueHours;
    this.config = config;
    const signature = JSON.stringify([config.url, config.password]);
    if (signature !== this.signature) {
      if (this.signature !== null && JSON.parse(this.signature)[0] !== config.url) {
        // Another server: its job ids are not the ones seen before.
        this.saved = { jobs: {} };
        this.store.save(this.saved);
      }
      this.signature = signature;
      this.client =
        config.url && config.password
          ? new DuplicatiClient({
              url: config.url,
              password: config.password,
              request: this.request,
              now: this.now,
            })
          : null;
      this.jobs = new Map();
      this.results = new Map();
      this.activeJobId = null;
      this.readAt = 0;
      this.error = null;
      this.polling = null;
    }
    if (languageChanged) {
      this.discovered = null; // new names for the Discovery tab
    }
    if (overdueChanged && this.readAt !== 0) {
      // A new threshold is not an event: the jobs overdue by it are only recorded.
      for (const job of this.jobs.values()) {
        const saved = this.saved.jobs[job.id];
        if (saved) {
          saved.overdue = null;
        }
      }
    }
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    const delay = this.activeJobId ? this.timings.runningPollMs : this.config.pollIntervalMs;
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading Duplicati works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, delay);
  }

  // --- Reading Duplicati -------------------------------------------------------

  /** Read the server now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read again when the last read is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * Read the server and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    let snapshot;
    try {
      snapshot = await this.fetch(client);
    } catch (err) {
      if (!(err instanceof DuplicatiError)) {
        throw err;
      }
      return client === this.client && this.applyFailure(err);
    }
    return client === this.client && this.applySuccess(snapshot);
  }

  /** Everything Duplicati says, the logs read only for the jobs that ran. */
  async fetch(client) {
    const jobs = await client.jobs();
    const server = await client.serverState();
    const progress = server.activeJobId ? await client.progress() : null;
    const now = this.now();
    const results = new Map();
    for (const job of jobs) {
      const signature = JSON.stringify([job.lastStarted, job.lastFinished, job.lastErrorAt]);
      const cached = this.results.get(job.id);
      const ended = this.activeJobId === job.id && server.activeJobId !== job.id;
      if (
        cached &&
        cached.signature === signature &&
        !ended &&
        now - cached.at < this.timings.resultsEveryMs
      ) {
        results.set(job.id, cached);
      } else {
        let fresh;
        try {
          fresh = await client.results(job.id);
        } catch (err) {
          // A log busy during a long backup: keep what was read, try again next time.
          if (!(err instanceof DuplicatiError) || err.kind !== ERROR_KINDS.HTTP) {
            throw err;
          }
          logger.debug(`Log of backup ${job.id} unreadable: ${err.message}`);
          results.set(
            job.id,
            cached ? { ...cached, at: 0 } : { signature: null, results: [], at: 0 },
          );
          continue;
        }
        results.set(job.id, { signature, results: fresh, at: now });
      }
    }
    return { jobs, server, progress, results };
  }

  async applySuccess({ jobs, server, progress, results }) {
    let widgetChanged = this.error !== null || this.readAt === 0;
    if (this.error) {
      logger.info('Duplicati answers again');
    }
    if (this.readAt === 0) {
      logger.info(`Duplicati (${hostOf(this.config.url)}): ${jobs.length} backup(s)`);
    }
    this.error = null;
    const now = this.now();
    this.readAt = now;
    this.results = results;
    if (server.activeJobId !== this.activeJobId) {
      widgetChanged = true;
    }
    this.activeJobId = server.activeJobId;
    this.progress = progress;

    const next = new Map();
    let dirty = false;
    for (const job of jobs) {
      if (next.has(job.id)) {
        continue;
      }
      const view = viewOf(job, results.get(job.id)?.results ?? [], server, {
        now,
        overdueHours: this.config.overdueHours,
        knownSuccess: this.saved.jobs[job.id]?.lastSuccess ?? null,
      });
      next.set(job.id, view);
      const previous = this.jobs.get(job.id);
      if (
        !previous ||
        stateOf(previous) !== stateOf(view) ||
        previous.name !== view.name ||
        previous.lastSuccess !== view.lastSuccess
      ) {
        widgetChanged = true;
      }
      dirty = (await this.transition(view)) || dirty;
    }
    if ([...this.jobs.keys()].some((id) => !next.has(id))) {
      widgetChanged = true; // a job deleted
    }
    this.jobs = next;
    // A job deleted in Duplicati is forgotten.
    for (const id of Object.keys(this.saved.jobs)) {
      if (!next.has(id)) {
        delete this.saved.jobs[id];
        dirty = true;
      }
    }
    // Written only when something changed: no wear of the SD card at every read.
    if (dirty) {
      this.store.save(this.saved);
    }
    await this.publishStates();
    return widgetChanged;
  }

  applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`Duplicati: ${err.message}`);
    }
    return wasError !== err.kind;
  }

  /**
   * Compare a job with what was seen before; fire the scene events of a new
   * run and of a job turning overdue. The first sight of a job only records.
   * @returns {boolean} whether the saved state changed
   */
  async transition(job) {
    const saved = this.saved.jobs[job.id];
    const run = job.lastRun?.id ?? null;
    if (!saved) {
      this.saved.jobs[job.id] = { run, overdue: job.overdue, lastSuccess: job.lastSuccess };
      return true;
    }
    let dirty = false;
    if (job.lastSuccess !== null && job.lastSuccess !== saved.lastSuccess) {
      saved.lastSuccess = job.lastSuccess;
      dirty = true;
    }
    if (run !== null && run !== saved.run) {
      // A run id from the log replacing one from the Metadata (or the reverse)
      // is the same information read elsewhere: recorded, not announced.
      const before = saved.run;
      const sameSource = run.startsWith('meta:') === String(before ?? '').startsWith('meta:');
      saved.run = run;
      dirty = true;
      if (sameSource || before === null) {
        await this.fireRun(job);
      }
    }
    if (job.overdue !== saved.overdue) {
      // null: the threshold changed, nothing to announce.
      if (job.overdue && saved.overdue === false) {
        logger.info(`${job.name} is overdue`);
        await this.fire(TRIGGERS.OVERDUE, job, {
          hours_since_success: hoursSince(job, this.now()),
          last_success: formatTime(job.lastSuccess, this.config.language),
        });
      }
      saved.overdue = job.overdue;
      dirty = true;
    }
    return dirty;
  }

  async fireRun(job) {
    const run = job.lastRun;
    if (run.result === 'success' || run.result === 'warning') {
      await this.fire(TRIGGERS.SUCCEEDED, job, {
        duration_minutes: Math.round((run.durationS ?? 0) / 60),
        warnings: run.warnings,
        versions: job.versions ?? 0,
        destination_size: formatBytes(job.destinationBytes),
      });
    }
    if (run.result === 'error' || run.result === 'warning') {
      if (run.result === 'error') {
        logger.info(`${job.name} failed`);
      }
      await this.fire(TRIGGERS.FAILED, job, {
        result: run.result,
        message: run.message,
        errors: run.errors,
        warnings: run.warnings,
      });
    }
  }

  async fire(key, job, extra = {}) {
    try {
      await this.gladys.publishSceneEvent(key, {
        device: jobIds(this.gladys, job.id).device,
        job: job.name,
        ...extra,
      });
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  discoveredDevices() {
    const language = this.config.language;
    if (!this.client || this.readAt === 0 || this.error) {
      return null; // nothing read: keep the list Gladys has
    }
    return [
      buildServerDevice(this.gladys, language),
      ...[...this.jobs.values()].map((job) => buildJobDevice(this.gladys, job, language)),
    ];
  }

  /** Publish the Discovery list when it changed (a job added, renamed…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices() ?? (this.client ? null : []);
    if (devices === null) {
      return;
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read Duplicati, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) a device: its states sent before were dropped
   * by Gladys, and a device deleted then added again needs its badge.
   */
  async onDeviceCreated(device) {
    this.gladys.forgetPublishedStates?.(device.external_id);
    this.transports.delete(device.external_id);
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.pollNow();
  }

  /**
   * The states of the added devices. The SDK skips the values Gladys already
   * has (and sends an unchanged one again after `heartbeatMs`).
   */
  async publishStates() {
    if (this.readAt === 0 || this.error) {
      return;
    }
    const language = this.config.language;
    const now = this.now();
    const states = [];
    for (const job of this.jobs.values()) {
      if (this.isCreated(jobIds(this.gladys, job.id).device)) {
        for (const { key: _key, ...state } of jobValues(this.gladys, job, language, now)) {
          states.push(state);
        }
      }
    }
    if (this.isCreated(serverIds(this.gladys).device)) {
      const values = serverValues(this.gladys, {
        jobs: [...this.jobs.values()],
        activeJob: this.activeJobId ? (this.jobs.get(this.activeJobId) ?? null) : null,
        progress: this.progress,
      });
      for (const { key: _key, ...state } of values) {
        states.push(state);
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: local, or unreachable. */
  async publishTransports() {
    if (!this.client || this.readAt === 0) {
      return;
    }
    const transport = this.error ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL;
    const entries = [];
    const ids = [
      serverIds(this.gladys).device,
      ...[...this.jobs.keys()].map((id) => jobIds(this.gladys, id).device),
    ];
    for (const externalId of ids) {
      if (this.isCreated(externalId) && this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.problems.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.problems.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config.urlTyped) {
      return { connected: false, message: CONNECTION_TEXT.noUrl };
    }
    if (!this.config.url) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (!this.config.password) {
      return { connected: false, message: CONNECTION_TEXT.noPassword };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views and commands (widget, scene actions, report) ------------------------------

  /** The job of a device external id, null when it is not one (or no longer exists). */
  find(externalId) {
    const id = parseJobId(this.gladys, externalId);
    return id ? (this.jobs.get(id) ?? null) : null;
  }

  /** Throws the reason Duplicati cannot answer, if any. */
  assertReadable() {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new Error(pick(status.message, this.config.language));
    }
  }

  /** The job of a device, read again if stale; throws a readable error. */
  async jobOf(externalId) {
    // Only the configuration first: a past error is what the read below clears.
    if (!this.client) {
      this.assertReadable();
    }
    await this.refreshIfStale();
    this.assertReadable();
    const job = this.find(externalId);
    if (!job) {
      throw new Error(pick(ACTION_TEXT.unknownJob, this.config.language));
    }
    return job;
  }

  /** Start a backup now (unless disabled in the configuration), then read again. */
  async startBackup(job) {
    if (!this.config.allowStart) {
      throw new Error(pick(ACTION_TEXT.startDisabled, this.config.language));
    }
    try {
      await this.client.start(job.id);
    } catch (err) {
      if (err instanceof DuplicatiError) {
        throw new Error(pick(ERROR_TEXT[err.kind], this.config.language), { cause: err });
      }
      throw err;
    }
    logger.info(`${job.name} started from Gladys`);
    // Shown as running at once; the read that confirms it does not hold the
    // answer (it may read every log, beyond the timeout of the action).
    this.activeJobId = job.id;
    this.schedulePoll(); // 30 seconds while it runs
    (this.polling ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.pollNow())
      .catch((err) => logger.debug(`Read after start failed: ${err.message}`));
  }

  /** "Test the connection": read Duplicati now, one line. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const message = {};
    const status = this.connectionStatus();
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (!status.connected) {
        message[language] = pick(status.message, language);
        continue;
      }
      const jobs = [...this.jobs.values()];
      const parts = [text.ok, text.jobs(jobs.length)];
      const failed = jobs.filter((job) => job.lastRun?.result === 'error').length;
      const overdue = jobs.filter((job) => job.overdue).length;
      if (failed > 0) {
        parts.push(text.failed(failed));
      }
      if (overdue > 0) {
        parts.push(text.overdue(overdue));
      }
      message[language] = labelled('Duplicati', parts.join(', '), language);
    }
    return message;
  }
}

export { ERROR_KINDS };
