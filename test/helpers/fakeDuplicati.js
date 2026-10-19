// -----------------------------------------------------------------------------
// An in-memory Duplicati 2.1+: its jobs rendered like the REST API (shapes
// checked against the real answers of test/fixtures/duplicati in
// test/client.test.js). `run()` records a backup result the way Duplicati
// does: a success or a warning updates the Metadata of the job (last backup,
// duration, versions), an error only its last error.
// -----------------------------------------------------------------------------

export const BASE = 'http://192.0.2.10:8200';
export const PASSWORD = 'correct horse battery staple';

/** "20261019T194626Z", as the Metadata of a job. */
export const compact = (time) => new Date(time).toISOString().replace(/[-:]|\.\d+/g, '');

const span = (seconds) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}.5000000`;
};

export class FakeDuplicati {
  constructor() {
    /** @type {Map<string, object>} */
    this.jobs = new Map();
    this.activeJobId = null;
    this.progress = { OverallProgress: 0, ProcessedFileSize: 0, TotalFileSize: 0 };
    /** 'down': the server does not answer; a number: that HTTP status. */
    this.failure = null;
    /** A number: the HTTP status of every /log request (a busy job database). */
    this.logFailure = null;
    this.requests = [];
    this.tokens = new Set();
    this.logins = 0;
    this.started = [];
    this.nextId = 1;
    this.nextLog = 1;
  }

  /** A job; `schedule` like the API: { Repeat, AllowedDays } or null. */
  add(name, { schedule = { Repeat: '1D', AllowedDays: [] }, next = null } = {}) {
    const id = String(this.nextId++);
    this.jobs.set(id, { id, name, schedule, next, metadata: {}, log: [] });
    return id;
  }

  byName(name) {
    return [...this.jobs.values()].find((job) => job.name === name);
  }

  /** Record a backup run of `seconds`, ended at `end`. */
  run(name, result, { end, seconds = 90, warnings = 0, errors = 0, message = 'Boom' }) {
    const job = this.byName(name);
    const begin = end - seconds * 1000;
    const parsed = { success: 'Success', warning: 'Warning', error: 'Error', fatal: 'Fatal' }[
      result
    ];
    const line = (level, text) =>
      `2026-10-19 02:00:00 +00 - [${level}-Duplicati.Library.Main.Controller-Test]: ${text}`;
    const data = {
      MainOperation: 'Backup',
      ParsedResult: parsed,
      BeginTime: new Date(begin).toISOString(),
      EndTime: new Date(end).toISOString(),
      Duration: span(seconds),
      WarningsActualLength: result === 'warning' ? Math.max(1, warnings) : warnings,
      ErrorsActualLength: ['error', 'fatal'].includes(result) ? Math.max(1, errors) : errors,
      Warnings: result === 'warning' ? [line('Warning', message)] : [],
      Errors: ['error', 'fatal'].includes(result) ? [line('Error', message)] : [],
    };
    job.log.unshift({
      ID: this.nextLog++,
      OperationID: this.nextLog,
      Timestamp: Math.floor(end / 1000),
      Type: 'Result',
      Message: JSON.stringify(data),
      Exception: {},
    });
    const meta = job.metadata;
    if (result === 'success' || result === 'warning') {
      Object.assign(meta, {
        LastBackupDate: compact(begin),
        LastBackupStarted: compact(begin),
        LastBackupFinished: compact(end),
        LastBackupDuration: span(seconds),
        BackupListCount: String(Number(meta.BackupListCount ?? 0) + 1),
        TargetFilesSize: '1234567890',
        SourceFilesSize: '2345678901',
      });
    } else {
      Object.assign(meta, { LastErrorDate: compact(end), LastErrorMessage: message });
    }
  }

  render(job) {
    return {
      Backup: {
        ID: job.id,
        Name: job.name,
        Description: '',
        Tags: [],
        TargetURL: 'file:///backups',
        IsTemporary: false,
        Metadata: job.metadata,
      },
      Schedule: job.schedule
        ? {
            ID: Number(job.id),
            Tags: [`ID=${job.id}`],
            Time: '2026-10-20T02:00:00Z',
            ...job.schedule,
          }
        : null,
    };
  }

  /** The request seam of src/duplicati/client.js. */
  request = async (url, { method = 'GET', headers = {}, body } = {}) => {
    this.requests.push({ url, method });
    if (this.failure === 'down') {
      const error = new TypeError('fetch failed');
      error.cause = { code: 'ECONNREFUSED' };
      throw error;
    }
    if (typeof this.failure === 'number') {
      return { status: this.failure, body: '' };
    }
    const json = (status, data) => ({ status, body: JSON.stringify(data) });
    const path = url.slice(`${BASE}/api/v1`.length);
    if (path === '/auth/login' && method === 'POST') {
      if (JSON.parse(body).Password !== PASSWORD) {
        return json(401, { Error: 'Failed to log in', Code: 401 });
      }
      this.logins += 1;
      const token = `token-${this.logins}`;
      this.tokens.add(token);
      return json(200, { AccessToken: token, RefreshNonce: 'nonce' });
    }
    if (!this.tokens.has(headers.authorization?.replace(/^Bearer /, ''))) {
      return { status: 401, body: '' };
    }
    if (path === '/backups') {
      return json(
        200,
        [...this.jobs.values()].map((job) => this.render(job)),
      );
    }
    if (path === '/serverstate') {
      return json(200, {
        ActiveTask: this.activeJobId ? { Item1: 7, Item2: this.activeJobId } : null,
        ProgramState: 'Running',
        ProposedSchedule: [...this.jobs.values()]
          .filter((job) => job.next !== null)
          .map((job) => ({ Item1: job.id, Item2: new Date(job.next).toISOString() })),
      });
    }
    if (path === '/progressstate') {
      return json(200, { BackupID: this.activeJobId, StillCounting: false, ...this.progress });
    }
    const log = path.match(/^\/backup\/(\d+)\/log\?pagesize=\d+$/);
    if (log) {
      if (this.logFailure) {
        return { status: this.logFailure, body: '' };
      }
      const job = this.jobs.get(log[1]);
      return job ? json(200, job.log) : json(404, { Error: 'Not found' });
    }
    const start = path.match(/^\/backup\/(\d+)\/start$/);
    if (start && method === 'POST') {
      if (!this.jobs.has(start[1])) {
        return json(404, { Error: 'Not found' });
      }
      this.started.push(start[1]);
      this.activeJobId = start[1];
      return json(200, { Status: 'OK', ID: 9 });
    }
    return { status: 404, body: '' };
  };
}
