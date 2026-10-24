/**
 * Shared gateway types.
 *
 * Note what a `RequestContext` does NOT carry: no legal name, no phone number, no
 * payment detail, no plan tier, no clinical content. The gateway holds no vault
 * credentials beyond audit append, so there is nothing here for a gateway
 * compromise to yield.
 */

export type ActorRole =
  | 'user'
  | 'therapist'
  | 'moderator'
  | 'admin'
  | 'safety_reviewer'
  | 'partner';

export type AuditLevel = 'none' | 'writes' | 'all';

export interface ApiGroup {
  prefix: string;
  service: string;
  authentication: 'required' | 'none';
  roles: ActorRole[];
  purpose?: string | undefined;
  audit: AuditLevel;
  stepUp: boolean;
  /**
   * The gateway issues and clears the session cookie from this group's responses.
   * True only where a session is minted; see the metadata note on /api/auth.
   */
  sessionCookie: boolean;
  /**
   * Responses from this group may stamp a step-up assertion onto the session.
   * True only where a second factor is actually verified.
   */
  stepUpGrant: boolean;
}

/**
 * A session as the gateway sees it. Mirrors the durable record auth-service keeps in
 * `core.sessions`, but the gateway reads it only from Redis — it holds no core
 * database credentials (vault access matrix).
 */
export interface SessionRecord {
  sessionId: string;
  accountId: string;
  /** The join key across vaults. Never a legal identity. */
  pseudoId: number;
  actorRole: ActorRole;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  steppedUpAt?: string;
  steppedUpScope?: string;
  deviceId?: string;
}

export type ConsentDecision =
  | 'granted'
  | 'denied'
  | 'not_required'
  | 'override'
  | 'expired'
  | 'withdrawn';

export type AccessResult = 'allowed' | 'denied' | 'error';

/**
 * The gateway's coarse access decision, computed by the pipeline and recorded by the
 * audit stage before anything is forwarded.
 */
export interface AccessDecision {
  result: AccessResult;
  consent: ConsentDecision;
  /** Machine-readable denial reason. Never rendered to the caller verbatim. */
  reason?: string;
  status: number;
}

export interface RequestContext {
  requestId: string;
  group?: ApiGroup;
  session?: SessionRecord;
  /**
   * The token this request arrived with, kept only for the length of the request.
   *
   * Needed because amending a session — granting a step-up assertion — means writing
   * back to the key the token hashes to. It is never forwarded: the proxy strips
   * `authorization` and `cookie`, and the minimisation allowlist keeps it out of any
   * audit row.
   */
  sessionToken?: string;
  /** Declared by the route policy, never by the caller. */
  purpose?: string;
  decision?: AccessDecision;
  /**
   * Set once stage 8 has written the access-decision row.
   *
   * Exactly one audit row per request. Without this flag a request that is audited
   * as allowed and then fails at the proxy writes a second row claiming it was
   * denied on consent grounds — which is not what happened, and the audit vault is
   * the one store where an untrue row can never be corrected.
   */
  audited?: boolean;
  startedAt: number;
  /** Truncated to a /24 or /48 prefix. Full addresses are never retained. */
  ipPrefix?: string;
}

/** Structural subset of the pino logger, so types.ts stays dependency-free. */
export interface RequestLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx: RequestContext;
      log?: RequestLogger;
    }
  }
}

export class GatewayError extends Error {
  // Declared explicitly rather than as constructor parameter properties: Node's
  // strip-only TypeScript mode (`node --experimental-strip-types`, which the dev
  // script uses) rejects those, because erasing the annotation would also erase the
  // field assignment. tsc accepts them, so this only shows up at runtime.
  readonly status: number;
  readonly code: string;
  /** Shown to the caller. Must never describe why a check failed in detail. */
  readonly publicMessage: string;
  /** Logged, never sent. */
  readonly detail?: string;

  constructor(status: number, code: string, publicMessage: string, detail?: string) {
    super(publicMessage);
    this.name = 'GatewayError';
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
    if (detail !== undefined) this.detail = detail;
  }
}
