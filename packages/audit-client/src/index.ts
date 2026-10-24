/**
 * packages/audit-client
 *
 * The one way to write an audit event. Extracted from the gateway so that seventeen
 * services do not each grow their own INSERT with their own idea of what belongs in
 * `context`.
 *
 * WHAT MUST NEVER REACH THE AUDIT VAULT (§12P)
 *
 * Journal text, therapy transcripts, post or reply bodies, government ID numbers,
 * emergency contact details, authentication secrets, encryption keys, payment
 * credentials. An audit row records that an access happened, never what was read.
 *
 * `context` is checked against a key allowlist before insert, because a caller
 * passing content in a jsonb blob would be a silent, permanent leak into the one
 * store designed never to be deleted — and unlike every other table, a bad row here
 * cannot be corrected afterwards.
 *
 * A FAILED WRITE FAILS THE OPERATION IT WAS RECORDING (§8). This client throws
 * rather than swallowing, and callers are expected to abort. An unlogged sensitive
 * access is not an acceptable outcome.
 */

import { Pool } from 'pg';

// The vocabulary comes from @alaap/shared-types, where each union carries the
// database CHECK constraint it mirrors. Declaring them here as well is how the
// engine and the writer drift apart without either failing to typecheck.
import type { AccessResult, AuditActorRole, ConsentDecision } from '@alaap/shared-types';

export type { AccessResult, ConsentDecision };
/** Superset of the session roles: audit_events also permits `service` and `system`. */
export type ActorRole = AuditActorRole;

export interface AuditEvent {
  requestId: string;
  pseudoId?: number | undefined;
  actorId?: string | undefined;
  actorRole: ActorRole;
  serviceName: string;
  /** Must be registered in audit_event_types, or the FK refuses the insert. */
  actionType: string;
  /** Must be registered in metadata/consent/purpose-registry/. */
  purpose: string;
  consentDecision: ConsentDecision;
  accessResult: AccessResult;
  riskScore?: number | undefined;
  context?: Record<string, unknown> | undefined;
}

/**
 * Keys any service may place in `context`. Non-identifying operational facts only.
 *
 * Shared rather than per-service on purpose: a service that needs a new key has to
 * add it here, where the addition is visible in review, instead of quietly widening
 * its own copy. Anything not on the list is dropped and counted.
 */
export const CONTEXT_ALLOWLIST: ReadonlySet<string> = new Set([
  // routing and outcome
  'api_group',
  'method',
  'upstream_service',
  'status',
  'denial_reason',
  'step_up_required',
  'rate_limit_scope',
  // record-level, without identifying the record's contents
  'record_kind',
  'record_count',
  'vault',
  'visibility',
  'privacy_mode',
  'ai_analysis',
  // consent and policy
  'consent_state',
  'policy_version',
  'consent_version',
  // which door a second factor unlocked, and for how long it was good
  'step_up_scope',
  // safety and emergency
  'risk_band',
  'case_reference',
  'signal_source',
  'model_version',
  'fields_released_count',
  // retention
  'retention_reason',
  'purged_count',
]);

export class AuditWriteError extends Error {
  constructor(cause: unknown) {
    // Use the standard Error cause option rather than a field of our own — Error
    // already declares `cause` in ES2022, and shadowing it needs an override.
    super('Audit write failed', { cause });
    this.name = 'AuditWriteError';
  }
}

export interface AuditClient {
  write(event: AuditEvent): Promise<void>;
  close(): Promise<void>;
}

/**
 * Drops any key not on the allowlist, and any value that is not a scalar.
 *
 * Exported so it can be tested directly — this is the function standing between a
 * careless caller and a permanent leak, and it deserves its own assertions rather
 * than being covered incidentally.
 */
export function sanitiseContext(
  context: Record<string, unknown> | undefined,
): { context: Record<string, unknown>; dropped: string[] } {
  if (context === undefined) return { context: {}, dropped: [] };

  const out: Record<string, unknown> = {};
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(context)) {
    const scalar =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    if (CONTEXT_ALLOWLIST.has(key) && scalar) {
      out[key] = value;
    } else {
      dropped.push(key);
    }
  }
  return { context: out, dropped };
}

const INSERT = `
INSERT INTO audit_events
  (request_id, pseudo_id, actor_id, actor_role, service_name,
   action_type, purpose, consent_decision, access_result, risk_score, context)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`;

export interface PostgresAuditClientOptions {
  connectionString: string;
  /** Identifies this writer in pg_stat_activity. */
  applicationName: string;
  /** Called with the dropped key names when a caller passes something disallowed. */
  onDroppedContext?: (keys: string[]) => void;

  /**
   * Called when an idle pooled connection dies — a database restart, a network blip.
   *
   * Something must listen. `pg` re-emits these on the Pool, and an 'error' event with
   * no listener is an uncaught exception that exits the process. Here that would be
   * the audit vault taking down the service it was only supposed to be recording.
   */
  onPoolError?: (err: Error) => void;
}

export class PostgresAuditClient implements AuditClient {
  private readonly pool: Pool;
  private readonly onDropped: ((keys: string[]) => void) | undefined;
  private droppedCount = 0;

  constructor(options: PostgresAuditClientOptions) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: 8,
      // An audit write that hangs blocks the request it is recording, so it must
      // fail fast. Failing closed in two seconds beats holding a connection.
      connectionTimeoutMillis: 2_000,
      statement_timeout: 2_000,
      application_name: options.applicationName,
    });
    // The pool discards the dead client and opens a fresh one on the next write; the
    // listener exists so the process is still alive to make that next write.
    this.pool.on('error', (err) => {
      options.onPoolError?.(err instanceof Error ? err : new Error(String(err)));
    });
    this.onDropped = options.onDroppedContext;
  }

  async write(event: AuditEvent): Promise<void> {
    const { context, dropped } = sanitiseContext(event.context);
    if (dropped.length > 0) {
      this.droppedCount += dropped.length;
      this.onDropped?.(dropped);
    }

    try {
      await this.pool.query(INSERT, [
        event.requestId,
        event.pseudoId ?? null,
        event.actorId ?? null,
        event.actorRole,
        event.serviceName,
        event.actionType,
        event.purpose,
        event.consentDecision,
        event.accessResult,
        event.riskScore ?? null,
        JSON.stringify(context),
      ]);
    } catch (cause) {
      throw new AuditWriteError(cause);
    }
  }

  get droppedContextKeyCount(): number {
    return this.droppedCount;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * `gateway.<domain>.<verb>` from an API group prefix and an HTTP method.
 *
 * Lives here rather than in the gateway because scripts/db/migrate.mjs derives the
 * registered event types from the same rule. Two copies would let the registry and
 * the emitter disagree, and the failure mode is a foreign key violation that takes
 * the request down with it.
 */
const VERBS: Readonly<Record<string, string>> = {
  GET: 'read',
  HEAD: 'read',
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

export function gatewayActionType(prefix: string, method: string): string {
  const domain = prefix.replace(/^\/api\//, '').replaceAll('-', '_');
  return `gateway.${domain}.${VERBS[method.toUpperCase()] ?? 'other'}`;
}
