import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8101),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** `core`. auth-service is the sole holder of credentials to it. */
  CORE_DATABASE_URL: z.string().min(1),
  /** Separate credential on the audit instance. INSERT only. */
  AUDIT_DATABASE_URL: z.string().min(1),
  /** Sessions and OTP challenges. */
  REDIS_URL: z.string().min(1),

  /** Verifies the gateway's signature, and signs its own call to pseudonym-service. */
  SERVICE_AUTH_SECRET: z.string().min(32),
  UPSTREAM_PSEUDONYM_SERVICE: z.url({ protocol: /^https?$/ }),

  /**
   * Pepper for the mobile blind index. Must be identical to the one
   * identity-vault-service uses, or the two instances cannot reconcile an account
   * without one of them learning the number.
   *
   * Comes from OpenBao in deployment. A rotation here is a re-index of every account,
   * so it is a planned operation rather than a routine one.
   */
  MOBILE_PEPPER: z.string().min(32),
  /** Pepper for OTP hashes. Rotatable freely — challenges live five minutes. */
  OTP_PEPPER: z.string().min(32),

  /**
   * Development only. Logs the OTP instead of sending it, because TRAI DLT
   * registration gates every SMS the platform can send and takes weeks.
   */
  /** Repository root, for the metadata files. Defaults to the tree the code lives in. */
  METADATA_ROOT: z.string().optional(),

  OTP_TRANSPORT: z.enum(['log', 'msg91']).default('log'),

  /**
   * Peppers the account-scoped device HMAC.
   *
   * Without it, somebody holding the database could test candidate device keys
   * offline. Rotating it makes every member's devices look new once — sessions keep
   * working, but the device list resets, so it is not a routine rotation.
   */
  DEVICE_PEPPER: z.string().min(32),

  /** Shown in the OS passkey prompt. User-facing. */
  RP_NAME: z.string().min(1).default('Alaap'),
  /**
   * WebAuthn relying party id: the registrable domain, NOT the full origin.
   *
   * The classic deployment failure is an rpId that is not a registrable suffix of
   * the origin — every credential becomes unusable and the browser error says very
   * little about why.
   */
  RP_ID: z.string().min(1).default('localhost'),
  /** The exact origin the browser sends. Must match character for character. */
  EXPECTED_ORIGIN: z.url().default('http://localhost:5173'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid auth-service environment:\n${detail}`);
  }

  if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.OTP_TRANSPORT === 'log') {
      // Logging an OTP in production would put a live credential in the log stream,
      // which §12P forbids and which would also mean nobody can actually register.
      throw new Error('OTP_TRANSPORT=log is refused in production');
    }
    for (const [key, value] of Object.entries(parsed.data)) {
      if (typeof value === 'string' && value.includes('dev-only')) {
        throw new Error(`${key} still holds a development placeholder`);
      }
    }
  }

  return parsed.data;
}
