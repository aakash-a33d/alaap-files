/**
 * Registration. The use case, orchestrating domain rules and infrastructure.
 *
 * Two steps, because an SMS round trip sits between them:
 *
 *   start   normalise the number, gate the send, issue an OTP
 *   verify  check the code, create the account if new, mint a session
 *
 * IDENTITY TIER 0 (§11). This collects a verified phone and an age band, and nothing
 * else. No name, no address, no government ID — those arrive only when a specific
 * obligation requires them, and never "in case".
 *
 * The number itself is not stored here at all: `core` holds only the blind index, and
 * the number goes to the identity vault when a care tier needs it. At tier 0 there is
 * nowhere for it to be kept, which is the point.
 */

import type { AuditClient } from '@alaap/audit-client';
import type { SessionStore } from '@alaap/session-store';
import { createHash } from 'node:crypto';

import {
  generateChallengeId,
  generateRecoveryCodes,
  mobileLookupHash,
  normaliseIndianMobile,
} from '../domain/identifiers.ts';
import {
  CHALLENGE_TTL_SECONDS,
  generateOtp,
  hashOtp,
  verifyOtp,
  type OtpChallenge,
} from '../domain/otp.ts';
import type { Devices } from './devices.ts';
import type { AccountRepository } from '../infrastructure/accounts.ts';
import type { ChallengeStore } from '../infrastructure/challenges.ts';
import type { PseudonymClient } from '../infrastructure/pseudonym-client.ts';

export interface RegisterDeps {
  devices: Devices;
  accounts: AccountRepository;
  challenges: ChallengeStore;
  sessions: SessionStore;
  pseudonyms: PseudonymClient;
  audit: AuditClient;
  mobilePepper: string;
  otpPepper: string;
  /** In development, `log` prints the code — TRAI DLT gates real delivery. */
  otpTransport: 'log' | 'msg91';
  log: { info(o: object, m?: string): void; warn(o: object, m?: string): void };
}

export type StartOutcome =
  | { ok: true; challengeId: string; expiresInSeconds: number; devCode?: string }
  | { ok: false; reason: 'invalid_mobile' }
  | { ok: false; reason: 'rate_limited'; retryAfterSeconds: number };

export type VerifyOutcome =
  | {
      ok: true;
      token: string;
      pseudoId: number;
      handle: string;
      /** Present only when the account was created by this call. Shown once. */
      recoveryCodes?: string[];
      isNewAccount: boolean;
    }
  | { ok: false; reason: string; attemptsRemaining?: number };

export class Registration {
  // Explicit field rather than a constructor parameter property: Node's strip-only
  // TypeScript mode rejects those, because erasing the annotation would also erase
  // the assignment. tsc accepts them, so it only shows up at runtime.
  private readonly deps: RegisterDeps;

  constructor(deps: RegisterDeps) {
    this.deps = deps;
  }

  async start(mobile: string, requestId: string, ipPrefix?: string): Promise<StartOutcome> {
    const e164 = normaliseIndianMobile(mobile);
    if (e164 === undefined) return { ok: false, reason: 'invalid_mobile' };

    const hash = mobileLookupHash(e164, this.deps.mobilePepper);
    const hashHex = hash.toString('hex');

    const gate = await this.deps.challenges.checkSendGate(hashHex);
    if (!gate.allowed) {
      // Deliberately the same shape whether the number exists or not: a differing
      // response would turn this endpoint into an account-enumeration oracle.
      return { ok: false, reason: 'rate_limited', retryAfterSeconds: gate.retryAfterSeconds };
    }

    const code = generateOtp();
    const challenge: OtpChallenge = {
      challengeId: generateChallengeId(),
      mobileLookupHash: hashHex,
      codeHash: hashOtp(code, this.deps.otpPepper).toString('base64'),
      attemptsUsed: 0,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
      intent: 'register',
    };

    await this.deps.challenges.put(challenge);
    await this.deps.challenges.recordSend(hashHex);

    if (this.deps.otpTransport === 'log') {
      // Development only, and env.ts refuses this transport in production — an OTP
      // in a log stream is a live credential where §12P says none may appear.
      this.deps.log.info({ challengeId: challenge.challengeId, code }, 'DEV OTP (not sent)');
    }

    await this.deps.audit.write({
      requestId,
      actorRole: 'system',
      serviceName: 'auth-service',
      actionType: 'auth.otp.issued',
      purpose: 'account-recovery',
      consentDecision: 'not_required',
      accessResult: 'allowed',
      context: { method: 'otp' },
    });

    await this.deps.accounts.recordLoginEvent({
      accountId: undefined,
      method: 'otp',
      result: 'challenged',
      ipPrefix,
      userAgentHash: undefined,
    });

    const out: StartOutcome = {
      ok: true,
      challengeId: challenge.challengeId,
      expiresInSeconds: CHALLENGE_TTL_SECONDS,
    };
    if (this.deps.otpTransport === 'log') {
      return { ...out, devCode: code };
    }
    return out;
  }

  async verify(params: {
    challengeId: string;
    code: string;
    /** Random value the client generates once and keeps. Optional; see domain/devices.ts. */
    deviceKey?: string | undefined;
    /** Read for a coarse label and discarded. Never stored. */
    userAgent?: string | undefined;

    preferredLanguage: string;
    ageConfirmed: boolean;
    // `| undefined` explicitly, because exactOptionalPropertyTypes distinguishes
    // "absent" from "present and undefined", and a Zod-parsed optional is the latter.
    country?: string | undefined;
    requestId: string;
    ipPrefix?: string | undefined;
  }): Promise<VerifyOutcome> {
    const challenge = await this.deps.challenges.get(params.challengeId);
    if (challenge === undefined) {
      return { ok: false, reason: 'challenge_not_found' };
    }

    // Spend the attempt before comparing, so a crash costs an attempt rather than
    // granting a free one.
    const used = await this.deps.challenges.spendAttempt(params.challengeId);
    const outcome = verifyOtp(
      { ...challenge, attemptsUsed: used - 1 },
      params.code,
      'register',
      this.deps.otpPepper,
    );

    if (!outcome.ok) {
      await this.deps.audit.write({
        requestId: params.requestId,
        actorRole: 'system',
        serviceName: 'auth-service',
        actionType: 'auth.otp.failed',
        purpose: 'account-recovery',
        consentDecision: 'not_required',
        accessResult: 'denied',
        context: { method: 'otp', denial_reason: outcome.reason },
      });
      await this.deps.accounts.recordLoginEvent({
        accountId: undefined,
        method: 'otp',
        result: 'failure',
        ipPrefix: params.ipPrefix,
        userAgentHash: undefined,
      });
      return { ok: false, reason: outcome.reason, attemptsRemaining: outcome.attemptsRemaining };
    }

    await this.deps.challenges.consume(params.challengeId);

    const mobileHash = Buffer.from(challenge.mobileLookupHash, 'hex');
    let account = await this.deps.accounts.findByMobileHash(mobileHash);
    let recoveryCodes: string[] | undefined;
    const isNewAccount = account === undefined;

    if (account === undefined) {
      const bundle = generateRecoveryCodes();
      account = await this.deps.accounts.create({
        mobileHash,
        preferredLanguage: params.preferredLanguage,
        ageConfirmed: params.ageConfirmed,
        country: params.country,
        recoveryCodes: bundle,
      });
      recoveryCodes = bundle.plaintext;

      await this.deps.audit.write({
        requestId: params.requestId,
        pseudoId: account.pseudoId,
        actorId: account.id,
        actorRole: 'user',
        serviceName: 'auth-service',
        actionType: 'auth.account.created',
        purpose: 'account-recovery',
        consentDecision: 'not_required',
        accessResult: 'allowed',
        context: {},
      });
      await this.deps.audit.write({
        requestId: params.requestId,
        pseudoId: account.pseudoId,
        actorId: account.id,
        actorRole: 'user',
        serviceName: 'auth-service',
        actionType: 'auth.recovery_codes.issued',
        purpose: 'account-recovery',
        consentDecision: 'not_required',
        accessResult: 'allowed',
        context: { record_count: bundle.hashes.length },
      });
    }

    if (account.status !== 'active') {
      return { ok: false, reason: 'account_not_active' };
    }

    // Idempotent on pseudo_id, so a retried final step over a bad mobile connection
    // returns the existing persona rather than failing or creating a second one.
    const persona = await this.deps.pseudonyms.createPersona(
      account.pseudoId,
      params.requestId,
    );

    // Before the session, so the session can carry the device id. Never throws and
    // never blocks: a sign-in must not fail over device bookkeeping.
    const deviceId = await this.deps.devices.register({
      accountId: account.id,
      pseudoId: account.pseudoId,
      deviceKey: params.deviceKey,
      userAgent: params.userAgent,
      requestId: params.requestId,
    });

    const { token, record } = await this.deps.sessions.mint({
      accountId: account.id,
      pseudoId: account.pseudoId,
      actorRole: 'user',
      ...(deviceId !== undefined ? { deviceId } : {}),
    });

    await this.deps.accounts.recordSession({
      accountId: account.id,
      sessionId: record.sessionId,
      tokenHash: createHash('sha256').update(token, 'utf8').digest(),
      actorRole: record.actorRole,
      expiresAt: record.expiresAt,
      absoluteExpiresAt: record.absoluteExpiresAt,
      deviceId,
    });

    await this.deps.audit.write({
      requestId: params.requestId,
      pseudoId: account.pseudoId,
      actorId: record.sessionId,
      actorRole: 'user',
      serviceName: 'auth-service',
      actionType: 'auth.session.minted',
      purpose: 'account-recovery',
      consentDecision: 'not_required',
      accessResult: 'allowed',
      context: { method: 'otp' },
    });
    await this.deps.accounts.recordLoginEvent({
      accountId: account.id,
      method: 'otp',
      result: 'success',
      ipPrefix: params.ipPrefix,
      userAgentHash: undefined,
    });

    const result: VerifyOutcome = {
      ok: true,
      token,
      pseudoId: account.pseudoId,
      handle: persona.handle,
      isNewAccount,
    };
    return recoveryCodes !== undefined ? { ...result, recoveryCodes } : result;
  }
}
