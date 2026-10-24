import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8102),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  METADATA_ROOT: z.string().optional(),

  /** community_vault. pseudonym-service owns personas (handle included) and blocks. */
  COMMUNITY_DATABASE_URL: z.string().min(1),
  /** Separate credential on the audit instance. Append only. */
  AUDIT_DATABASE_URL: z.string().min(1),

  /** Verifies the gateway's signature. A request without one is refused. */
  SERVICE_AUTH_SECRET: z.string().min(32),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid pseudonym-service environment:\n${detail}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.SERVICE_AUTH_SECRET.includes('dev-only')) {
    throw new Error('SERVICE_AUTH_SECRET still holds the development placeholder.');
  }
  return parsed.data;
}
