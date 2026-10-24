/* ============================================================================
   The one way this application talks to a server.

   Every request goes to the Privacy Gateway. Not to a service, and not to the
   AI tier — architecture §8.1 is that the browser never reaches the AI tier at
   all, because authentication, purpose limitation, consent, rate limiting,
   minimisation and the audit trail all live at the gateway. A browser that can
   reach a service directly bypasses six controls at once, and the audit vault
   which is supposed to answer "who asked what, when" would hold no row for it.

   There is no base URL to configure. Requests are same-origin: in development
   Vite proxies /api to the gateway, and in deployment the gateway fronts the
   app. That is what makes the session cookie work without CORS, SameSite=None,
   or a credentials allow-list — three things that would each be a weaker
   policy than the one production needs.

   NO TOKEN PASSES THROUGH HERE.

   The session is an HttpOnly cookie the gateway sets and the browser attaches.
   This file cannot read it, and that is the design: an opaque session token is
   not a claim about who somebody is, it IS the session, so anything that can
   read it holds the account. `credentials: 'same-origin'` is the whole of the
   client's involvement.
   ========================================================================= */

import { ApiError, NetworkError } from './errors'

export type Query = Record<string, string | number | boolean | undefined>

function withQuery(path: string, query?: Query): string {
  if (query === undefined) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

type RequestOptions = {
  query?: Query
  signal?: AbortSignal
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetch(withQuery(path, options.query), {
      method,
      // Same-origin, so the gateway's cookie is attached and nothing else is.
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (cause) {
    // An aborted request is a cancelled keystroke or an unmounted component, not
    // a failure. Rethrown as-is so callers can ignore it instead of showing an
    // offline state for something they cancelled themselves.
    if ((cause as Error)?.name === 'AbortError') throw cause
    throw new NetworkError(cause)
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = {}
  }

  if (!res.ok) {
    // The gateway and every service shape errors as { error: { code, message, ... } }.
    // Anything else is a proxy or a crash, and gets the status with no invented code.
    const envelope = (parsed as { error?: Record<string, unknown> }).error
    const { code, message, ...detail } = envelope ?? {}
    throw new ApiError(
      res.status,
      typeof code === 'string' ? code : 'unknown',
      typeof message === 'string' ? message : `request failed (${res.status})`,
      detail,
    )
  }

  return parsed as T
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body ?? {}, options),
  del: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, undefined, options),
}
