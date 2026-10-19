// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Duplicati server (2.1 or later), reached with the password of its web
// interface.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['60', '300', '900'];

// "Overdue after": automatic (from the schedule of each job) or fixed hours.
export const OVERDUE_CHOICES = ['auto', '12', '24', '48', '72', '168'];

export const DEFAULT_PORT = 8200;

export const DEFAULT_CONFIG = {
  url: '',
  password: '',
  poll_interval: '300',
  overdue_hours: 'auto',
  allow_start: true,
  language: 'fr',
};

// Pages of the Duplicati interface: a URL copied from the browser points at
// one of them, the API lives at the root.
const INTERFACE_PATH = /\/(ngclient|ngax|login\.html|index\.html|api)(\/.*)?$/i;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, port 8200 then), or a URL copied from the browser
 * (`http://192.0.2.10:8200/ngclient/`). HTTP by default for a bare host. A
 * path is kept (a server behind a reverse proxy sub-path), the interface
 * pages dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const bare = !/^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(bare ? `http://${text}` : text);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  if (bare && !url.port) {
    url.port = String(DEFAULT_PORT);
  }
  const path = url.pathname.replace(INTERFACE_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const typed = text('url');
  const pollInterval = POLL_INTERVALS.includes(String(source.poll_interval))
    ? String(source.poll_interval)
    : DEFAULT_CONFIG.poll_interval;
  const overdue = OVERDUE_CHOICES.includes(String(source.overdue_hours))
    ? String(source.overdue_hours)
    : DEFAULT_CONFIG.overdue_hours;
  return {
    url: typed ? parseServerUrl(typed) : null,
    urlTyped: Boolean(typed),
    // Never trimmed: a password may end with a space.
    password: typeof source.password === 'string' ? source.password : '',
    pollIntervalMs: Number(pollInterval) * 1000,
    overdueHours: overdue === 'auto' ? null : Number(overdue),
    allowStart: source.allow_start !== false && source.allow_start !== 'false',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
