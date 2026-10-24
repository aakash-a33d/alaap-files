/**
 * Passkey registration and login.
 *
 * The cryptography is @simplewebauthn/server's. What is here is the orchestration and
 * the Alaap-specific policy: which challenge, whose account, what gets audited, and
 * what a failure is allowed to reveal.
 *
 * TWO FLOWS, DELIBERATELY ASYMMETRIC
 *
 *   register  requires an existing session. A passkey is added to an account, so
 *             there must already be an account and a way to prove it is yours. That
 *             is why /api/passkeys is `authentication: required` in the route policy
 *             while /api/auth is not.
 *
 *   login     requires nothing, and resolves the account FROM the assertion. With a
 *             discoverable credential the authenticator returns the user handle, so
 *             a member signs in without typing a phone number — which on a
 *             pseudonymous platform is a privacy property, not just convenience.
 */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { AuditClient } from '@alaap/audit-client';
import type { SessionStore } from '@alaap/session-store';
import type { SessionActorRole } from '@alaap/shared-types';
import { createHash, randomBytes } from 'node:crypto';

import {
  MAX_CREDENTIALS_PER_ACCOUNT,
  checkSignCount,
  credentialDisplayName,
  policyFor,
} from '../domain/passkey-policy.ts';
import type { Devices } from './devices.ts';
import type { AccountRepository } from '../infrastructure/accounts.ts';
import type { CredentialRepository } from '../infrastructure/credentials.ts';
import type { PseudonymClient } from '../infrastructure/pseudonym-client.ts';
import type { WebAuthnChallengeStore } from '../infrastructure/webauthn-challenges.ts';

export interface PasskeyDeps {
  devices: Devices;
  accounts: AccountRepository;
  credentials: CredentialRepository;
  challenges: WebAuthnChallengeStore;
  sessions: SessionStore;
  pseudonyms: PseudonymClient;
  audit: AuditClient;
  rpName: string;
  rpId: string;
  /** Exact origin the browser will send. A mismatch makes every credential unusable. */
  expectedOrigin: string;
  log: { info(o: object, m?: string): void; warn(o: object, m?: string): void };
}

export type RegisterStartOutcome =
  | { ok: true; challengeId: string; options: unknown }
  | { ok: false; reason: 'account_not_found' | 'too_many_credentials' };

export type RegisterFinishOutcome =
  | { ok: true; credentialId: string; label: string | null }
  | { ok: false; reason: string };

export type LoginFinishOutcome =
  | { ok: true; token: string; pseudoId: number; handle: string }
  | { ok: false; reason: string };

function newChallengeId(): string {
  return `wac_${randomBytes(16).toString('base64url')}`;
}

export class Passkeys {
  private readonly deps: PasskeyDeps;

  constructor(deps: PasskeyDeps) {
    this.deps = deps;
  }

  // ---------------------------------------------------------------- register ---

  /**
   * Takes the gateway's SIGNED pseudo_id, never an account id from a request body.
   * The handle is fetched from pseudonym-service rather than accepted from the
   * caller, so nothing a member types reaches their credential's display name.
   */
  async registerStart(
    pseudoId: number,
    actorRole: SessionActorRole,
    requestId: string,
  ): Promise<RegisterStartOutcome> {
    const account = await this.deps.accounts.findByPseudoId(pseudoId);
    if (account === undefined) return { ok: false, reason: 'account_not_found' };
    const accountId = account.id;
    const persona = await this.deps.pseudonyms.createPersona(pseudoId, requestId);
    const handle = persona.handle;

    const existing = await this.deps.credentials.listForAccount(accountId);
    if (existing.length >= MAX_CREDENTIALS_PER_ACCOUNT) {
      return { ok: false, reason: 'too_many_credentials' };
    }

    const policy = policyFor(actorRole);

    const options = await generateRegistrationOptions({
      rpName: this.deps.rpName,
      rpID: this.deps.rpId,
      // The account id, which is a UUID and identifies nothing. This value is sent to
      // the authenticator and may be synced into a cloud credential manager, so it
      // must never be the phone number or the pseudo id.
      userID: new Uint8Array(Buffer.from(accountId.replaceAll('-', ''), 'hex')),
      // What the OS passkey picker displays. The public handle — pseudonymous and
      // recognisable. Never anything from the identity vault.
      userName: credentialDisplayName(handle),
      userDisplayName: credentialDisplayName(handle),
      attestationType: policy.attestation,
      // Stops the same authenticator being enrolled twice, which would otherwise
      // produce a confusing duplicate in the member's device list.
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId.toString('base64url'),
        transports: c.transports as never,
      })),
      authenticatorSelection: {
        residentKey: policy.residentKey,
        userVerification: policy.userVerification,
      },
    });

    const challengeId = newChallengeId();
    await this.deps.challenges.put(challengeId, {
      challenge: options.challenge,
      intent: 'register',
      accountId,
      createdAt: new Date().toISOString(),
    });

    return { ok: true, challengeId, options };
  }

  async registerFinish(params: {
    challengeId: string;
    response: RegistrationResponseJSON;
    label?: string | undefined;
    actorRole: SessionActorRole;
    /** From the gateway's signed header. Resolved to an account id here. */
    sessionPseudoId: number;
    requestId: string;
  }): Promise<RegisterFinishOutcome> {
    // Consumed, not read — single use is enforced by the store so a caller cannot
    // leave a replayable challenge alive for its full TTL by forgetting to clean up.
    const stored = await this.deps.challenges.consume(params.challengeId);
    if (stored === undefined || stored.intent !== 'register') {
      return { ok: false, reason: 'challenge_not_found' };
    }
    // The session that finishes must be the account that started. Without this, a
    // challenge issued to one account could be completed by another.
    const session = await this.deps.accounts.findByPseudoId(params.sessionPseudoId);
    if (session === undefined || stored.accountId !== session.id) {
      this.deps.log.warn(
        { requestId: params.requestId },
        'passkey challenge completed by a different session',
      );
      return { ok: false, reason: 'challenge_not_found' };
    }

    const policy = policyFor(params.actorRole);

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: params.response,
        expectedChallenge: stored.challenge,
        expectedOrigin: this.deps.expectedOrigin,
        expectedRPID: this.deps.rpId,
        requireUserVerification: policy.userVerification === 'required',
      });
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? 'verification_failed' : 'unknown' };
    }

    if (!verification.verified || verification.registrationInfo === undefined) {
      return { ok: false, reason: 'verification_failed' };
    }

    const info = verification.registrationInfo;
    const credentialId = Buffer.from(info.credential.id, 'base64url');

    const created = await this.deps.credentials.create({
      accountId: stored.accountId,
      credentialId,
      publicKey: Buffer.from(info.credential.publicKey),
      signCount: info.credential.counter,
      transports: info.credential.transports ?? [],
      // All-zero aaguid means the authenticator declined to identify itself, which is
      // the normal and desirable case under attestation: 'none'.
      aaguid: info.aaguid === '00000000-0000-0000-0000-000000000000' ? null : info.aaguid,
      backupEligible: info.credentialDeviceType === 'multiDevice',
      backupState: info.credentialBackedUp,
      label: params.label ?? null,
    });

    await this.deps.audit.write({
      requestId: params.requestId,
      actorId: stored.accountId,
      actorRole: params.actorRole,
      serviceName: 'auth-service',
      actionType: 'auth.passkey.registered',
      purpose: 'account-recovery',
      consentDecision: 'not_required',
      accessResult: 'allowed',
      context: { method: 'passkey' },
    });

    return { ok: true, credentialId: created.id, label: created.label };
  }

  // ------------------------------------------------------------------- login ---

  /**
   * Begin a usernameless login.
   *
   * `allowCredentials` is deliberately empty. Sending a list would require knowing
   * who is logging in before they have proved it — which means asking for a phone
   * number, which is the disclosure passkeys let us avoid. An empty list also means
   * the response reveals nothing about which accounts exist.
   */
  async loginStart(): Promise<{ challengeId: string; options: unknown }> {
    const options = await generateAuthenticationOptions({
      rpID: this.deps.rpId,
      allowCredentials: [],
      userVerification: 'preferred',
    });

    const challengeId = newChallengeId();
    await this.deps.challenges.put(challengeId, {
      challenge: options.challenge,
      intent: 'login',
      createdAt: new Date().toISOString(),
    });

    return { challengeId, options };
  }

  async loginFinish(params: {
    challengeId: string;
    response: AuthenticationResponseJSON;
    /** Random value the client generates once and keeps. Optional; see domain/devices.ts. */
    deviceKey?: string | undefined;
    /** Read for a coarse label and discarded. Never stored. */
    userAgent?: string | undefined;

    requestId: string;
    ipPrefix?: string | undefined;
  }): Promise<LoginFinishOutcome> {
    // Every failure below returns the same opaque reason to the caller. A login
    // endpoint that distinguishes "no such credential" from "wrong signature" is an
    // enumeration oracle.
    const fail = async (internal: string): Promise<LoginFinishOutcome> => {
      this.deps.log.warn({ requestId: params.requestId, internal }, 'passkey login refused');
      await this.deps.accounts.recordLoginEvent({
        accountId: undefined,
        method: 'passkey',
        result: 'failure',
        ipPrefix: params.ipPrefix,
        userAgentHash: undefined,
      });
      return { ok: false, reason: 'authentication_failed' };
    };

    const stored = await this.deps.challenges.consume(params.challengeId);
    if (stored === undefined || stored.intent !== 'login') return fail('challenge_not_found');

    const credentialId = Buffer.from(params.response.id, 'base64url');
    const credential = await this.deps.credentials.findByCredentialId(credentialId);
    if (credential === undefined) return fail('unknown_credential');
    if (credential.revokedAt !== null) return fail('credential_revoked');

    // The authenticator returns the user handle it was given at registration. It must
    // agree with the credential's own account — a mismatch means one of the two was
    // tampered with.
    const userHandle = params.response.response.userHandle;
    if (userHandle !== undefined && userHandle !== null) {
      const claimed = Buffer.from(userHandle, 'base64url').toString('hex');
      if (claimed !== credential.accountId.replaceAll('-', '')) {
        return fail('user_handle_mismatch');
      }
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: params.response,
        expectedChallenge: stored.challenge,
        expectedOrigin: this.deps.expectedOrigin,
        expectedRPID: this.deps.rpId,
        credential: {
          id: credential.credentialId.toString('base64url'),
          publicKey: new Uint8Array(credential.publicKey),
          counter: credential.signCount,
          transports: credential.transports as never,
        },
        requireUserVerification: false,
      });
    } catch {
      return fail('verification_threw');
    }

    if (!verification.verified) return fail('verification_failed');

    // Clone detection. A counter that goes backwards means either a cloned
    // authenticator or a replayed assertion, and both are refusals.
    const clone = checkSignCount(credential.signCount, verification.authenticationInfo.newCounter);
    if (!clone.ok) {
      this.deps.log.warn(
        {
          requestId: params.requestId,
          stored: credential.signCount,
          presented: verification.authenticationInfo.newCounter,
        },
        'signature counter regressed — possible cloned authenticator',
      );
      await this.deps.audit.write({
        requestId: params.requestId,
        actorId: credential.accountId,
        actorRole: 'system',
        serviceName: 'auth-service',
        actionType: 'auth.passkey.revoked',
        purpose: 'security-investigation',
        consentDecision: 'not_required',
        accessResult: 'denied',
        context: { method: 'passkey', denial_reason: clone.reason },
      });
      return fail('counter_regressed');
    }

    const account = await this.deps.accounts.findById(credential.accountId);
    if (account === undefined) return fail('account_missing');
    if (account.status !== 'active') return fail('account_not_active');

    await this.deps.credentials.recordUse(
      credential.id,
      verification.authenticationInfo.newCounter,
    );

    const persona = await this.deps.pseudonyms.createPersona(account.pseudoId, params.requestId);

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
      context: { method: 'passkey' },
    });
    await this.deps.accounts.recordLoginEvent({
      accountId: account.id,
      method: 'passkey',
      result: 'success',
      ipPrefix: params.ipPrefix,
      userAgentHash: undefined,
    });

    return { ok: true, token, pseudoId: account.pseudoId, handle: persona.handle };
  }
}
