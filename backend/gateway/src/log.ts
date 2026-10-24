/**
 * Structured logging.
 *
 * Folder-structure rule 2: a log statement may not carry a field classified
 * sensitive. The redaction list below is the mechanical backstop for that rule — it
 * is not permission to log these fields and rely on redaction. §12P fixes what a log
 * line may contain: request id, pseudo id, service, action, timestamp, risk score,
 * consent decision, access result. Nothing else.
 *
 * Note that `pseudo_id` is deliberately loggable and `account_id` is not. The
 * pseudonymous id is the join key the audit trail already records; the account id is
 * an authentication subject and belongs only in auth-service.
 */

import { pino } from 'pino';

const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-alaap-service-auth"]',
  'res.headers["set-cookie"]',
  '*.token',
  '*.sessionToken',
  '*.password',
  '*.otp',
  '*.recoveryCode',
  '*.accountId',
  '*.legalName',
  '*.mobile',
  '*.emergencyContact',
  '*.content',
  '*.body',
  '*.journal',
  '*.transcript',
];

export function createLogger(level: string, environment: string) {
  return pino({
    level,
    redact: { paths: REDACT, censor: '[redacted]' },
    base: { service: 'gateway' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(environment === 'development'
      ? { transport: { target: 'pino/file', options: { destination: 1 } } }
      : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
