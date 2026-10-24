/**
 * Talking to the services that actually hold the data.
 *
 * Every call is signed with the same HMAC contract the gateway uses, and lands on an
 * `/internal/` route with no gateway path — reachable from inside the network and from
 * nowhere else. That is the whole mechanism by which this service deletes five vaults
 * while holding a credential for none of them.
 */

import { sign, SIGNATURE_HEADER, type ServiceAuthHeaders } from '@alaap/service-auth';

export interface PurgeResult {
  purged: number;
  held: number;
  detail: string[];
}

export class PurgeClient {
  private readonly secret: string;
  private readonly timeoutMs: number;

  /**
   * 30 seconds, not the usual 10.
   *
   * A purge is one transaction over every row a member ever wrote, and an export
   * decrypts every journal entry one key operation at a time. Both are legitimately
   * slower than a request somebody is waiting on — and a timeout here does not fail
   * safe, it leaves the deletion half done, so the budget is generous on purpose.
   */
  constructor(secret: string, timeoutMs = 30_000) {
    this.secret = secret;
    this.timeoutMs = timeoutMs;
  }

  private headers(requestId: string): Record<string, string> {
    const signable: ServiceAuthHeaders = {
      'x-alaap-request-id': requestId,
      'x-alaap-actor-role': 'service',
      // Registered in the purpose registry. The vault being opened is being emptied,
      // and the purpose recorded against it should say so rather than borrowing one.
      'x-alaap-purpose': 'data-deletion',
      'x-alaap-issued-at': new Date().toISOString(),
    };
    return {
      'content-type': 'application/json',
      ...(signable as Record<string, string>),
      [SIGNATURE_HEADER]: sign(signable, this.secret),
    };
  }

  private async call<T>(
    baseUrl: string,
    path: string,
    pseudoId: number,
    requestId: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL(path, baseUrl), {
        method: 'POST',
        headers: this.headers(requestId),
        body: JSON.stringify({ pseudoId }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`${path} returned ${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async purge(baseUrl: string, pseudoId: number, requestId: string): Promise<PurgeResult> {
    const body = await this.call<Partial<PurgeResult>>(
      baseUrl,
      '/internal/purge',
      pseudoId,
      requestId,
    );
    return {
      purged: body.purged ?? 0,
      held: body.held ?? 0,
      detail: body.detail ?? [],
    };
  }

  async exportFrom(baseUrl: string, pseudoId: number, requestId: string): Promise<unknown> {
    const body = await this.call<{ data?: unknown }>(
      baseUrl,
      '/internal/export',
      pseudoId,
      requestId,
    );
    // Some services answer `{ data }` and the vault services answer their own shape.
    // Both are passed through unchanged — this service assembles the export, it does
    // not reinterpret what a vault said about itself.
    return 'data' in body ? body.data : body;
  }
}
