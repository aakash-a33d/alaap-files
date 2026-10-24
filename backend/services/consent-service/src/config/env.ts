import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8105),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  METADATA_ROOT: z.string().optional(),

  /**
   * clinical_vault. Consent records, versions and withdrawals.
   *
   * This service can read none of the content it decides about — `journal_entries`
   * and `short_stories` are withheld from it in the grants, deliberately.
   */
  CLINICAL_DATABASE_URL: z.string().min(1),

  /** Separate credential on the audit instance. Append only. */
  AUDIT_DATABASE_URL: z.string().min(1),

  SERVICE_AUTH_SECRET: z.string().min(32),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`consent-service environment is not usable:\n${problems}`);
  }
  return parsed.data;
}
