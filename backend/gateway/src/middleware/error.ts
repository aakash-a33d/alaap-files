/**
 * Terminal error handler.
 *
 * The caller gets a code and a sentence. The `detail` field — which says *why* a
 * check failed — is logged and never sent, because a precise denial reason is a
 * probing oracle: "wrong role" and "no such route" must be indistinguishable from
 * outside, which is why the RBAC stage returns 404 rather than 403.
 */

import type { NextFunction, Request, Response } from 'express';

import { GatewayError } from '../types.ts';

export function errorHandler() {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const requestId = req.ctx?.requestId ?? 'unknown';

    if (err instanceof GatewayError) {
      req.log?.warn(
        { code: err.code, status: err.status, detail: err.detail, requestId },
        'request denied',
      );
      if (!res.headersSent) {
        res.status(err.status).json({
          error: { code: err.code, message: err.publicMessage, requestId },
        });
      }
      return;
    }

    req.log?.error(
      { err: err instanceof Error ? err.message : String(err), requestId },
      'unhandled gateway error',
    );

    if (!res.headersSent) {
      res.status(500).json({
        error: { code: 'internal_error', message: 'Something went wrong.', requestId },
      });
    }
  };
}

/** 404 for anything that fell through without matching a route policy. */
export function notFound() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    next(new GatewayError(404, 'unknown_route', 'Not found.', `unmatched ${req.path}`));
  };
}
