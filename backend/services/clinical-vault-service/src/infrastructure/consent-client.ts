/**
 * Asks consent-service whether processing is permitted.
 *
 * The two services are split by the grants, and the split runs both ways:
 * clinical-vault-service has no write on `consent_records`, so it cannot grant itself
 * permission to store what it stores; consent-service has no read on
 * `journal_entries`, so the service deciding permission cannot see the content it is
 * deciding about.
 *
 * That is why this is a network call and not a table read.
 */

import { sign, SIGNATURE_HEADER, type ServiceAuthHeaders } from '@alaap/service-auth';

export class ConsentClient {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, secret: string, timeoutMs = 5_000) {
    this.baseUrl = baseUrl;
    this.secret = secret;
    this.timeoutMs = timeoutMs;
  }

  /**
   * May this member's content be processed for this purpose?
   *
   * FAILS CLOSED. If consent-service cannot be reached, the answer is no.
   *
   * That is the opposite of the choice made for device bookkeeping at sign-in, and
   * deliberately so. Writing a clinical record without being able to confirm consent
   * is storing somebody's private words under a permission nobody verified — and the
   * cost of being wrong lands on them, permanently, whereas the cost of failing closed
   * is that they are asked to try again.
   */
  async allows(params: {
    pseudoId: number;
    purpose: string;
    requestId: string;
  }): Promise<boolean> {
    const headers: ServiceAuthHeaders = {
      'x-alaap-request-id': params.requestId,
      'x-alaap-actor-role': 'service',
      'x-alaap-purpose': params.purpose,
      'x-alaap-issued-at': new Date().toISOString(),
      'x-alaap-pseudo-id': String(params.pseudoId),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL('/internal/consent/check', this.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...headers,
          [SIGNATURE_HEADER]: sign(headers, this.secret),
        },
        body: JSON.stringify({ pseudoId: params.pseudoId, purpose: params.purpose }),
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { allowed?: boolean };
      return body.allowed === true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
