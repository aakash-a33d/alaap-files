import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8106),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  METADATA_ROOT: z.string().optional(),

  /** clinical_vault. Journals, moods, stories. Every body here is encrypted. */
  CLINICAL_DATABASE_URL: z.string().min(1),

  /** Separate credential on the audit instance. Append only. */
  AUDIT_DATABASE_URL: z.string().min(1),

  /** OpenBao. Wraps and unwraps the per-record data keys; never sees a body. */
  OPENBAO_ADDR: z.string().url(),
  OPENBAO_TOKEN: z.string().min(8),

  /**
   * The Transit key this vault's DEKs are wrapped with.
   *
   * One key per vault. Holding this service's credentials is not enough to read an
   * identity record, because that record's DEK is wrapped by a different key.
   */
  CLINICAL_KEY_ID: z.string().min(1).default('alaap-clinical'),

  /** consent-service. This service cannot read consent records itself. */
  UPSTREAM_CONSENT_SERVICE: z.string().url(),

  SERVICE_AUTH_SECRET: z.string().min(32),

  /**
   * The plan every member is treated as being on, until billing-subsidy-service exists.
   *
   * Defaults to the FREE tier, which is the safe direction: the failure mode is a
   * paying member briefly held to free limits rather than every member silently
   * ungated. Journals are a paid feature, so on the default NOBODY can write one —
   * which is correct, and is why this is overridable in development rather than
   * hard-coded.
   */
  DEFAULT_PLAN_ID: z.string().default('anonymous-community'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`clinical-vault-service environment is not usable:\n${problems}`);
  }
  return parsed.data;
}
