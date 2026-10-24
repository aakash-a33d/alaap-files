/**
 * Service-to-service client for pseudonym-service.
 *
 * auth-service allocates the pseudo_id because it owns the account; pseudonym-service
 * creates the persona because it owns the community vault. Neither can write the
 * other's tables — verified in scripts/db/verify.mjs — so this call crosses the
 * boundary over the network, signed, exactly as the architecture requires.
 */

import { sign, SIGNATURE_HEADER, type ServiceAuthHeaders } from '@alaap/service-auth';

export interface Persona {
  pseudoId: number;
  handle: string;
  avatarSeed: string;
  avatarStyle: string;
  status: string;
}

export class PseudonymClient {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, secret: string, timeoutMs = 5_000) {
    this.baseUrl = baseUrl;
    this.secret = secret;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Create the persona for a freshly allocated pseudo_id.
   *
   * Signs as `service`, not as the registering member: at this point there is no
   * session, and asserting one would be a lie in the audit trail. pseudonym-service
   * accepts a service caller on the internal route only.
   */
  async createPersona(pseudoId: number, requestId: string): Promise<Persona> {
    const headers: ServiceAuthHeaders = {
      'x-alaap-request-id': requestId,
      'x-alaap-actor-role': 'service',
      'x-alaap-purpose': 'account-recovery',
      'x-alaap-issued-at': new Date().toISOString(),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL('/internal/personas', this.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...headers,
          [SIGNATURE_HEADER]: sign(headers, this.secret),
        },
        body: JSON.stringify({ pseudoId }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`pseudonym-service returned ${response.status}`);
      }
      const body = (await response.json()) as { persona: Persona };
      return body.persona;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Resolve a handle to a persona, for login by username.
   *
   * Returns undefined for an unknown handle. The CALLER must answer identically for
   * a hit and a miss — whether a handle exists is public, but whether it has a usable
   * account is not.
   */
  async findByHandle(handle: string, requestId: string): Promise<Persona | undefined> {
    const headers: ServiceAuthHeaders = {
      'x-alaap-request-id': requestId,
      'x-alaap-actor-role': 'service',
      'x-alaap-purpose': 'account-recovery',
      'x-alaap-issued-at': new Date().toISOString(),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL('/internal/personas/by-handle', this.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...headers,
          [SIGNATURE_HEADER]: sign(headers, this.secret),
        },
        body: JSON.stringify({ handle }),
        signal: controller.signal,
      });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`pseudonym-service returned ${response.status}`);
      const body = (await response.json()) as { persona: Persona };
      return body.persona;
    } finally {
      clearTimeout(timer);
    }
  }
}
