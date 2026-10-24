/**
 * Route resolution.
 *
 * Longest-prefix match over the groups loaded from metadata. There is no route table
 * in code — if a path does not resolve to a declared group, the gateway does not
 * know what policy applies to it and therefore refuses it.
 *
 * Absence is denial. This mirrors the vault access matrix convention: a service with
 * no entry gets no access, never default-allow.
 */

import type { NextFunction, Request, Response } from 'express';

import { GatewayError, type ApiGroup } from '../types.ts';

export class RouteTable {
  /** Sorted longest-prefix-first so `/api/moderator` cannot be shadowed. */
  private readonly ordered: ApiGroup[];

  constructor(groups: ApiGroup[]) {
    this.ordered = [...groups].sort((a, b) => b.prefix.length - a.prefix.length);
  }

  resolve(path: string): ApiGroup | undefined {
    return this.ordered.find(
      (g) => path === g.prefix || path.startsWith(`${g.prefix}/`) || path.startsWith(`${g.prefix}?`),
    );
  }
}

/**
 * The path the policy is keyed on.
 *
 * `req.path` is relative to the mount point, so inside `app.use('/api', ...)` the
 * request for `/api/community/feed` arrives with `req.path === '/community/feed'`
 * and every `/api/...` prefix silently fails to match — a 404 on every route, which
 * is at least a safe failure but a total one. Rejoining `baseUrl` restores the
 * absolute path and keeps this correct at any mount point.
 */
export function fullPath(req: Pick<Request, 'baseUrl' | 'path'>): string {
  return `${req.baseUrl}${req.path}` || '/';
}

export function resolveRoute(table: RouteTable) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const group = table.resolve(fullPath(req));
    if (group === undefined) {
      next(
        new GatewayError(
          404,
          'unknown_route',
          'Not found.',
          `no api-group policy matches ${fullPath(req)}`,
        ),
      );
      return;
    }
    req.ctx.group = group;
    if (group.purpose !== undefined) req.ctx.purpose = group.purpose;
    next();
  };
}
