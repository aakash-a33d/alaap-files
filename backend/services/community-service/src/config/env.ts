import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8103),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Repository root, for the metadata files. Defaults to the tree the code lives in. */
  METADATA_ROOT: z.string().optional(),

  /** community_vault. community-service owns posts, comments, reports, restrictions. */
  COMMUNITY_DATABASE_URL: z.string().min(1),

  /** Separate credential on the audit instance. Append only. */
  AUDIT_DATABASE_URL: z.string().min(1),

  /**
   * The AI orchestrator, for moderating replies.
   *
   * Loopback. This service calls /v1/moderate/internal, which has no gateway path and
   * is not for a network — it returns the scores and thresholds that make probing the
   * filter efficient.
   */
  UPSTREAM_AI_ORCHESTRATOR: z.string().url(),

  /**
   * moderation-service, which owns the verdict record.
   *
   * This service has no write on `moderation_verdicts`. Recording the decision there
   * is what lets a member appeal it later.
   */
  UPSTREAM_MODERATION_SERVICE: z.string().url(),

  /** Verifies the gateway's signature, and signs this service's calls to the AI tier. */
  SERVICE_AUTH_SECRET: z.string().min(32),

  /**
   * How often expired posts are swept, in seconds.
   *
   * The sweep changes state; it is not what makes a post invisible. The feed filters
   * on `expires_at` independently, so a post disappears the moment it expires however
   * long this interval is. Set it to 0 to disable the sweep in a test.
   */
  /**
   * How often B1 looks for a post awaiting its reply, in seconds. 0 disables it.
   *
   * Asynchronous by contract: the post publishes immediately and the AI reply arrives
   * afterwards, like a peer's rather than a bot answering in the same breath. A few
   * seconds of delay is the product behaviour, not a limitation.
   */
  RESPONSE_WORKER_SECONDS: z.coerce.number().int().min(0).default(5),

  EXPIRY_SWEEP_SECONDS: z.coerce.number().int().min(0).default(300),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`community-service environment is not usable:\n${problems}`);
  }
  return parsed.data;
}
