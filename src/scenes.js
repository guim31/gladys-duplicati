// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Is this backup failed?" is already a scene condition on the device
// features. The reading action is about what a condition cannot do: put the
// state in a message ("Documents NAS: failed, last success 18/10 02:05"). It
// reads Duplicati again when the last read is older than 15 seconds.
//
// "Start a backup" can be disabled in the configuration: a scene, a voice
// assistant or another user of Gladys then cannot start one.
// -----------------------------------------------------------------------------

import { hoursSince, stateOf } from './devices.js';
import { SENTENCE_TEXT, STATE_TEXT, formatTime, labelled, pick } from './texts.js';

export const SCENE_ACTIONS = {
  async get_backup_status(hub, { fields = {} }) {
    const job = await hub.jobOf(fields.device);
    const language = hub.config.language;
    const state = stateOf(job);
    const stateText = pick(STATE_TEXT[state], language);
    const lastSuccess = job.lastSuccess === null ? '' : formatTime(job.lastSuccess, language);
    const words = SENTENCE_TEXT[language] ?? SENTENCE_TEXT.en;
    return {
      failed: job.lastRun?.result === 'error',
      overdue: job.overdue,
      state: stateText,
      name: job.name,
      last_success: lastSuccess,
      hours_since_success: hoursSince(job, hub.now()) ?? -1,
      sentence: `${labelled(job.name, stateText, language)}, ${
        lastSuccess ? words.lastSuccess(lastSuccess) : words.never
      }.`,
    };
  },

  async start_backup(hub, { fields = {} }) {
    await hub.startBackup(await hub.jobOf(fields.device));
  },
};
