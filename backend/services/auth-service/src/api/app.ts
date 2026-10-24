/**
 * HTTP surface. Handlers validate, delegate and shape a response.
 *
 * /api/auth is declared `authentication: none` in the route policy, because this is
 * where a session comes from. That does NOT mean unauthenticated in the sense of
 * unprotected: every route still requires a valid gateway signature, so a caller
 * cannot reach this port directly and mint themselves a session.
 */

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { verifyRequest, type VerifiedCaller } from '@alaap/service-auth';
import { z } from 'zod';

import type { SessionStore } from '@alaap/session-store';
import type { AccountRepository } from '../infrastructure/accounts.ts';
import type { DeviceCaller, Devices } from '../application/devices.ts';
import type { Login } from '../application/login.ts';
import type { Passkeys } from '../application/passkeys.ts';
import type { Registration } from '../application/register.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      caller?: VerifiedCaller;
    }
  }
}

export interface AppDeps {
  registration: Registration;
  passkeys: Passkeys;
  login: Login;
  devices: Devices;
  /** Export and purge for core. Reached only by retention-service. */
  accounts: AccountRepository;
  /** Needed so a purge can end live sessions, which live in Redis rather than core. */
  sessions: SessionStore;
  serviceAuthSecret: string;
  log: {
    info(o: object, m?: string): void;
    warn(o: object, m?: string): void;
    error(o: object, m?: string): void;
  };
}

function requireGateway(secret: string, log: AppDeps['log']) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const outcome = verifyRequest(req.headers, secret);
    if (!outcome.ok) {
      log.warn({ reason: outcome.reason, path: req.path }, 'rejected unsigned request');
      res.status(401).json({ error: { code: 'service_auth_required' } });
      return;
    }
    req.caller = outcome.caller;
    next();
  };
}

const StartBody = z.object({
  mobile: z.string().min(6).max(20),
});

// Neither passkey body carries an accountId. It is derived from the gateway's signed
// pseudo_id — see AccountRepository.findByPseudoId for why that distinction is the
// difference between enrolling your own passkey and enrolling one on someone else's
// account. register/start therefore takes no body at all.
const PasskeyFinishBody = z.object({
  challengeId: z.string().min(8).max(64),
  response: z.record(z.string(), z.unknown()),
  label: z.string().min(1).max(60).optional(),
});

/**
 * A device key, when the client has one.
 *
 * Optional everywhere. A sign-in must never fail because device bookkeeping did, so
 * a missing or malformed key costs a row in the member's device list and nothing
 * else. The length is fixed because the value is meant to be 32 random bytes and
 * nothing else — a client putting a phone number or an advertising id in this field
 * is refused rather than quietly storing an identifier where noise belongs.
 */
const DeviceKey = z.string().length(43).optional();

const DeviceIdBody = z.object({ deviceId: z.string().uuid() });

const RenameDeviceBody = z.object({
  deviceId: z.string().uuid(),
  label: z.string().min(1).max(40),
});

const OtpLoginStartBody = z.object({ mobile: z.string().min(6).max(20) });

const OtpLoginVerifyBody = z.object({
  challengeId: z.string().min(8).max(64),
  code: z.string().regex(/^\d{6}$/),
  deviceKey: DeviceKey,
});

const RecoverBody = z.object({
  // The handle IS the username. It is what a member still knows when the phone
  // number is gone, which is the only situation this route exists for.
  handle: z.string().min(3).max(40),
  recoveryCode: z.string().min(8).max(24),
  deviceKey: DeviceKey,
});

const LoginFinishBody = z.object({
  challengeId: z.string().min(8).max(64),
  response: z.record(z.string(), z.unknown()),
  deviceKey: DeviceKey,
});

const VerifyBody = z.object({
  deviceKey: DeviceKey,
  challengeId: z.string().min(8).max(64),
  code: z.string().regex(/^\d{6}$/),
  preferredLanguage: z.string().min(2).max(12).default('en'),
  ageConfirmed: z.boolean(),
  country: z.string().length(2).optional(),
});

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const gated = requireGateway(deps.serviceAuthSecret, deps.log);

  /**
   * Begin registration. Issues an OTP.
   *
   * Responds identically whether or not an account already exists for the number.
   * A differing response would make this an account-enumeration oracle, and a phone
   * number space is small enough to walk.
   */
  app.post('/api/auth/register/start', gated, async (req, res, next) => {
    try {
      const parsed = StartBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }

      const requestId = req.caller?.requestId ?? crypto.randomUUID();
      const outcome = await deps.registration.start(parsed.data.mobile, requestId);

      if (!outcome.ok) {
        if (outcome.reason === 'rate_limited') {
          res.setHeader('retry-after', String(outcome.retryAfterSeconds));
          res.status(429).json({ error: { code: 'rate_limited' } });
          return;
        }
        res.status(400).json({ error: { code: outcome.reason } });
        return;
      }

      res.status(202).json({
        challengeId: outcome.challengeId,
        expiresInSeconds: outcome.expiresInSeconds,
        // Development convenience only; env.ts refuses the `log` transport in
        // production, so this key cannot appear in a deployed response.
        ...(outcome.devCode !== undefined ? { devCode: outcome.devCode } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  /** Complete registration. Verifies the OTP and returns a session token. */
  app.post('/api/auth/register/verify', gated, async (req, res, next) => {
    try {
      const parsed = VerifyBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }

      const requestId = req.caller?.requestId ?? crypto.randomUUID();
      const outcome = await deps.registration.verify({
        ...parsed.data,
        requestId,
        userAgent: req.headers['user-agent'],
      });

      if (!outcome.ok) {
        const status = outcome.reason === 'too_many_attempts' ? 429 : 400;
        res.status(status).json({
          error: {
            code: outcome.reason,
            ...(outcome.attemptsRemaining !== undefined
              ? { attemptsRemaining: Math.max(0, outcome.attemptsRemaining) }
              : {}),
          },
        });
        return;
      }

      res.status(201).json({
        token: outcome.token,
        pseudoId: outcome.pseudoId,
        handle: outcome.handle,
        isNewAccount: outcome.isNewAccount,
        // Shown exactly once, at account creation. Never retrievable afterwards —
        // regenerating a bundle invalidates the previous one.
        ...(outcome.recoveryCodes !== undefined
          ? { recoveryCodes: outcome.recoveryCodes }
          : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------- passkeys ---
  //
  // Registration requires a session; login does not and resolves the account FROM
  // the assertion. That asymmetry is why /api/passkeys is `authentication: required`
  // in the route policy while /api/auth is not.

  app.post('/api/passkeys/register/start', gated, async (req, res, next) => {
    try {
      const pseudoId = req.caller?.pseudoId;
      if (pseudoId === undefined) {
        res.status(401).json({ error: { code: 'no_session' } });
        return;
      }
      const outcome = await deps.passkeys.registerStart(
        pseudoId,
        (req.caller?.actorRole as never) ?? 'user',
        req.caller?.requestId ?? crypto.randomUUID(),
      );
      if (!outcome.ok) {
        res.status(outcome.reason === 'too_many_credentials' ? 409 : 404)
          .json({ error: { code: outcome.reason } });
        return;
      }
      res.status(200).json({ challengeId: outcome.challengeId, options: outcome.options });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/passkeys/register/finish', gated, async (req, res, next) => {
    try {
      const parsed = PasskeyFinishBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      const pseudoId = req.caller?.pseudoId;
      if (pseudoId === undefined) {
        res.status(401).json({ error: { code: 'no_session' } });
        return;
      }
      const outcome = await deps.passkeys.registerFinish({
        challengeId: parsed.data.challengeId,
        response: parsed.data.response as never,
        label: parsed.data.label,
        actorRole: (req.caller?.actorRole as never) ?? 'user',
        sessionPseudoId: pseudoId,
        requestId: req.caller?.requestId ?? crypto.randomUUID(),
      });
      if (!outcome.ok) {
        res.status(400).json({ error: { code: outcome.reason } });
        return;
      }
      res.status(201).json({ credentialId: outcome.credentialId, label: outcome.label });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Begin a usernameless login. Requires no session and no phone number — the
   * authenticator will tell us who this is.
   */
  app.post('/api/auth/login/start', gated, async (_req, res, next) => {
    try {
      const { challengeId, options } = await deps.passkeys.loginStart();
      res.status(200).json({ challengeId, options });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/login/finish', gated, async (req, res, next) => {
    try {
      const parsed = LoginFinishBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      const outcome = await deps.passkeys.loginFinish({
        challengeId: parsed.data.challengeId,
        response: parsed.data.response as never,
        requestId: req.caller?.requestId ?? crypto.randomUUID(),
        deviceKey: parsed.data.deviceKey,
        userAgent: req.headers['user-agent'],
      });
      if (!outcome.ok) {
        // One opaque reason for every cause. Distinguishing "no such credential"
        // from "wrong signature" would make this an enumeration oracle.
        res.status(401).json({ error: { code: outcome.reason } });
        return;
      }
      res.status(200).json({
        token: outcome.token,
        pseudoId: outcome.pseudoId,
        handle: outcome.handle,
      });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------ OTP sign-in ---
  //
  // For a member who still has the number but not the device.

  app.post('/api/auth/login/otp/start', gated, async (req, res, next) => {
    try {
      const parsed = OtpLoginStartBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      const outcome = await deps.login.otpStart(
        parsed.data.mobile,
        req.caller?.requestId ?? crypto.randomUUID(),
      );
      if (!outcome.ok) {
        if (outcome.reason === 'rate_limited') {
          res.setHeader('retry-after', String(outcome.retryAfterSeconds));
          res.status(429).json({ error: { code: 'rate_limited' } });
          return;
        }
        res.status(400).json({ error: { code: outcome.reason } });
        return;
      }
      res.status(202).json({
        challengeId: outcome.challengeId,
        expiresInSeconds: outcome.expiresInSeconds,
        ...(outcome.devCode !== undefined ? { devCode: outcome.devCode } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/login/otp/verify', gated, async (req, res, next) => {
    try {
      const parsed = OtpLoginVerifyBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      const outcome = await deps.login.otpVerify({
        ...parsed.data,
        requestId: req.caller?.requestId ?? crypto.randomUUID(),
        userAgent: req.headers['user-agent'],
      });
      if (!outcome.ok) {
        res.status(outcome.reason === 'too_many_attempts' ? 429 : 401).json({
          error: {
            code: outcome.reason,
            ...(outcome.attemptsRemaining !== undefined
              ? { attemptsRemaining: Math.max(0, outcome.attemptsRemaining) }
              : {}),
          },
        });
        return;
      }
      res.status(200).json({
        token: outcome.token,
        pseudoId: outcome.pseudoId,
        handle: outcome.handle,
      });
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------- recovery codes ---
  //
  // The last door. Works when the number itself is gone, so it asks for nothing the
  // platform would have to send.

  app.post('/api/auth/recover', gated, async (req, res, next) => {
    try {
      const parsed = RecoverBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      const outcome = await deps.login.recoverWithCode({
        ...parsed.data,
        requestId: req.caller?.requestId ?? crypto.randomUUID(),
        userAgent: req.headers['user-agent'],
      });
      if (!outcome.ok) {
        res
          .status(outcome.reason === 'rate_limited' ? 429 : 401)
          .json({ error: { code: outcome.reason } });
        return;
      }
      res.status(200).json({
        token: outcome.token,
        pseudoId: outcome.pseudoId,
        handle: outcome.handle,
        // Surfaced so the interface can warn before somebody runs out. A member with
        // no codes left and no number has no way back in.
        recoveryCodesRemaining: outcome.recoveryCodesRemaining,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Issue a fresh bundle, invalidating the previous one.
   *
   * Under /api/account rather than /api/auth because it requires a live session, and
   * /api/auth is the group that cannot require one. The pseudo id comes from the
   * gateway's signed header, never from the body — the same rule the passkey
   * enrolment routes follow, and for the same reason.
   */
  /**
   * Prove, again, that it is you.
   *
   * Under /api/account and not /api/auth, for the reason stated in the route policy:
   * /api/auth is where a session comes FROM and is unauthenticated, so the gateway
   * resolves no session for it and a route there would receive no caller at all.
   * Step-up is raised by somebody already signed in, so it belongs here.
   *
   * The scope travels in the body and is echoed back on success. auth-service does
   * not decide what it unlocks — the gateway checks the scope against the route
   * policy and refuses any that does not name a group actually asking for step-up.
   */
  const StepUpStartBody = z.object({
    scope: z.string().regex(/^\/api\/[a-z0-9]+(-[a-z0-9]+)*$/),
  });


  // -------------------------------------------------------------- internal ---
  //
  // retention-service calls these. They have no gateway route and never will: a member
  // must not be able to ask one vault to purge anybody, including themselves, because a
  // deletion is a whole-platform act that a single vault cannot decide. Authenticated by
  // the service-auth signature like every other internal call; the pseudonym comes from
  // the body rather than the session, because retention-service acts FOR a member rather
  // than AS one.

  const PurgeBody = z.object({ pseudoId: z.number().int().positive() });

  app.post('/internal/purge', gated, async (req, res, next) => {
    try {
      const parsed = PurgeBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      res.status(200).json(
        await deps.accounts.purge(parsed.data.pseudoId, (accountId) =>
          deps.sessions.revokeAllForAccount(accountId),
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  app.post('/internal/export', gated, async (req, res, next) => {
    try {
      const parsed = PurgeBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      res.status(200).json({ data: await deps.accounts.exportFor(parsed.data.pseudoId) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/account/step-up/start', gated, async (req, res, next) => {
    try {
      const pseudoId = req.caller?.pseudoId;
      if (pseudoId === undefined) {
        res.status(401).json({ error: { code: 'no_session' } });
        return;
      }
      const parsed = StepUpStartBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      const outcome = await deps.login.stepUpStart({
        pseudoId,
        scope: parsed.data.scope,
        requestId: req.caller?.requestId ?? crypto.randomUUID(),
      });
      if (!outcome.ok) {
        if (outcome.reason === 'rate_limited') {
          res.setHeader('retry-after', String(outcome.retryAfterSeconds));
          res.status(429).json({ error: { code: 'rate_limited' } });
          return;
        }
        res.status(404).json({ error: { code: outcome.reason } });
        return;
      }
      res.status(202).json({
        challengeId: outcome.challengeId,
        expiresInSeconds: outcome.expiresInSeconds,
        ...(outcome.devCode !== undefined ? { devCode: outcome.devCode } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  const StepUpVerifyBody = z.object({
    challengeId: z.string().min(1).max(120),
    code: z.string().regex(/^\d{6}$/),
    scope: z.string().regex(/^\/api\/[a-z0-9]+(-[a-z0-9]+)*$/),
  });

  /**
   * On success this answers `{ steppedUp: true, scope }` and nothing else.
   *
   * No token, deliberately. A second factor that hands back a credential is a second
   * way in rather than a check on the way already taken. The gateway reads this
   * answer on its way past and stamps the live session — it is the only component
   * that can, since the proxy strips the token before anything reaches here.
   */
  app.post('/api/account/step-up/verify', gated, async (req, res, next) => {
    try {
      const pseudoId = req.caller?.pseudoId;
      if (pseudoId === undefined) {
        res.status(401).json({ error: { code: 'no_session' } });
        return;
      }
      const parsed = StepUpVerifyBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      const outcome = await deps.login.stepUpVerify({
        pseudoId,
        challengeId: parsed.data.challengeId,
        code: parsed.data.code,
        scope: parsed.data.scope,
        requestId: req.caller?.requestId ?? crypto.randomUUID(),
      });
      if (!outcome.ok) {
        res.status(401).json({
          error: {
            code: outcome.reason,
            ...(outcome.attemptsRemaining !== undefined
              ? { attemptsRemaining: outcome.attemptsRemaining }
              : {}),
          },
        });
        return;
      }
      res.status(200).json({ steppedUp: true, scope: outcome.scope });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/account/recovery-codes/regenerate', gated, async (req, res, next) => {
    try {
      const pseudoId = req.caller?.pseudoId;
      if (pseudoId === undefined) {
        res.status(401).json({ error: { code: 'no_session' } });
        return;
      }
      const outcome = await deps.login.regenerateRecoveryCodes({
        pseudoId,
        requestId: req.caller?.requestId ?? crypto.randomUUID(),
      });
      if (!outcome.ok) {
        res.status(404).json({ error: { code: outcome.reason } });
        return;
      }
      res.status(201).json({ recoveryCodes: outcome.codes });
    } catch (err) {
      next(err);
    }
  });

  /**
   * The caller, from the gateway's signed headers and nowhere else.
   *
   * Both fields matter. `pseudoId` is whose devices these are — taken from the body it
   * would be a route for listing and signing out a stranger's. `deviceId` is which
   * device this request is on, which is what lets "sign out everywhere else" keep the
   * right one; a client able to set it could spare its own session from that action.
   */
  function deviceCaller(req: Request, res: Response): DeviceCaller | undefined {
    const pseudoId = req.caller?.pseudoId;
    if (pseudoId === undefined) {
      res.status(401).json({ error: { code: 'no_session' } });
      return undefined;
    }
    return {
      pseudoId,
      currentDeviceId: req.caller?.deviceId,
      requestId: req.caller?.requestId ?? crypto.randomUUID(),
    };
  }

  // --------------------------------------------------------------- devices ---
  //
  // "Where am I signed in, and how do I stop that one?"
  //
  // A safety feature before a convenience one. On this platform the person reading
  // somebody's account without permission is more often in the same house than on
  // the other side of the world, so seeing an unfamiliar session and ending it is the
  // control that matters. A device grants nothing and skips no login — see
  // domain/devices.ts.
  //
  // Under /api/account because every route here needs a live session, and /api/auth
  // is the group that cannot require one.

  app.get('/api/account/devices', gated, async (req, res, next) => {
    try {
      const caller = deviceCaller(req, res);
      if (caller === undefined) return;
      res.status(200).json({ devices: await deps.devices.list(caller) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/account/devices/revoke', gated, async (req, res, next) => {
    try {
      const caller = deviceCaller(req, res);
      if (caller === undefined) return;
      const parsed = DeviceIdBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      const outcome = await deps.devices.revoke(caller, parsed.data.deviceId);
      if (!outcome.ok) {
        // The same 404 for an unknown device, somebody else's device, and one already
        // revoked. Distinguishing them would confirm whether a given device id exists.
        res.status(404).json({ error: { code: 'unknown_device' } });
        return;
      }
      res.status(200).json({ sessionsEnded: outcome.sessionsEnded });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Sign out everywhere else.
   *
   * The button somebody presses when they have just realised. It has to work without
   * them first working out WHICH device is the problem.
   */
  app.post('/api/account/devices/revoke-others', gated, async (req, res, next) => {
    try {
      const caller = deviceCaller(req, res);
      if (caller === undefined) return;
      res.status(200).json(await deps.devices.revokeOthers(caller));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/account/devices/rename', gated, async (req, res, next) => {
    try {
      const caller = deviceCaller(req, res);
      if (caller === undefined) return;
      const parsed = RenameDeviceBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      const outcome = await deps.devices.rename(caller, parsed.data.deviceId, parsed.data.label);
      if (!outcome.ok) {
        res
          .status(outcome.reason === 'invalid_label' ? 422 : 404)
          .json({ error: { code: outcome.reason } });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'not_found' } });
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    deps.log.error(
      { err: err instanceof Error ? err.message : String(err), requestId: req.caller?.requestId },
      'unhandled error',
    );
    if (!res.headersSent) {
      res.status(500).json({ error: { code: 'internal_error' } });
    }
  });

  return app;
}
