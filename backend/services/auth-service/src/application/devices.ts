/**
 * Device management: the member's answer to "where am I signed in, and how do I stop
 * that one?"
 *
 * This is a safety feature before it is a convenience one. The person most likely to
 * be reading somebody's account without permission, on a platform like this, lives in
 * the same house and uses the same phone. Being able to see a session you do not
 * recognise and end it is the control that matters; everything else here exists to
 * make that list legible.
 *
 * What this does NOT do is let a device skip a login. See domain/devices.ts.
 */

import type { AuditClient } from '@alaap/audit-client';
import type { SessionStore } from '@alaap/session-store';

import {
  deviceHash,
  isWellFormedDeviceKey,
  labelForUserAgent,
  normaliseLabel,
  type DeviceLabelPolicy,
} from '../domain/devices.ts';
import type { AccountRepository } from '../infrastructure/accounts.ts';
import type { DeviceRepository, TrustedDevice } from '../infrastructure/devices.ts';

export interface DevicesDeps {
  devices: DeviceRepository;
  accounts: AccountRepository;
  sessions: SessionStore;
  audit: AuditClient;
  labels: DeviceLabelPolicy;
  devicePepper: string;
  log: { warn(o: object, m?: string): void };
}

export interface DeviceView extends TrustedDevice {
  /** True for the device the request came from, so the interface can say "this one". */
  current: boolean;
  /** Live sessions on this device right now. */
  activeSessions: number;
}

/**
 * The caller, as the gateway asserts it.
 *
 * pseudoId, not accountId. The gateway never sees an account id — it holds a pseudo
 * id and nothing else, which is the separation that stops a compromised gateway from
 * addressing the identity vault. auth-service owns `auth_accounts`, so it is the one
 * service that can resolve the two, and it does so on every request rather than
 * accepting an account id from anybody.
 */
export interface DeviceCaller {
  pseudoId: number;
  /** The device this request's own session is on, from the signed header. */
  currentDeviceId: string | undefined;
  requestId: string;
}

export type RevokeOutcome =
  | { ok: true; sessionsEnded: number }
  | { ok: false; reason: 'unknown_device' };

export class Devices {
  private readonly deps: DevicesDeps;

  constructor(deps: DevicesDeps) {
    this.deps = deps;
  }

  /**
   * Record a sign-in from this device, returning the id to attach to the session.
   *
   * Returns undefined when the client sent no device key, or sent a malformed one.
   * Both are non-fatal by design: a sign-in must never fail because of device
   * bookkeeping. The cost of a missing device key is a session that does not appear
   * in the member's device list, which is a degraded feature, not a broken login.
   *
   * A malformed key is logged, though. The shape is strict precisely so that a client
   * putting a phone number or an advertising id in this field gets refused rather
   * than silently storing an identifier in a column meant to hold noise.
   */
  async register(params: {
    accountId: string;
    pseudoId: number;
    deviceKey: string | undefined;
    userAgent: string | undefined;
    requestId: string;
  }): Promise<string | undefined> {
    if (params.deviceKey === undefined) return undefined;
    if (!isWellFormedDeviceKey(params.deviceKey)) {
      this.deps.log.warn({ requestId: params.requestId }, 'malformed device key ignored');
      return undefined;
    }

    const hash = deviceHash(params.accountId, params.deviceKey, this.deps.devicePepper);
    const label = labelForUserAgent(params.userAgent, this.deps.labels);

    try {
      const { device, isNew } = await this.deps.devices.seen({
        accountId: params.accountId,
        deviceHash: hash,
        defaultLabel: label,
      });

      if (isNew) {
        await this.deps.audit.write({
          requestId: params.requestId,
          pseudoId: params.pseudoId,
          actorId: params.accountId,
          actorRole: 'user',
          serviceName: 'auth-service',
          actionType: 'auth.device.registered',
          purpose: 'security-investigation',
          consentDecision: 'not_required',
          accessResult: 'allowed',
          // Never the label, the hash, or anything derived from the user-agent. That
          // this account gained a device is the fact worth keeping; which device it
          // was is not something the audit vault needs in order to be useful.
          context: { record_kind: 'device' },
        });
      }
      return device.id;
    } catch (cause) {
      // Degrade, never block. A device table that is briefly unwritable must not stop
      // somebody signing in — least of all somebody signing in because they are in
      // difficulty right now.
      this.deps.log.warn(
        { requestId: params.requestId, err: cause instanceof Error ? cause.message : cause },
        'could not record device; sign-in continues without it',
      );
      return undefined;
    }
  }

  /**
   * Resolve the caller's account.
   *
   * Every route below goes through here rather than trusting an account id from the
   * request. An account id in a request body is a route that renames, lists or signs
   * out somebody else's devices.
   */
  private async accountFor(pseudoId: number): Promise<string | undefined> {
    const account = await this.deps.accounts.findByPseudoId(pseudoId);
    return account?.id;
  }

  /** Where the account is signed in. */
  async list(caller: DeviceCaller): Promise<DeviceView[]> {
    const accountId = await this.accountFor(caller.pseudoId);
    if (accountId === undefined) return [];
    const params = { accountId, currentDeviceId: caller.currentDeviceId };
    const devices = await this.deps.devices.list(params.accountId, this.deps.labels.defaultLabel);
    const live = await this.deps.sessions.listForAccount(params.accountId);

    const counts = new Map<string, number>();
    for (const record of live) {
      if (record.deviceId === undefined) continue;
      counts.set(record.deviceId, (counts.get(record.deviceId) ?? 0) + 1);
    }

    return devices.map((d) => ({
      ...d,
      current: d.id === params.currentDeviceId,
      activeSessions: counts.get(d.id) ?? 0,
    }));
  }

  /**
   * Sign a device out.
   *
   * Two steps that must happen in this order: mark the device revoked, THEN end its
   * sessions. Reversed, a request arriving in the gap would re-extend a session on a
   * device the member has just signed out — the sliding window in SessionStore
   * refreshes on use, so the window is small but real.
   */
  async revoke(caller: DeviceCaller, deviceId: string): Promise<RevokeOutcome> {
    const accountId = await this.accountFor(caller.pseudoId);
    if (accountId === undefined) return { ok: false, reason: 'unknown_device' };
    const params = { accountId, pseudoId: caller.pseudoId, deviceId, requestId: caller.requestId };
    const revoked = await this.deps.devices.revoke(params.accountId, params.deviceId);
    if (!revoked) return { ok: false, reason: 'unknown_device' };

    const sessionsEnded = await this.deps.sessions.revokeAllForDevice(
      params.accountId,
      params.deviceId,
    );

    await this.deps.audit.write({
      requestId: params.requestId,
      pseudoId: params.pseudoId,
      actorId: params.accountId,
      actorRole: 'user',
      serviceName: 'auth-service',
      actionType: 'auth.device.revoked',
      purpose: 'security-investigation',
      consentDecision: 'not_required',
      accessResult: 'allowed',
      context: { record_kind: 'device', record_count: sessionsEnded },
    });

    return { ok: true, sessionsEnded };
  }

  /**
   * Sign out everywhere except here.
   *
   * The button somebody presses when they have just realised. It has to work without
   * them first working out WHICH of the listed devices is the problem — under that
   * kind of pressure, "end all the others" is the only instruction anyone can follow.
   */
  async revokeOthers(caller: DeviceCaller): Promise<{ devicesEnded: number; sessionsEnded: number }> {
    const accountId = await this.accountFor(caller.pseudoId);
    if (accountId === undefined) return { devicesEnded: 0, sessionsEnded: 0 };
    const params = {
      accountId,
      pseudoId: caller.pseudoId,
      currentDeviceId: caller.currentDeviceId,
      requestId: caller.requestId,
    };
    const ids = await this.deps.devices.revokeOthers(params.accountId, params.currentDeviceId);

    let sessionsEnded = 0;
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      sessionsEnded += await this.deps.sessions.revokeAllForDevice(params.accountId, id);
    }

    // Sessions carrying no device id at all — older ones, or clients that never sent
    // a key — would otherwise survive "sign out everywhere else", which would make
    // the button a lie. They are ended too unless they are this request's own.
    sessionsEnded += await this.deps.sessions.revokeDevicelessForAccount(params.accountId);

    await this.deps.audit.write({
      requestId: params.requestId,
      pseudoId: params.pseudoId,
      actorId: params.accountId,
      actorRole: 'user',
      serviceName: 'auth-service',
      actionType: 'auth.sessions.revoked_all',
      purpose: 'security-investigation',
      consentDecision: 'not_required',
      accessResult: 'allowed',
      context: { record_kind: 'device', record_count: sessionsEnded },
    });

    return { devicesEnded: ids.length, sessionsEnded };
  }

  /** Rename a device. The member's own note to themselves; nobody else sees it. */
  async rename(
    caller: DeviceCaller,
    deviceId: string,
    rawLabel: string,
  ): Promise<{ ok: true } | { ok: false; reason: 'invalid_label' | 'unknown_device' }> {
    const label = normaliseLabel(rawLabel);
    if (label === undefined) return { ok: false, reason: 'invalid_label' };

    const accountId = await this.accountFor(caller.pseudoId);
    if (accountId === undefined) return { ok: false, reason: 'unknown_device' };

    const renamed = await this.deps.devices.rename(accountId, deviceId, label);
    if (!renamed) return { ok: false, reason: 'unknown_device' };

    // No audit event. Renaming changes nothing about who can reach the account, and a
    // row per rename would be noise in a log whose value depends on being readable.
    return { ok: true };
  }
}
