/**
 * Environment, validated at boot.
 *
 * The upstream URLs are the whole of this service's reach. It holds a database
 * credential for `core` alone; everything it deletes, it deletes by asking.
 */

import { z } from 'zod';

import { PURGE_ORDER } from './targets.ts';

const Schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(8112),
  LOG_LEVEL: z.string().default('info'),
  CORE_DATABASE_URL: z.string().min(1),
  AUDIT_DATABASE_URL: z.string().min(1),
  SERVICE_AUTH_SECRET: z.string().min(16),
});

export type Env = z.infer<typeof Schema>;

export function loadEnv(): Env {
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`invalid environment: ${missing}`);
  }
  return parsed.data;
}

/**
 * Where each vault's owning service lives.
 *
 * A target with no URL is not a silent skip. It is reported as a failed job and turns
 * the request `failed`, because a deletion that quietly omits a vault is the worst
 * outcome available here — the member is told it is done, and it is not.
 */
export function loadUpstreams(log: { warn(o: object, m?: string): void }): Map<string, string> {
  const map = new Map<string, string>();
  for (const target of PURGE_ORDER) {
    const url = process.env[target.upstreamEnv];
    if (url === undefined || url === '') {
      log.warn(
        { service: target.service, variable: target.upstreamEnv },
        'no upstream configured; deletions will report this vault as uncleared',
      );
      continue;
    }
    map.set(target.service, url);
  }
  return map;
}
