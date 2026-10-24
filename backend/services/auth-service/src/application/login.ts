/**
 * Getting back in.
 *
 * Three routes, and they exist because they fail in different ways:
 *
 *   passkey        you still have the device. Fastest, strongest, no number typed.
 *   OTP            you lost the device but still have the NUMBER.
 *   recovery code  you lost the number — a new SIM, a stolen phone, a changed
 *                  operator. Nothing else can reach you, so this is the last door.
 *
 * That progression is the whole design. Each method covers the failure of the one
 * above it, and the last one deliberately does not depend on anything the platform
 * can send you.
 *
 * EVERY FAILURE ANSWERS THE SAME WAY. Distinguishing "no such account" from "wrong
 * code" would turn a login screen into an enumeration oracle, and a phone number
 * space is small enough to walk.
 */

import type { AuditClient } from '@alaap/audit-client';
import type { SessionStore } from '@alaap/session-store';
import { createHash } from 'node:crypto';

import {
  generateChallengeId,
  generateRecoveryCodes,
  mobileLookupHash,
  normaliseIndianMobile,
  recoveryCodeMatches,
} from '../domain/identifiers.ts';
import {
  CHALLENGE_TTL_SECONDS,
  generateOtp,
  hashOtp,
  verifyOtp,
  type OtpChallenge,
} from '../domain/otp.ts';
import type { AccountRepository } from '../infrastructure/accounts.ts';
import type { ChallengeStore } from '../infrastructure/challenges.ts';
import type { PseudonymClient } from '../infrastructure/pseudonym-client.ts';

import type { Devices } from './devices.ts';

export interface LoginDeps {
  devices: Devices;
  accounts: AccountRepository;
  challenges: ChallengeStore;
  sessions: SessionStore;
  pseudonyms: PseudonymClient;
  audit: AuditClient;
  mobilePepper: string;
  otpPepper: string;
  otpTransport: 'log' | 'msg91';
  log: { info(o: object, m?: string): void; warn(o: object, m?: string): void };
}

export type OtpStartOutcome =
  | { ok: true; challengeId: string; expiresInSeconds: number; devCode?: string }
  | { ok: false; reason: 'invalid_mobile' }
  | { ok: false; reason: 'rate_limited'; retryAfterSeconds: number };

export type StepUpStartOutcome =
  | { ok: true; challengeId: string; expiresInSeconds: number; devCode?: string }
  | { ok: false; reason: 'account_not_found' }
  | { ok: false; reason: 'rate_limited'; retryAfterSeconds: number };

export type StepUpVerifyOutcome =
  | { ok: true; scope: string }
  | { ok: false; reason: string; attemptsRemaining?: number };

export type SignInOutcome =
  | { ok: true; token: string; pseudoId: number; handle: string; recoveryCodesRemaining?: number }
  | { ok: false; reason: string; attemptsRemaining?: number };

export class Login {
  private readonly deps: LoginDeps;

  constructor(deps: LoginDeps) {
    this.deps = deps;
  }

  // --------------------------------------------------------------- OTP login ---

  /**
   * Issue a login OTP.
   *
   * Answers identically whether or not an account exists. The code is sent to the
   * number either way; someone who does not control the number learns nothing, and
   * someone who does could have registered anyway.
   */
  async otpStart(mobile: string, requestId: string): Promise<OtpStartOutcome> {
    const e164 = normaliseIndianMobile(mobile);
    if (e164 === undefined) return { ok: false, reason: 'invalid_mobile' };

    const hashHex = mobileLookupHash(e164, this.deps.mobilePepper).toString('hex');
    const gate = await this.deps.challenges.checkSendGate(hashHex);
    if (!gate.allowed) {
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
      // `login`, not `register`. verifyOtp refuses a challenge whose intent does not
      // match, so a code issued to sign in cannot be replayed to create an account.
      intent: 'login',
    };

    await this.deps.challenges.put(challenge);
    await this.deps.challenges.recordSend(hashHex);

    if (this.deps.otpTransport === 'log') {
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

    const out: OtpStartOutcome = {
      ok: true,
      challengeId: challenge.challengeId,
      expiresInSeconds: CHALLENGE_TTL_SECONDS,
    };
    return this.deps.otpTransport === 'log' ? { ...out, devCode: code } : out;
  }

  /**
   * Send a code to prove the member is present, right now.
   *
   * Raised by somebody who already holds a session, so there is no mobile number in
   * the request — the account is looked up from the pseudonym the gateway asserted,
   * and the code goes to the number on file. A step-up that took a number as input
   * would let a caller nominate where the proof is sent, which is not a proof.
   *
   * Rate-limited per account rather than per number. The account is what is known
   * here, and it is also the thing worth protecting from an attacker with a stolen
   * session grinding codes.
   */
  async stepUpStart(params: {
    pseudoId: number;
    scope: string;
    requestId: string;
  }): Promise<StepUpStartOutcome> {
    const account = await this.deps.accounts.findByPseudoId(params.pseudoId);
    if (account === undefined) return { ok: false, reason: 'account_not_found' };

    const gateKey = `step-up:${account.id}`;
    const gate = await this.deps.challenges.checkSendGate(gateKey);
    if (!gate.allowed) {
      return { ok: false, reason: 'rate_limited', retryAfterSeconds: gate.retryAfterSeconds };
    }

    const code = generateOtp();
    const challenge: OtpChallenge = {
      challengeId: generateChallengeId(),
      mobileLookupHash: gateKey,
      codeHash: hashOtp(code, this.deps.otpPepper).toString('base64'),
      attemptsUsed: 0,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
      intent: 'step_up',
      // Bound to this member. Verification refuses a caller who is somebody else.
      pseudoId: params.pseudoId,
    };

    await this.deps.challenges.put(challenge);
    await this.deps.challenges.recordSend(gateKey);

    if (this.deps.otpTransport === 'log') {
      this.deps.log.info({ challengeId: challenge.challengeId, code }, 'DEV STEP-UP OTP (not sent)');
    }

    await this.deps.audit.write({
      requestId: params.requestId,
      pseudoId: params.pseudoId,
      actorRole: 'user',
      serviceName: 'auth-service',
      actionType: 'auth.otp.issued',
      purpose: 'account-recovery',
      consentDecision: 'not_required',
      accessResult: 'allowed',
      context: { method: 'otp', record_kind: 'step_up' },
    });

    const out: StepUpStartOutcome = {
      ok: true,
      challengeId: challenge.challengeId,
      expiresInSeconds: CHALLENGE_TTL_SECONDS,
    };
    return this.deps.otpTransport === 'log' ? { ...out, devCode: code } : out;
  }

  /**
   * Check the code, and say so.
   *
   * Mints nothing. The answer is a statement — "this member proved it is them, for
   * this scope" — and the gateway decides what to do with it, because the gateway is
   * the only thing holding the session. Returning a token here would turn a second
   * factor into a second way in, which is the opposite of the point.
   */
  async stepUpVerify(params: {
    pseudoId: number;
    challengeId: string;
    code: string;
    scope: string;
    requestId: string;
  }): Promise<StepUpVerifyOutcome> {
    const challenge = await this.deps.challenges.get(params.challengeId);
    if (challenge === undefined) return { ok: false, reason: 'authentication_failed' };

    // Somebody else's challenge. Refused with the same words as a wrong code: the
    // caller must not learn whether the id existed or whose it was.
    if (challenge.pseudoId !== params.pseudoId) {
      return { ok: false, reason: 'authentication_failed' };
    }

    const used = await this.deps.challenges.spendAttempt(params.challengeId);
    const outcome = verifyOtp(
      { ...challenge, attemptsUsed: used - 1 },
      params.code,
      'step_up',
      this.deps.otpPepper,
    );

    if (!outcome.ok) {
      await this.deps.audit.write({
        requestId: params.requestId,
        pseudoId: params.pseudoId,
        actorRole: 'user',
        serviceName: 'auth-service',
        actionType: 'auth.otp.failed',
        purpose: 'account-recovery',
        consentDecision: 'not_required',
        accessResult: 'denied',
        context: { method: 'otp', record_kind: 'step_up' },
      });
      return {
        ok: false,
        reason: 'authentication_failed',
        attemptsRemaining: outcome.attemptsRemaining,
      };
    }

    // Spent. A code that proved presence once must not prove it again.
    await this.deps.challenges.consume(params.challengeId);

    await this.deps.audit.write({
      requestId: params.requestId,
      pseudoId: params.pseudoId,
      actorRole: 'user',
      serviceName: 'auth-service',
      actionType: 'auth.otp.verified',
      purpose: 'account-recovery',
      consentDecision: 'not_required',
      accessResult: 'allowed',
      context: { method: 'otp', record_kind: 'step_up', step_up_scope: params.scope },
    });

    return { ok: true, scope: params.scope };
  }

  async otpVerify(params: {
    challengeId: string;
    code: string;
    /** Random value the client generates once and keeps. Optional; see domain/devices.ts. */
    deviceKey?: string | undefined;
    /** Read for a coarse label and discarded. Never stored. */
    userAgent?: string | undefined;

    requestId: string;
    ipPrefix?: string | undefined;
  }): Promise<SignInOutcome> {
    const challenge = await this.deps.challenges.get(params.challengeId);
    if (challenge === undefined) return { ok: false, reason: 'authentication_failed' };

    const used = await this.deps.challenges.spendAttempt(params.challengeId);
    const outcome = verifyOtp(
      { ...challenge, attemptsUsed: used - 1 },
      params.code,
      'login',
      this.deps.otpPepper,
    );

    if (!outcome.ok) {
      await this.recordFailure(params.requestId, 'otp', outcome.reason, params.ipPrefix);
      return {
        ok: false,
        reason: outcome.reason === 'too_many_attempts' ? 'too_many_attempts' : 'authentication_failed',
        attemptsRemaining: outcome.attemptsRemaining,
      };
    }

    await this.deps.challenges.consume(params.challengeId);

    const account = await this.deps.accounts.findByMobileHash(
      Buffer.from(challenge.mobileLookupHash, 'hex'),
    );
    // No account for a number that just proved itself. Answered as an ordinary
    // authentication failure rather than "register instead", because the difference
    // would confirm to a caller that the number is unregistered.
    if (account === undefined) {
      await this.recordFailure(params.requestId, 'otp', 'no_account', params.ipPrefix);
      return { ok: false, reason: 'authentication_failed' };
    }
    if (account.status !== 'active') {
      await this.recordFailure(params.requestId, 'otp', 'account_not_active', params.ipPrefix);
      return { ok: false, reason: 'authentication_failed' };
    }

    return this.completeSignIn(account, 'otp', params.requestId, params.ipPrefix, {
      deviceKey: params.deviceKey,
      userAgent: params.userAgent,
    });
  }

  // ----------------------------------------------------------- recovery code ---

  /**
   * The last door: a handle and a recovery code, with no OTP.
   *
   * Deliberately independent of the phone number. OTP login already covers "I lost my
   * device"; this covers "I lost the number" — a new SIM, a stolen phone, a changed
   * operator — and requiring an OTP here would make it useless for the only case it
   * exists to serve.
   *
   * The handle is the identifier because it is the one thing a member in that
   * situation still knows and can type. That is what permanent handles bought.
   *
   * Single use, enforced by an atomic UPDATE rather than a read-then-write, so two
   * concurrent attempts cannot spend the same code twice.
   */
  async recoverWithCode(params: {
    handle: string;
    recoveryCode: string;
    /** Random value the client generates once and keeps. Optional; see domain/devices.ts. */
    deviceKey?: string | undefined;
    /** Read for a coarse label and discarded. Never stored. */
    userAgent?: string | undefined;

    requestId: string;
    ipPrefix?: string | undefined;
  }): Promise<SignInOutcome> {
    const gate = await this.deps.challenges.checkRecoveryGate(params.handle.toLowerCase());
    if (!gate.allowed) {
      return { ok: false, reason: 'rate_limited' };
    }
    await this.deps.challenges.recordRecoveryAttempt(params.handle.toLowerCase());

    const persona = await this.deps.pseudonyms.findByHandle(params.handle, params.requestId);
    if (persona === undefined) {
      await this.recordFailure(params.requestId, 'recovery_code', 'no_persona', params.ipPrefix);
      return { ok: false, reason: 'authentication_failed' };
    }

    const account = await this.deps.accounts.findByPseudoId(persona.pseudoId);
    if (account === undefined || account.status !== 'active') {
      await this.recordFailure(params.requestId, 'recovery_code', 'no_account', params.ipPrefix);
      return { ok: false, reason: 'authentication_failed' };
    }

    // Candidates are fetched and compared in constant time one by one. A SQL lookup
    // by hash would be faster, but the hash is deterministic and comparing in the
    // database would leak timing on a value a caller supplies.
    const candidates = await this.deps.accounts.listUnusedRecoveryCodes(account.id);
    const match = candidates.find((c) => recoveryCodeMatches(params.recoveryCode, c.codeHash));
    if (match === undefined) {
      await this.recordFailure(params.requestId, 'recovery_code', 'wrong_code', params.ipPrefix);
      return { ok: false, reason: 'authentication_failed' };
    }

    const consumed = await this.deps.accounts.consumeRecoveryCode(match.id);
    if (!consumed) {
      // Lost a race with a concurrent attempt. The code is spent either way.
      await this.recordFailure(params.requestId, 'recovery_code', 'already_used', params.ipPrefix);
      return { ok: false, reason: 'authentication_failed' };
    }

    await this.deps.audit.write({
      requestId: params.requestId,
      pseudoId: account.pseudoId,
      actorId: account.id,
      actorRole: 'user',
      serviceName: 'auth-service',
      actionType: 'auth.recovery_code.used',
      purpose: 'account-recovery',
      consentDecision: 'not_required',
      accessResult: 'allowed',
      context: { method: 'recovery_code', record_count: candidates.length - 1 },
    });

    const result = await this.completeSignIn(
      account,
      'recovery_code',
      params.requestId,
      params.ipPrefix,
      { deviceKey: params.deviceKey, userAgent: params.userAgent },
    );
    if (result.ok) {
      // Surfaced so the interface can warn before somebody runs out. A member who
      // burns their last code and has also lost their number has no way back in.
      return { ...result, recoveryCodesRemaining: candidates.length - 1 };
    }
    return result;
  }

  /**
   * Issue a fresh bundle, invalidating the previous one.
   *
   * Requires a live session — this is a logged-in action, not a recovery one. The
   * gateway enforces step-up on the route.
   */
  async regenerateRecoveryCodes(params: {
    pseudoId: number;
    requestId: string;
  }): Promise<{ ok: true; codes: string[] } | { ok: false; reason: string }> {
    const account = await this.deps.accounts.findByPseudoId(params.pseudoId);
    if (account === undefined) return { ok: false, reason: 'account_not_found' };

    const generation = await this.deps.accounts.currentBundleGeneration(account.id);
    const bundle = generateRecoveryCodes(generation + 1);
    await this.deps.accounts.replaceRecoveryCodes(account.id, bundle);

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

    return { ok: true, codes: bundle.plaintext };
  }

  // ----------------------------------------------------------------- shared ---

  private async completeSignIn(
    account: { id: string; pseudoId: number },
    method: 'otp' | 'recovery_code',
    requestId: string,
    ipPrefix: string | undefined,
    device: { deviceKey?: string | undefined; userAgent?: string | undefined } = {},
  ): Promise<SignInOutcome> {
    const persona = await this.deps.pseudonyms.createPersona(account.pseudoId, requestId);

    // Before the session, so the session can carry the device id. Never throws and
    // never blocks: a sign-in must not fail over device bookkeeping.
    const deviceId = await this.deps.devices.register({
      accountId: account.id,
      pseudoId: account.pseudoId,
      deviceKey: device.deviceKey,
      userAgent: device.userAgent,
      requestId,
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
      requestId,
      pseudoId: account.pseudoId,
      actorId: record.sessionId,
      actorRole: 'user',
      serviceName: 'auth-service',
      actionType: 'auth.session.minted',
      purpose: 'account-recovery',
      consentDecision: 'not_required',
      accessResult: 'allowed',
      context: { method },
    });
    await this.deps.accounts.recordLoginEvent({
      accountId: account.id,
      method,
      result: 'success',
      ipPrefix,
      userAgentHash: undefined,
    });

    return { ok: true, token, pseudoId: account.pseudoId, handle: persona.handle };
  }

  private async recordFailure(
    requestId: string,
    method: 'otp' | 'recovery_code',
    internal: string,
    ipPrefix: string | undefined,
  ): Promise<void> {
    this.deps.log.warn({ requestId, method, internal }, 'sign-in refused');
    await this.deps.audit.write({
      requestId,
      actorRole: 'system',
      serviceName: 'auth-service',
      actionType: method === 'otp' ? 'auth.otp.failed' : 'auth.recovery_code.failed',
      purpose: 'account-recovery',
      consentDecision: 'not_required',
      accessResult: 'denied',
      context: { method, denial_reason: internal },
    });
    await this.deps.accounts.recordLoginEvent({
      accountId: undefined,
      method,
      result: 'failure',
      ipPrefix,
      userAgentHash: undefined,
    });
  }
}
