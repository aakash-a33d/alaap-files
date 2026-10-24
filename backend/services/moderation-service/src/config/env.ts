import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8104),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Repository root, for the metadata files. Defaults to the tree the code lives in. */
  METADATA_ROOT: z.string().optional(),

  /**
   * community_vault. moderation-service owns verdicts, reviews and appeals, and may
   * change a post or comment's STATE — but has no write on any body. It cannot edit
   * what it judges.
   */
  COMMUNITY_DATABASE_URL: z.string().min(1),

  /** Separate credential on the audit instance. Append only. */
  AUDIT_DATABASE_URL: z.string().min(1),

  /** Verifies the gateway's signature, and community-service's internal calls. */
  SERVICE_AUTH_SECRET: z.string().min(32),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`moderation-service environment is not usable:\n${problems}`);
  }
  return parsed.data;
}
