/**
 * Service-to-service client for the AI orchestrator.
 *
 * Calls the INTERNAL verdict, not the public one. community-service needs the
 * categories and the model id to store a verdict somebody can later appeal against;
 * the public projection deliberately withholds those, because routed to a browser they
 * are a tuning oracle for working out what gets past the filter.
 *
 * That is also why this route has no gateway path: it is reachable from inside the
 * network and from nowhere else.
 */

import { sign, SIGNATURE_HEADER, type ServiceAuthHeaders } from '@alaap/service-auth';

export type Decision = 'allowed' | 'blocked' | 'rewrite_required' | 'held';

export interface Verdict {
  decision: Decision;
  riskLevel: string;
  reason: string;
  /** Categories that fired, for the moderation record. Never shown to the writer. */
  categories: string[];
  safetyModelId: string;
  latencyMs: number;
}

export class AiClient {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly timeoutMs: number;

  /**
   * 10 seconds, not 5.
   *
   * A warm verdict takes about 35ms, so this is not sized for the normal case - it is
   * headroom for a GPU that is busy with another request. The orchestrator warms its
   * model before binding the port, so a cold start no longer lands here, but a queued
   * inference still can.
   *
   * It is not sized generously enough to hide a real outage either: past this, the
   * caller fails closed and the member is asked to try again, which is the right
   * answer when nobody has checked what they wrote.
   */
  constructor(baseUrl: string, secret: string, timeoutMs = 10_000) {
    this.baseUrl = baseUrl;
    this.secret = secret;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Moderate a reply against the post it answers.
   *
   * `surface: 'comment'` matters. A post is not moderated at all — every category
   * needs a recipient and a new post has none — so asking about one would be asking a
   * question whose answer must be discarded.
   */
  async moderateReply(params: {
    body: string;
    context: string;
    requestId: string;
  }): Promise<Verdict> {
    const headers: ServiceAuthHeaders = {
      'x-alaap-request-id': params.requestId,
      'x-alaap-actor-role': 'service',
      'x-alaap-purpose': 'community-moderation',
      'x-alaap-issued-at': new Date().toISOString(),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL('/v1/moderate/internal', this.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...headers,
          [SIGNATURE_HEADER]: sign(headers, this.secret),
        },
        body: JSON.stringify({ text: params.body, surface: 'comment' }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`ai orchestrator returned ${response.status}`);

      const body = (await response.json()) as {
        decision: Decision;
        risk_level: string;
        reason: string;
        scores?: { category: string; score: number; threshold: number }[];
        safety_model_id: string;
        latency_ms: number;
      };

      return {
        decision: body.decision,
        riskLevel: body.risk_level,
        reason: body.reason,
        categories: (body.scores ?? [])
          .filter((s) => s.score >= s.threshold)
          .map((s) => s.category),
        safetyModelId: body.safety_model_id,
        latencyMs: body.latency_ms,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Crisis triage on a PUBLISHED post, and the alert if it comes back banded.
   *
   * A2 only, with no moderation attached. A member's own post is never moderated, so
   * asking `/v1/moderate` about one would be asking a question whose answer has to be
   * thrown away. This asks the only question the platform is allowed to act on, and
   * the answer is never shown to the person who wrote the words.
   *
   * WHY THIS RUNS HERE AND NOT IN THE BROWSER
   *
   * The composer used to do this on a keystroke timer. Two things were wrong with
   * that. The browser does not reach the AI tier (SS8.1) and, more importantly, the
   * consent text a member is shown for crisis-triage says in as many words:
   *
   *     It does not read drafts. Nothing you type and then delete leaves any trace.
   *
   * Triaging a draft on a timer sends the platform sentences somebody typed and then
   * deleted. Running it at publish is what makes that sentence true: an abandoned
   * draft raises nothing, because it never left the device.
   *
   * Gates nothing and is never surfaced. A failure costs the alert and nothing else,
   * which is the same promise from the other direction: "It does not block anything,
   * and it does not tell you what it found."
   */
  async triagePublishedPost(params: {
    ref: string;
    body: string;
    requestId: string;
  }): Promise<void> {
    const headersFor = (): ServiceAuthHeaders => ({
      'x-alaap-request-id': params.requestId,
      'x-alaap-actor-role': 'service',
      'x-alaap-purpose': 'crisis-triage',
      'x-alaap-issued-at': new Date().toISOString(),
    });
    const signedHeaders = (h: ServiceAuthHeaders): Record<string, string> => ({
      'content-type': 'application/json',
      ...(h as Record<string, string>),
      [SIGNATURE_HEADER]: sign(h, this.secret),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL('/v1/triage', this.baseUrl), {
        method: 'POST',
        headers: signedHeaders(headersFor()),
        body: JSON.stringify({ text: params.body, surface: 'post' }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`triage returned ${response.status}`);

      const { risk_level: riskLevel } = (await response.json()) as { risk_level: string };
      if (riskLevel !== 'moderate' && riskLevel !== 'high') return;

      // The alert carries the reference, not the text. Mediation looks the post up; a
      // copy of it in an alert payload would be clinical content in a second place,
      // under a different retention policy and a different set of readers.
      await fetch(new URL('/v1/safety/alert', this.baseUrl), {
        method: 'POST',
        headers: signedHeaders(headersFor()),
        body: JSON.stringify({ ref: params.ref, surface: 'post', risk_level: riskLevel }),
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Client for moderation-service, which owns the verdict record.
 *
 * community-service has no write on `moderation_verdicts` — that is in the grants,
 * deliberately, and it is what makes an appeal possible: a member appeals against a
 * verdict, so the verdict has to live somewhere they can reach that is not the service
 * that produced it.
 */
export class ModerationClient {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, secret: string, timeoutMs = 5_000) {
    this.baseUrl = baseUrl;
    this.secret = secret;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Record the decision, and return the verdict id.
   *
   * Returns undefined on any failure rather than throwing. The reply has already been
   * written and its state already reflects the decision, so a missing verdict row
   * costs the member the ability to APPEAL — bad, and worth logging loudly — but
   * failing the request here would discard a decision that has already taken effect
   * and tell a member their reply failed when it did not.
   */
  async recordCommentVerdict(params: {
    commentRef: string;
    decision: string;
    categories: string[];
    modelId: string;
    modelVersion: string;
    latencyMs: number;
    requestId: string;
  }): Promise<string | undefined> {
    const headers: ServiceAuthHeaders = {
      'x-alaap-request-id': params.requestId,
      'x-alaap-actor-role': 'service',
      'x-alaap-purpose': 'community-moderation',
      'x-alaap-issued-at': new Date().toISOString(),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL('/internal/verdicts/comment', this.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...headers,
          [SIGNATURE_HEADER]: sign(headers, this.secret),
        },
        body: JSON.stringify({
          commentRef: params.commentRef,
          decision: params.decision,
          categories: params.categories,
          modelId: params.modelId,
          modelVersion: params.modelVersion,
          latencyMs: params.latencyMs,
        }),
        signal: controller.signal,
      });
      if (!response.ok) return undefined;
      const body = (await response.json()) as { verdict?: { id?: string } };
      return body.verdict?.id;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Client for B1, the supportive response.
 *
 * Calls the orchestrator's internal route, which runs A1 over the model's own output
 * before returning anything — so this client cannot forget to, and neither can any
 * other caller.
 */
export class SupportiveClient {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly timeoutMs: number;

  /**
   * 30 seconds. Generous because generation is asynchronous by contract: nobody is
   * waiting on this request, and the alternative to waiting is a post with no reply.
   */
  constructor(baseUrl: string, secret: string, timeoutMs = 30_000) {
    this.baseUrl = baseUrl;
    this.secret = secret;
    this.timeoutMs = timeoutMs;
  }

  /** The reply, or undefined. Undefined is a normal outcome, not an error. */
  async respond(params: { body: string; requestId: string }): Promise<string | undefined> {
    const headers: ServiceAuthHeaders = {
      'x-alaap-request-id': params.requestId,
      'x-alaap-actor-role': 'service',
      'x-alaap-purpose': 'community-moderation',
      'x-alaap-issued-at': new Date().toISOString(),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL('/v1/respond', this.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...headers,
          [SIGNATURE_HEADER]: sign(headers, this.secret),
        },
        body: JSON.stringify({ text: params.body }),
        signal: controller.signal,
      });
      if (!response.ok) return undefined;
      const body = (await response.json()) as { ok?: boolean; text?: string };
      return body.ok === true && body.text ? body.text : undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}
