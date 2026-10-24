/**
 * Load the moderation policy: categories, report reasons, appeal reasons.
 *
 * The checks here are the invariants a JSON Schema cannot express. Two of them guard
 * against the same class of failure — a string that looks right and joins to nothing.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

export interface ModerationCategory {
  id: string;
  severity: number;
  active: boolean;
}

export interface ReportReason {
  id: string;
  label: string;
  blurb: string;
  /** The classifier category this routes to, or null for the catch-all. */
  routesTo: string | null;
  /** Urgent reasons reach a human regardless of what the classifier said. */
  urgent: boolean;
}

export interface AppealReason {
  id: string;
  label: string;
  blurb: string;
}

export interface ModerationPolicy {
  categories: readonly ModerationCategory[];
  categoryIds: ReadonlySet<string>;
  reportReasons: readonly ReportReason[];
  appealReasons: readonly AppealReason[];
}

/**
 * The canonical labels A1 emits.
 *
 * Duplicated here from ai-services/shared/src/schemas/moderation.py because there is
 * no way to import a Python enum into TypeScript. That makes it exactly the kind of
 * second copy that drifts, so `loadPolicy` checks the metadata against it and refuses
 * to start on a mismatch — a category id that differs by one character produces
 * verdicts nobody can join to anything, and nothing else would notice.
 */
const A1_CATEGORIES: readonly string[] = [
  'bullying_harassment',
  'hate_speech',
  'threats_intimidation',
  'stalking_doxxing',
  'manipulation_coercion',
  'grooming_exploitation',
  'passive_aggressive_abuse',
  'self_harm_encouragement',
  'unsafe_medical_advice',
  'religious_coercion',
  'scams_financial_exploitation',
  'malware_phishing',
  'sexual_exploitation',
  'impersonation',
  'emotional_dependency_pressure',
  'help_seeking_discouragement',
];

interface RawCategories {
  categories: { id: string; severity: number; active?: boolean }[];
}

interface RawReasons {
  report_reasons: {
    id: string;
    label: string;
    blurb: string;
    routes_to?: string | null;
    priority?: string;
  }[];
  appeal_reasons: { id: string; label: string; blurb: string }[];
}

export function loadPolicy(root: string): ModerationPolicy {
  const rawCats = parseYaml(
    readFileSync(resolve(root, 'metadata/moderation/categories/categories.v1.yaml'), 'utf8'),
  ) as RawCategories;
  const rawReasons = parseYaml(
    readFileSync(resolve(root, 'metadata/moderation/appeal-reasons/report-reasons.v1.yaml'), 'utf8'),
  ) as RawReasons;

  const categories = rawCats.categories.map((c) => ({
    id: c.id,
    severity: c.severity,
    active: c.active !== false,
  }));

  // 1. The category list must match A1's enum exactly, in both directions.
  //
  // A missing id means a verdict arrives naming a category that has no severity and no
  // row to reference. An extra id means a category nothing can ever fire, which reads
  // as coverage that is not there.
  const declared = new Set(categories.map((c) => c.id));
  const canonical = new Set(A1_CATEGORIES);
  const missing = A1_CATEGORIES.filter((id) => !declared.has(id));
  const extra = [...declared].filter((id) => !canonical.has(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `moderation policy: categories do not match the A1 enum. ` +
        `Missing: [${missing.join(', ')}]. Unknown: [${extra.join(', ')}]. ` +
        `They must stay in step with ai-services/shared/src/schemas/moderation.py.`,
    );
  }

  for (const c of categories) {
    if (!Number.isInteger(c.severity) || c.severity < 1 || c.severity > 5) {
      throw new Error(`moderation policy: ${c.id} has severity ${c.severity}, must be 1-5`);
    }
  }

  // 2. A report reason that routes to a category must route to a REAL one.
  //
  // Otherwise the routing silently does nothing and the report lands in the general
  // queue, which looks like a triage decision rather than a typo.
  const reportReasons = rawReasons.report_reasons.map((r) => {
    const routesTo = r.routes_to ?? null;
    if (routesTo !== null && !declared.has(routesTo)) {
      throw new Error(
        `moderation policy: report reason ${r.id} routes to ${routesTo}, ` +
          `which is not a moderation category`,
      );
    }
    return {
      id: r.id,
      label: r.label,
      blurb: r.blurb,
      routesTo,
      urgent: r.priority === 'urgent',
    };
  });

  // 3. Both lists need a catch-all.
  //
  // A taxonomy that forces somebody to pick the nearest wrong box loses the thing they
  // were reporting, and the people most likely to be forced are the ones describing
  // something the list did not anticipate.
  for (const [label, ids] of [
    ['report', reportReasons.map((r) => r.id)],
    ['appeal', rawReasons.appeal_reasons.map((r) => r.id)],
  ] as const) {
    if (!ids.includes('something_else')) {
      throw new Error(`moderation policy: ${label} reasons have no \`something_else\` catch-all`);
    }
  }

  return {
    categories,
    categoryIds: declared,
    reportReasons,
    appealReasons: rawReasons.appeal_reasons.map((r) => ({
      id: r.id,
      label: r.label,
      blurb: r.blurb,
    })),
  };
}
