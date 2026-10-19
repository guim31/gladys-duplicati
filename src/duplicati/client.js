// -----------------------------------------------------------------------------
// Duplicati client: the REST API of the Duplicati 2.1+ server (the one its web
// interface uses), checked against a real Duplicati 2.4.0.1.
//
//   POST /api/v1/auth/login            { Password } -> { AccessToken } (15 min)
//   GET  /api/v1/backups               the jobs: name, schedule, Metadata
//                                      (last backup, sizes, versions, last error)
//   GET  /api/v1/backup/<id>/log       the results of the last operations of a
//                                      job (ParsedResult, warnings, errors)
//   GET  /api/v1/serverstate           the task running, the next runs
//   GET  /api/v1/progressstate         the progress of the task running
//   POST /api/v1/backup/<id>/start     start a backup now
//
// The access token is kept in memory and asked again with the password when it
// expires (a 401): the refresh token is a cookie bound to the browser, not
// worth the trouble for one request every few minutes.
//
// Redirects are not followed: the password would be sent to wherever the
// address points (an http:// address redirected to https:// is reported).
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // password refused
  NOT_DUPLICATI: 'not_duplicati', // something answers, not the Duplicati 2.1+ API
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  NOT_FOUND: 'not_found', // the backup job no longer exists
  HTTP: 'http', // any other HTTP error
});

export class DuplicatiError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'DuplicatiError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export const MAX_BODY_BYTES = 8 * 1024 * 1024;

// The access token lives 15 minutes: asked again a little before.
export const TOKEN_LIFETIME_MS = 12 * 60_000;

// Results read per job: enough to find the last success behind a few failures.
export const LOG_PAGE_SIZE = 10;

/**
 * The one function that talks to the network (fetch). The client takes it as
 * a parameter: the tests replace it with an in-memory Duplicati
 * (test/helpers/fakeDuplicati.js).
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function httpRequest(url, { method = 'GET', headers = {}, body, timeoutMs } = {}) {
  const response = await fetch(url, {
    method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs ?? 15_000),
  });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    await response.body?.cancel();
    throw new Error('Response too large');
  }
  return { status: response.status, body: await response.text() };
}

// --- Parsing ---------------------------------------------------------------------

/** "20261019T194626Z" (Metadata) or an ISO date, in ms; null otherwise. */
export function parseDate(value) {
  if (typeof value !== 'string' || value.startsWith('0001-')) {
    return null;
  }
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const time = compact
    ? Date.UTC(+compact[1], +compact[2] - 1, +compact[3], +compact[4], +compact[5], +compact[6])
    : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** A .NET TimeSpan, "00:00:01.5322848" or "1.02:03:04", in whole seconds. */
export function parseTimeSpan(value) {
  const match =
    typeof value === 'string' && value.match(/^(?:(\d+)\.)?(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }
  const [, days = '0', hours, minutes, seconds] = match;
  return Math.round(+days * 86_400 + +hours * 3600 + +minutes * 60 + +seconds);
}

const UNIT_MS = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  D: 86_400_000,
  W: 7 * 86_400_000,
  M: 30 * 86_400_000,
  Y: 365 * 86_400_000,
};

/** A schedule repeat, "1D", "12h", "1W", "1D12h", in ms; null otherwise. */
export function parseRepeat(value) {
  if (typeof value !== 'string' || !/^(\d+[smhDWMY])+$/.test(value)) {
    return null;
  }
  let total = 0;
  for (const [, count, unit] of value.matchAll(/(\d+)([smhDWMY])/g)) {
    total += Number(count) * UNIT_MS[unit];
  }
  return total > 0 ? total : null;
}

const integer = (value) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
};

const RESULTS = { Success: 'success', Warning: 'warning', Error: 'error', Fatal: 'error' };

/** "2026-10-19 19:46:45 +00 - [Error-…]: text" -> "text", short. */
function cleanMessage(line) {
  if (typeof line !== 'string') {
    return '';
  }
  // A fatal error spans lines ("The operation Backup has failed\nException: …").
  const text = line
    .replace(/^.*?\[[^\]]*\]:\s*/, '')
    .replace(/\s*\n\s*/g, ': ')
    .trim();
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/**
 * One entry of /backup/<id>/log, normalized; null when it is not the result of
 * a backup (a restore, a repair, a compact run alone…).
 */
export function normalizeResult(entry) {
  if (!entry || entry.Type !== 'Result' || typeof entry.Message !== 'string') {
    return null;
  }
  let data;
  try {
    data = JSON.parse(entry.Message);
  } catch {
    return null;
  }
  if (!data || data.MainOperation !== 'Backup') {
    return null;
  }
  const begin = parseDate(data.BeginTime);
  const end = parseDate(data.EndTime);
  if (begin === null) {
    return null;
  }
  const errors = integer(data.ErrorsActualLength) ?? 0;
  const warnings = integer(data.WarningsActualLength) ?? 0;
  let result = RESULTS[data.ParsedResult];
  if (!result) {
    result = errors > 0 ? 'error' : 'warning'; // "Unknown": not a success
  }
  const message =
    result === 'error'
      ? cleanMessage(data.Errors?.[0]) || cleanMessage(data.Warnings?.[0])
      : result === 'warning'
        ? cleanMessage(data.Warnings?.[0])
        : '';
  return {
    // At the second, the precision of the Metadata.
    id: `${Math.floor(begin / 1000)}`,
    result,
    begin,
    end: end ?? begin,
    durationS: parseTimeSpan(data.Duration),
    errors,
    warnings,
    message,
  };
}

/**
 * One job of /backups, normalized; null when it cannot be identified.
 * @returns {object|null} { id, name, tags, schedule, metadata… }
 */
export function normalizeJob(item) {
  const backup = item?.Backup;
  if (!backup || typeof backup !== 'object' || backup.IsTemporary === true) {
    return null;
  }
  const id = typeof backup.ID === 'string' || Number.isInteger(backup.ID) ? String(backup.ID) : '';
  if (!/^\d{1,9}$/.test(id)) {
    return null;
  }
  const meta = backup.Metadata && typeof backup.Metadata === 'object' ? backup.Metadata : {};
  const schedule = item.Schedule && typeof item.Schedule === 'object' ? item.Schedule : null;
  const periodMs = schedule ? parseRepeat(schedule.Repeat) : null;
  const days = Array.isArray(schedule?.AllowedDays) ? schedule.AllowedDays : [];
  return {
    id,
    name: (typeof backup.Name === 'string' && backup.Name.trim()) || `Backup ${id}`,
    tags: Array.isArray(backup.Tags) ? backup.Tags.filter((t) => typeof t === 'string') : [],
    schedule: periodMs
      ? { periodMs, allowedDays: days.length > 0 && days.length < 7 ? days.length : 7 }
      : null,
    lastFinished: parseDate(meta.LastBackupFinished),
    lastStarted: parseDate(meta.LastBackupStarted),
    lastDurationS: parseTimeSpan(meta.LastBackupDuration),
    lastErrorAt: parseDate(meta.LastErrorDate),
    lastError: cleanMessage(meta.LastErrorMessage),
    destinationBytes: integer(meta.TargetFilesSize),
    sourceBytes: integer(meta.SourceFilesSize),
    versions: integer(meta.BackupListCount),
  };
}

/** /serverstate, normalized: the job running and the next runs. */
export function normalizeServerState(data) {
  const active = data?.ActiveTask;
  const next = new Map();
  for (const entry of Array.isArray(data?.ProposedSchedule) ? data.ProposedSchedule : []) {
    const time = parseDate(entry?.Item2);
    if (entry && time !== null) {
      next.set(String(entry.Item1), time);
    }
  }
  return {
    activeJobId:
      active && active.Item2 !== null && active.Item2 !== undefined ? String(active.Item2) : null,
    paused: data?.ProgramState === 'Paused',
    nextRuns: next,
  };
}

/**
 * /progressstate: 0 to 100. Duplicati leaves OverallProgress at 0 while the
 * files are processed: the share of the size processed then, as its interface.
 */
export function progressOf(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const overall = Number(data.OverallProgress);
  if (Number.isFinite(overall) && overall > 0) {
    return Math.min(100, Math.round(overall * 100));
  }
  const total = Number(data.TotalFileSize);
  const done = Number(data.ProcessedFileSize);
  if (data.StillCounting !== true && total > 0 && Number.isFinite(done)) {
    return Math.min(99, Math.max(0, Math.floor((done / total) * 100)));
  }
  return 0;
}

// --- Client ------------------------------------------------------------------------

export class DuplicatiClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} options.password password of the Duplicati interface
   * @param {typeof httpRequest} [options.request] test seam
   * @param {() => number} [options.now]
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, password, request = httpRequest, now = Date.now, timeoutMs = 15_000 }) {
    this.url = url;
    this.password = password;
    this.request = request;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.token = null;
    this.tokenAt = 0;
  }

  async send(path, { method = 'GET', headers = {}, body } = {}) {
    try {
      return await this.request(`${this.url}/api/v1${path}`, {
        method,
        headers: { accept: 'application/json', ...headers },
        body,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      const code = err.cause?.code ?? err.code;
      if (TLS_CODES.has(code)) {
        throw new DuplicatiError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
      }
      throw new DuplicatiError(ERROR_KINDS.UNREACHABLE, code ?? err.name ?? err.message);
    }
  }

  static check(response, notFound = ERROR_KINDS.NOT_DUPLICATI) {
    const { status } = response;
    if (status >= 300 && status < 400) {
      throw new DuplicatiError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 401 || status === 403) {
      throw new DuplicatiError(ERROR_KINDS.AUTH, `Refused (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new DuplicatiError(notFound, `Not found (HTTP 404)`, { status });
    }
    if (status < 200 || status >= 300) {
      throw new DuplicatiError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, { status });
    }
  }

  static json(response) {
    try {
      return JSON.parse(response.body);
    } catch {
      throw new DuplicatiError(ERROR_KINDS.NOT_DUPLICATI, 'The answer is not JSON');
    }
  }

  /** Ask an access token with the password. */
  async login() {
    const response = await this.send('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ Password: this.password }),
    });
    DuplicatiClient.check(response);
    const token = DuplicatiClient.json(response)?.AccessToken;
    if (typeof token !== 'string' || !token) {
      throw new DuplicatiError(ERROR_KINDS.NOT_DUPLICATI, 'No access token in the answer');
    }
    this.token = token;
    this.tokenAt = this.now();
  }

  /** An authenticated call; logs in again once when the token is refused. */
  async call(path, { method = 'GET', notFound } = {}) {
    if (!this.token || this.now() - this.tokenAt >= TOKEN_LIFETIME_MS) {
      await this.login();
    }
    let response = await this.send(path, {
      method,
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (response.status === 401) {
      await this.login();
      response = await this.send(path, {
        method,
        headers: { authorization: `Bearer ${this.token}` },
      });
    }
    DuplicatiClient.check(response, notFound);
    return response;
  }

  /** The backup jobs. */
  async jobs() {
    const data = DuplicatiClient.json(await this.call('/backups'));
    if (!Array.isArray(data)) {
      throw new DuplicatiError(ERROR_KINDS.NOT_DUPLICATI, 'The answer is not a list of backups');
    }
    return data.map(normalizeJob).filter(Boolean);
  }

  /** The backup results of a job, the most recent first ([] when unreadable). */
  async results(id) {
    let response;
    try {
      response = await this.call(
        `/backup/${encodeURIComponent(id)}/log?pagesize=${LOG_PAGE_SIZE}`,
        { notFound: ERROR_KINDS.NOT_FOUND },
      );
    } catch (err) {
      // A job whose local database is missing has no log: not a failure of Duplicati.
      if (err instanceof DuplicatiError && err.kind === ERROR_KINDS.NOT_FOUND) {
        return [];
      }
      throw err;
    }
    const data = DuplicatiClient.json(response);
    return (Array.isArray(data) ? data : [])
      .map(normalizeResult)
      .filter(Boolean)
      .sort((a, b) => b.begin - a.begin);
  }

  async serverState() {
    return normalizeServerState(DuplicatiClient.json(await this.call('/serverstate')));
  }

  async progress() {
    return progressOf(DuplicatiClient.json(await this.call('/progressstate')));
  }

  /** Start a backup now (queued by Duplicati when another task runs). */
  async start(id) {
    await this.call(`/backup/${encodeURIComponent(id)}/start`, {
      method: 'POST',
      notFound: ERROR_KINDS.NOT_FOUND,
    });
  }
}
