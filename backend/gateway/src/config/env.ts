/**
 * Environment schema.
 *
 * Parsed once at boot and never read from `process.env` again. A missing or
 * malformed variable fails startup loudly rather than surfacing as a confusing
 * runtime error on the first request that needs it.
 */

import { z } from 'zod';

const upstream = z.url({ protocol: /^https?$/ });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  METADATA_ROOT: z.string().optional(),

  REDIS_URL: z.string().min(1),
  AUDIT_DATABASE_URL: z.string().min(1),

  // Rotated through OpenBao in production. Length floor is a guard against a
  // placeholder reaching a deployed environment, not a substitute for rotation.
  SERVICE_AUTH_SECRET: z.string().min(32),

  UPSTREAM_AUTH_SERVICE: upstream,
  UPSTREAM_PSEUDONYM_SERVICE: upstream,
  UPSTREAM_COMMUNITY_SERVICE: upstream,
  UPSTREAM_MODERATION_SERVICE: upstream,
  UPSTREAM_AI_ORCHESTRATOR: upstream,
  UPSTREAM_CONSENT_SERVICE: upstream,
  UPSTREAM_CLINICAL_VAULT_SERVICE: upstream,
  UPSTREAM_CARE_THERAPY_SERVICE: upstream,
  UPSTREAM_THERAPIST_SERVICE: upstream,
  UPSTREAM_BILLING_SUBSIDY_SERVICE: upstream,
  UPSTREAM_SAFETY_CRISIS_SERVICE: upstream,
  UPSTREAM_NOTIFICATION_SERVICE: upstream,
  UPSTREAM_RETENTION_SERVICE: upstream,
  UPSTREAM_ADMIN_SERVICE: upstream,
  UPSTREAM_PARTNER_SERVICE: upstream,
  UPSTREAM_BREAK_GLASS_SERVICE: upstream,

  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_AUTHENTICATED: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_MAX_ANONYMOUS: z.coerce.number().int().positive().default(20),

  SESSION_MAX_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(720),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid gateway environment:\n${detail}`);
  }

  if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.SERVICE_AUTH_SECRET.includes('dev-only')) {
      throw new Error('SERVICE_AUTH_SECRET still holds the development placeholder.');
    }
  }

  return parsed.data;
}

/**
 * Upstream base URL for a service id from the service registry.
 *
 * Absence is denial: a service with no configured upstream cannot be routed to.
 * While the domain services are unbuilt this is the expected state for most of
 * them, and it produces a clean 502 rather than a hang.
 */
export function upstreamFor(env: Env, serviceId: string): string | undefined {
  const key = `UPSTREAM_${serviceId.replaceAll('-', '_').toUpperCase()}` as keyof Env;
  const value = env[key];
  return typeof value === 'string' ? value : undefined;
}
