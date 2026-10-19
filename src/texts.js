// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, job states, the "Test the connection" report,
// scene outputs and errors, dates. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks every
// table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './duplicati/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your Duplicati server in the configuration.',
    fr: "Saisissez l'adresse de votre serveur Duplicati dans la configuration.",
    de: 'Gib die Adresse deines Duplicati-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor Duplicati en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2:8200',
    fr: 'Adresse incomprise, ex. http://192.168.1.2:8200',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2:8200',
    es: 'Dirección no válida, p. ej. http://192.168.1.2:8200',
  },
  noPassword: {
    en: 'Enter the password of the Duplicati interface in the configuration.',
    fr: "Saisissez le mot de passe de l'interface de Duplicati dans la configuration.",
    de: 'Gib das Passwort der Duplicati-Oberfläche in der Konfiguration ein.',
    es: 'Introduzca la contraseña de la interfaz de Duplicati en la configuración.',
  },
};

// One short explanation per error kind (src/duplicati/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Duplicati does not answer',
    fr: 'Duplicati ne répond pas',
    de: 'Duplicati antwortet nicht',
    es: 'Duplicati no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: use an http:// address or a trusted certificate',
    fr: 'certificat refusé : utilisez une adresse http:// ou un certificat reconnu',
    de: 'Zertifikat abgelehnt: Nutze eine http://-Adresse oder ein vertrauenswürdiges Zertifikat',
    es: 'certificado rechazado: use una dirección http:// o un certificado reconocido',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'password refused by Duplicati',
    fr: 'mot de passe refusé par Duplicati',
    de: 'Passwort von Duplicati abgelehnt',
    es: 'contraseña rechazada por Duplicati',
  },
  [ERROR_KINDS.NOT_DUPLICATI]: {
    en: 'no Duplicati 2.1 or later at this address',
    fr: 'aucun Duplicati 2.1 ou plus récent à cette adresse',
    de: 'kein Duplicati 2.1 oder neuer unter dieser Adresse',
    es: 'no hay ningún Duplicati 2.1 o posterior en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'this backup no longer exists in Duplicati',
    fr: "cette sauvegarde n'existe plus dans Duplicati",
    de: 'diese Sicherung existiert in Duplicati nicht mehr',
    es: 'esta copia ya no existe en Duplicati',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The state of a job, in words (feature "State", widget rows, scene outputs).
export const STATE_TEXT = {
  ok: { en: 'OK', fr: 'OK', de: 'OK', es: 'Correcta' },
  warning: {
    en: 'With warnings',
    fr: 'Avec avertissements',
    de: 'Mit Warnungen',
    es: 'Con avisos',
  },
  failed: { en: 'Failed', fr: 'En échec', de: 'Fehlgeschlagen', es: 'Fallida' },
  overdue: { en: 'Overdue', fr: 'En retard', de: 'Überfällig', es: 'Con retraso' },
  running: { en: 'Running', fr: 'En cours', de: 'Läuft', es: 'En curso' },
  never: { en: 'Never run', fr: 'Jamais lancée', de: 'Nie gelaufen', es: 'Nunca ejecutada' },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'Connected',
    jobs: (count) => `${count} backup(s)`,
    failed: (count) => `${count} failed`,
    overdue: (count) => `${count} overdue`,
  },
  fr: {
    ok: 'Connecté',
    jobs: (count) => `${count} sauvegarde(s)`,
    failed: (count) => `${count} en échec`,
    overdue: (count) => `${count} en retard`,
  },
  de: {
    ok: 'Verbunden',
    jobs: (count) => `${count} Sicherung(en)`,
    failed: (count) => `${count} fehlgeschlagen`,
    overdue: (count) => `${count} überfällig`,
  },
  es: {
    ok: 'Conectado',
    jobs: (count) => `${count} copia(s)`,
    failed: (count) => `${count} fallida(s)`,
    overdue: (count) => `${count} con retraso`,
  },
};

// Errors of the scene actions (shown in Gladys).
export const ACTION_TEXT = {
  unknownJob: {
    en: 'This device is not a Duplicati backup.',
    fr: "Cet appareil n'est pas une sauvegarde Duplicati.",
    de: 'Dieses Gerät ist keine Duplicati-Sicherung.',
    es: 'Este dispositivo no es una copia de Duplicati.',
  },
  startDisabled: {
    en: 'Starting backups from Gladys is disabled in the configuration of the integration.',
    fr: "Le lancement des sauvegardes depuis Gladys est désactivé dans la configuration de l'intégration.",
    de: 'Das Starten von Sicherungen aus Gladys ist in der Konfiguration der Integration deaktiviert.',
    es: 'El inicio de copias desde Gladys está desactivado en la configuración de la integración.',
  },
};

// The `sentence` output of "State of a backup".
export const SENTENCE_TEXT = {
  en: { lastSuccess: (time) => `last success ${time}`, never: 'never succeeded' },
  fr: { lastSuccess: (time) => `dernière réussite ${time}`, never: 'jamais réussie' },
  de: { lastSuccess: (time) => `letzter Erfolg ${time}`, never: 'noch nie erfolgreich' },
  es: { lastSuccess: (time) => `último éxito ${time}`, never: 'nunca se completó' },
};

export const LANGUAGE_FALLBACK = 'en';

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };
const formats = new Map();

/**
 * A date as day/month hours:minutes, in the time zone of Gladys (the
 * supervisor injects TZ). Day and month: a weekly backup made six days ago is
 * not "today at 02:00".
 */
export function formatTime(time, language) {
  const locale = LOCALES[language] ?? LOCALES.en;
  if (!formats.has(locale)) {
    formats.set(
      locale,
      new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  return formats.get(locale).format(new Date(time));
}

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
