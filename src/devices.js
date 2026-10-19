// -----------------------------------------------------------------------------
// The view of a backup job (what Duplicati says, put together by src/hub.js)
// and the Gladys devices, proposed in the Discovery tab (the user adds the
// ones to follow, nothing is created on their behalf):
//
//   - one device per backup job, identified by its Duplicati id:
//       state                text/text      "OK", "Failed", "Overdue"… (the
//                                           language of the configuration)
//       last_success         text/text      day/month hours:minutes
//       hours_since_success  duration/integer (h)
//       last_duration        duration/integer (s)   of the last run
//       destination_size     data/size (MB)         files at the destination
//       versions             counter-sensor/integer versions kept
//       errors, warnings     counter-sensor/integer of the last run
//       running              input/binary   1 while this job runs
//       next_run             text/text      next scheduled run, "-" if none
//
//   - one "Duplicati" device for the server: a backup running, its progress,
//     its name, and the number of jobs failed and overdue.
//
// Published with should_poll: false: the integration reads Duplicati on its
// own timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { STATE_TEXT, formatTime, pick } from './texts.js';

export const JOB_TYPE = 'job';
export const SERVER_TYPE = 'server';
export const SERVER_ID = 'main';
export const MODEL = 'Duplicati';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  STATE: 'state',
  LAST_SUCCESS: 'last_success',
  HOURS_SINCE_SUCCESS: 'hours_since_success',
  LAST_DURATION: 'last_duration',
  DESTINATION_SIZE: 'destination_size',
  VERSIONS: 'versions',
  ERRORS: 'errors',
  WARNINGS: 'warnings',
  RUNNING: 'running',
  NEXT_RUN: 'next_run',
});

export const SERVER_KEYS = Object.freeze({
  RUNNING: 'running',
  PROGRESS: 'progress',
  CURRENT_JOB: 'current_job',
  FAILED: 'jobs_failed',
  OVERDUE: 'jobs_overdue',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.STATE]: 'State',
    [FEATURE_KEYS.LAST_SUCCESS]: 'Last successful backup',
    [FEATURE_KEYS.HOURS_SINCE_SUCCESS]: 'Hours since last success',
    [FEATURE_KEYS.LAST_DURATION]: 'Last run duration',
    [FEATURE_KEYS.DESTINATION_SIZE]: 'Destination size',
    [FEATURE_KEYS.VERSIONS]: 'Versions',
    [FEATURE_KEYS.ERRORS]: 'Errors of the last run',
    [FEATURE_KEYS.WARNINGS]: 'Warnings of the last run',
    [FEATURE_KEYS.RUNNING]: 'Running',
    [FEATURE_KEYS.NEXT_RUN]: 'Next scheduled run',
    [`server_${SERVER_KEYS.RUNNING}`]: 'Backup running',
    [SERVER_KEYS.PROGRESS]: 'Progress',
    [SERVER_KEYS.CURRENT_JOB]: 'Current backup',
    [SERVER_KEYS.FAILED]: 'Failed backups',
    [SERVER_KEYS.OVERDUE]: 'Overdue backups',
  },
  fr: {
    [FEATURE_KEYS.STATE]: 'État',
    [FEATURE_KEYS.LAST_SUCCESS]: 'Dernière sauvegarde réussie',
    [FEATURE_KEYS.HOURS_SINCE_SUCCESS]: 'Heures depuis la dernière réussite',
    [FEATURE_KEYS.LAST_DURATION]: 'Durée de la dernière exécution',
    [FEATURE_KEYS.DESTINATION_SIZE]: 'Taille de la destination',
    [FEATURE_KEYS.VERSIONS]: 'Versions',
    [FEATURE_KEYS.ERRORS]: 'Erreurs de la dernière exécution',
    [FEATURE_KEYS.WARNINGS]: 'Avertissements de la dernière exécution',
    [FEATURE_KEYS.RUNNING]: 'En cours',
    [FEATURE_KEYS.NEXT_RUN]: 'Prochaine exécution planifiée',
    [`server_${SERVER_KEYS.RUNNING}`]: 'Sauvegarde en cours',
    [SERVER_KEYS.PROGRESS]: 'Progression',
    [SERVER_KEYS.CURRENT_JOB]: 'Sauvegarde actuelle',
    [SERVER_KEYS.FAILED]: 'Sauvegardes en échec',
    [SERVER_KEYS.OVERDUE]: 'Sauvegardes en retard',
  },
  de: {
    [FEATURE_KEYS.STATE]: 'Zustand',
    [FEATURE_KEYS.LAST_SUCCESS]: 'Letzte erfolgreiche Sicherung',
    [FEATURE_KEYS.HOURS_SINCE_SUCCESS]: 'Stunden seit letztem Erfolg',
    [FEATURE_KEYS.LAST_DURATION]: 'Dauer des letzten Laufs',
    [FEATURE_KEYS.DESTINATION_SIZE]: 'Größe am Ziel',
    [FEATURE_KEYS.VERSIONS]: 'Versionen',
    [FEATURE_KEYS.ERRORS]: 'Fehler des letzten Laufs',
    [FEATURE_KEYS.WARNINGS]: 'Warnungen des letzten Laufs',
    [FEATURE_KEYS.RUNNING]: 'Läuft',
    [FEATURE_KEYS.NEXT_RUN]: 'Nächster geplanter Lauf',
    [`server_${SERVER_KEYS.RUNNING}`]: 'Sicherung läuft',
    [SERVER_KEYS.PROGRESS]: 'Fortschritt',
    [SERVER_KEYS.CURRENT_JOB]: 'Aktuelle Sicherung',
    [SERVER_KEYS.FAILED]: 'Fehlgeschlagene Sicherungen',
    [SERVER_KEYS.OVERDUE]: 'Überfällige Sicherungen',
  },
  es: {
    [FEATURE_KEYS.STATE]: 'Estado',
    [FEATURE_KEYS.LAST_SUCCESS]: 'Última copia correcta',
    [FEATURE_KEYS.HOURS_SINCE_SUCCESS]: 'Horas desde el último éxito',
    [FEATURE_KEYS.LAST_DURATION]: 'Duración de la última ejecución',
    [FEATURE_KEYS.DESTINATION_SIZE]: 'Tamaño en el destino',
    [FEATURE_KEYS.VERSIONS]: 'Versiones',
    [FEATURE_KEYS.ERRORS]: 'Errores de la última ejecución',
    [FEATURE_KEYS.WARNINGS]: 'Avisos de la última ejecución',
    [FEATURE_KEYS.RUNNING]: 'En ejecución',
    [FEATURE_KEYS.NEXT_RUN]: 'Próxima ejecución programada',
    [`server_${SERVER_KEYS.RUNNING}`]: 'Copia en curso',
    [SERVER_KEYS.PROGRESS]: 'Progreso',
    [SERVER_KEYS.CURRENT_JOB]: 'Copia actual',
    [SERVER_KEYS.FAILED]: 'Copias fallidas',
    [SERVER_KEYS.OVERDUE]: 'Copias con retraso',
  },
};

// Display bounds (the core never applies them on write).
export const MAX_HOURS = 100_000;
export const MAX_DURATION_S = 7 * 24 * 3600;
export const MAX_SIZE_MB = 1_000_000_000;
export const MAX_COUNT = 1_000_000;
export const MAX_JOBS = 10_000;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long without a success makes a job overdue, in ms; null when it cannot
 * be overdue. Automatic: the period of its schedule, plus the days its
 * schedule skips (a daily backup on weekdays only waits over the weekend),
 * plus a quarter of the period (an hour at least) for a backup that runs late
 * or long. A job without a schedule is overdue only with a fixed threshold.
 */
export function overdueAfterMs(job, overdueHours) {
  if (overdueHours) {
    return overdueHours * HOUR_MS;
  }
  if (!job.schedule) {
    return null;
  }
  const { periodMs, allowedDays } = job.schedule;
  const skipped = periodMs < 7 * DAY_MS ? (7 - allowedDays) * DAY_MS : 0;
  return periodMs + skipped + Math.max(HOUR_MS, periodMs / 4);
}

/**
 * The state of a job, by what needs attention first.
 * @returns {'running'|'failed'|'overdue'|'warning'|'ok'|'never'}
 */
export function stateOf(job) {
  if (job.running) {
    return 'running';
  }
  if (job.lastRun?.result === 'error') {
    return 'failed';
  }
  if (job.overdue) {
    return 'overdue';
  }
  if (job.lastRun?.result === 'warning') {
    return 'warning';
  }
  return job.lastSuccess !== null || job.lastRun ? 'ok' : 'never';
}

/** Whole hours since the last success, null if none. */
export const hoursSince = (job, now) =>
  job.lastSuccess === null ? null : Math.max(0, Math.floor((now - job.lastSuccess) / HOUR_MS));

export const jobIds = (gladys, id) => gladys.externalIds(JOB_TYPE, id);
export const serverIds = (gladys) => gladys.externalIds(SERVER_TYPE, SERVER_ID);

/** The job id of a device external id, null when it is not a job of ours. */
export function parseJobId(gladys, externalId) {
  const prefix = jobIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = externalId.slice(prefix.length);
  return /^\d{1,9}$/.test(id) ? id : null;
}

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const text = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, {
    keep_history: false,
    min: 0,
    max: 0,
  });

const counter = (name, externalId, max) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    { keep_history: true, min: 0, max },
  );

const binary = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.INPUT, DEVICE_FEATURE_TYPES.SENSOR.BINARY, {
    keep_history: true,
    min: 0,
    max: 1,
  });

const duration = (name, externalId, unit, max) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.DURATION,
    DEVICE_FEATURE_TYPES.DURATION.INTEGER,
    { unit, keep_history: true, min: 0, max },
  );

/** The discovery payload of a backup job. */
export function buildJobDevice(gladys, job, language = 'en') {
  const ids = jobIds(gladys, job.id);
  const names = NAMES[language] ?? NAMES.en;
  const name = (key) => names[key];
  return {
    name: job.name.slice(0, 255),
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: job.tags.length > 0 ? [{ name: 'TAGS', value: job.tags.join(', ').slice(0, 255) }] : [],
    features: [
      text(name(FEATURE_KEYS.STATE), ids.feature(FEATURE_KEYS.STATE)),
      text(name(FEATURE_KEYS.LAST_SUCCESS), ids.feature(FEATURE_KEYS.LAST_SUCCESS)),
      duration(
        name(FEATURE_KEYS.HOURS_SINCE_SUCCESS),
        ids.feature(FEATURE_KEYS.HOURS_SINCE_SUCCESS),
        DEVICE_FEATURE_UNITS.HOURS,
        MAX_HOURS,
      ),
      duration(
        name(FEATURE_KEYS.LAST_DURATION),
        ids.feature(FEATURE_KEYS.LAST_DURATION),
        DEVICE_FEATURE_UNITS.SECONDS,
        MAX_DURATION_S,
      ),
      sensor(
        name(FEATURE_KEYS.DESTINATION_SIZE),
        ids.feature(FEATURE_KEYS.DESTINATION_SIZE),
        DEVICE_FEATURE_CATEGORIES.DATA,
        DEVICE_FEATURE_TYPES.DATA.SIZE,
        { unit: DEVICE_FEATURE_UNITS.MEGABYTE, keep_history: true, min: 0, max: MAX_SIZE_MB },
      ),
      counter(name(FEATURE_KEYS.VERSIONS), ids.feature(FEATURE_KEYS.VERSIONS), MAX_COUNT),
      counter(name(FEATURE_KEYS.ERRORS), ids.feature(FEATURE_KEYS.ERRORS), MAX_COUNT),
      counter(name(FEATURE_KEYS.WARNINGS), ids.feature(FEATURE_KEYS.WARNINGS), MAX_COUNT),
      binary(name(FEATURE_KEYS.RUNNING), ids.feature(FEATURE_KEYS.RUNNING)),
      text(name(FEATURE_KEYS.NEXT_RUN), ids.feature(FEATURE_KEYS.NEXT_RUN)),
    ],
  };
}

/** The discovery payload of the server. */
export function buildServerDevice(gladys, language = 'en') {
  const ids = serverIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: 'Duplicati',
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [],
    features: [
      binary(names[`server_${SERVER_KEYS.RUNNING}`], ids.feature(SERVER_KEYS.RUNNING)),
      sensor(
        names[SERVER_KEYS.PROGRESS],
        ids.feature(SERVER_KEYS.PROGRESS),
        DEVICE_FEATURE_CATEGORIES.LEVEL_SENSOR,
        DEVICE_FEATURE_TYPES.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
        { unit: DEVICE_FEATURE_UNITS.PERCENT, keep_history: false, min: 0, max: 100 },
      ),
      text(names[SERVER_KEYS.CURRENT_JOB], ids.feature(SERVER_KEYS.CURRENT_JOB)),
      counter(names[SERVER_KEYS.FAILED], ids.feature(SERVER_KEYS.FAILED), MAX_JOBS),
      counter(names[SERVER_KEYS.OVERDUE], ids.feature(SERVER_KEYS.OVERDUE), MAX_JOBS),
    ],
  };
}

const megabytes = (bytes) => Math.round((bytes / 1_000_000) * 10) / 10;

/**
 * The value of every feature of a job: `{ key, device_feature_external_id,
 * state|text }`, nothing for a value that is not known.
 */
export function jobValues(gladys, job, language, now) {
  const ids = jobIds(gladys, job.id);
  const values = [
    { key: FEATURE_KEYS.STATE, text: pick(STATE_TEXT[stateOf(job)], language) },
    {
      key: FEATURE_KEYS.LAST_SUCCESS,
      text: job.lastSuccess === null ? '-' : formatTime(job.lastSuccess, language),
    },
  ];
  const hours = hoursSince(job, now);
  if (hours !== null) {
    values.push({ key: FEATURE_KEYS.HOURS_SINCE_SUCCESS, state: Math.min(hours, MAX_HOURS) });
  }
  if (job.lastDurationS !== null) {
    values.push({ key: FEATURE_KEYS.LAST_DURATION, state: job.lastDurationS });
  }
  if (job.destinationBytes !== null) {
    values.push({ key: FEATURE_KEYS.DESTINATION_SIZE, state: megabytes(job.destinationBytes) });
  }
  if (job.versions !== null) {
    values.push({ key: FEATURE_KEYS.VERSIONS, state: job.versions });
  }
  values.push(
    { key: FEATURE_KEYS.ERRORS, state: job.lastRun?.errors ?? 0 },
    { key: FEATURE_KEYS.WARNINGS, state: job.lastRun?.warnings ?? 0 },
    { key: FEATURE_KEYS.RUNNING, state: job.running ? 1 : 0 },
    {
      key: FEATURE_KEYS.NEXT_RUN,
      text: job.nextRun === null ? '-' : formatTime(job.nextRun, language),
    },
  );
  return values.map(({ key, ...value }) => ({
    key,
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}

/** The values of the server device. */
export function serverValues(gladys, { jobs, activeJob, progress }) {
  const ids = serverIds(gladys);
  const states = jobs.map(stateOf);
  const values = [
    { key: SERVER_KEYS.RUNNING, state: activeJob ? 1 : 0 },
    { key: SERVER_KEYS.PROGRESS, state: activeJob ? (progress ?? 0) : 0 },
    { key: SERVER_KEYS.CURRENT_JOB, text: activeJob ? activeJob.name : '-' },
    { key: SERVER_KEYS.FAILED, state: states.filter((s) => s === 'failed').length },
    {
      key: SERVER_KEYS.OVERDUE,
      state: jobs.filter((job) => job.overdue).length,
    },
  ];
  return values.map(({ key, ...value }) => ({
    key,
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}
