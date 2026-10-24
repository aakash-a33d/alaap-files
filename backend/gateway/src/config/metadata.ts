/**
 * Metadata loading.
 *
 * The gateway holds no route table, no purpose list and no role matrix in code. It
 * reads all three from `metadata/` at boot, validates each against its JSON Schema,
 * and then cross-checks them against one another.
 *
 * Every check here is fatal. A gateway that starts with an inconsistent route policy
 * is worse than one that does not start: the failure would surface later as a route
 * that is silently unreachable, or worse, silently reachable.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import Ajv from 'ajv';
import { parse as parseYaml } from 'yaml';

import type { ActorRole, ApiGroup, AuditLevel } from '../types.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** The gateway's own id in the service registry, where it claims api_groups: ["*"]. */
const GATEWAY_SERVICE_ID = 'gateway';

/** `backend/gateway/src/config` -> repository root. */
const DEFAULT_ROOT = resolve(here, '../../../..');

export interface RegisteredPurpose {
  id: string;
  label: string;
  vaults: string[];
  consent: 'explicit' | 'implied-by-service' | 'not-required' | 'override';
  basis: string;
  ai_permitted: boolean;
}

export interface GatewayMetadata {
  groups: ApiGroup[];
  purposes: Map<string, RegisteredPurpose>;
  /** Service id -> the api_groups it claims in the service registry. */
  serviceGroups: Map<string, string[]>;
}

interface ServiceRegistryEntry {
  id: string;
  api_groups: string[];
}

interface RawGroup {
  prefix: string;
  service: string;
  authentication?: 'required' | 'none';
  roles: ActorRole[];
  purpose?: string;
  audit?: AuditLevel;
  step_up?: boolean;
  session_cookie?: boolean;
  step_up_grant?: boolean;
}

interface RawApiGroupsFile {
  version: number;
  defaults: { authentication: 'required' | 'none'; audit: AuditLevel; step_up: boolean };
  groups: RawGroup[];
}

function readYaml<T>(root: string, relative: string): T {
  const path = resolve(root, relative);
  try {
    return parseYaml(readFileSync(path, 'utf8')) as T;
  } catch (cause) {
    throw new Error(`Cannot read metadata file ${relative}`, { cause });
  }
}

function readJson<T>(root: string, relative: string): T {
  const path = resolve(root, relative);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (cause) {
    throw new Error(`Cannot read schema ${relative}`, { cause });
  }
}

/**
 * Validates a metadata document against its schema (folder-structure rule 7).
 *
 * The schemas are draft-07; Ajv's default export handles that dialect. Ajv2020 is
 * imported so a schema that later declares 2020-12 is not a silent no-op.
 */
function validate(root: string, schemaPath: string, doc: unknown, label: string): void {
  const schema = readJson<Record<string, unknown>>(root, schemaPath);
  const dialect = String(schema['$schema'] ?? '');
  const ajv = dialect.includes('2020-12')
    ? new Ajv2020({ allErrors: true, strict: false })
    : new Ajv.default({ allErrors: true, strict: false });

  const ok = ajv.validate(schema, doc);
  if (!ok) {
    const detail = (ajv.errors ?? [])
      .map((e) => `  ${e.instancePath || '(root)'} ${e.message ?? ''}`)
      .join('\n');
    throw new Error(`${label} failed schema validation:\n${detail}`);
  }
}

export function loadMetadata(metadataRoot?: string): GatewayMetadata {
  const root = metadataRoot ? resolve(metadataRoot) : DEFAULT_ROOT;

  // ---- purpose registry -------------------------------------------------
  const purposeDoc = readYaml<{ purposes: RegisteredPurpose[] }>(
    root,
    'metadata/consent/purpose-registry/purposes.v1.yaml',
  );
  validate(root, 'metadata/schemas/purpose-registry.schema.json', purposeDoc, 'Purpose registry');

  const purposes = new Map<string, RegisteredPurpose>();
  for (const p of purposeDoc.purposes) purposes.set(p.id, p);

  // ---- service registry -------------------------------------------------
  const serviceDoc = readYaml<{ services: ServiceRegistryEntry[] }>(
    root,
    'metadata/api/service-registry.v1.yaml',
  );
  validate(root, 'metadata/schemas/service-registry.schema.json', serviceDoc, 'Service registry');

  const serviceGroups = new Map<string, string[]>();
  for (const s of serviceDoc.services) serviceGroups.set(s.id, s.api_groups ?? []);

  // ---- api groups -------------------------------------------------------
  const groupDoc = readYaml<RawApiGroupsFile>(root, 'metadata/api/api-groups/api-groups.v1.yaml');
  validate(root, 'metadata/schemas/api-groups.schema.json', groupDoc, 'API groups');

  const groups: ApiGroup[] = groupDoc.groups.map((g) => ({
    prefix: g.prefix,
    service: g.service,
    authentication: g.authentication ?? groupDoc.defaults.authentication,
    roles: g.roles,
    purpose: g.purpose,
    audit: g.audit ?? groupDoc.defaults.audit,
    stepUp: g.step_up ?? groupDoc.defaults.step_up,
    // Defaults false. A group that does not say it mints sessions does not get to
    // hand the browser a credential.
    sessionCookie: g.session_cookie ?? false,
    // Defaults false. A group that does not say it verifies a second factor does
    // not get to tell the gateway somebody proved who they are.
    stepUpGrant: g.step_up_grant ?? false,
  }));

  crossCheck(groups, purposes, serviceGroups);

  return { groups, purposes, serviceGroups };
}

/**
 * The checks that make the three files one contract rather than three opinions.
 */
function crossCheck(
  groups: ApiGroup[],
  purposes: Map<string, RegisteredPurpose>,
  serviceGroups: Map<string, string[]>,
): void {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const g of groups) {
    if (seen.has(g.prefix)) problems.push(`${g.prefix}: declared more than once`);
    seen.add(g.prefix);

    // The service must exist and must claim this prefix. A group naming a service
    // that does not claim it means one of the two files was edited alone.
    const claimed = serviceGroups.get(g.service);
    if (claimed === undefined) {
      problems.push(`${g.prefix}: service "${g.service}" is not in the service registry`);
    } else if (claimed.length === 0) {
      // api_groups: [] marks an internal-only service. It must be unreachable from
      // the frontend — identity-vault-service and audit-service depend on this.
      problems.push(
        `${g.prefix}: "${g.service}" declares api_groups: [] and is internal-only. ` +
          `Routing to it from the gateway would expose it to the frontend.`,
      );
    } else if (!claimed.includes(g.prefix)) {
      problems.push(
        `${g.prefix}: "${g.service}" claims [${claimed.join(', ')}] and not this prefix`,
      );
    }

    // Folder-structure rule 3, checked at boot as well as in CI.
    if (g.purpose !== undefined && !purposes.has(g.purpose)) {
      problems.push(`${g.prefix}: purpose "${g.purpose}" is not in the purpose registry`);
    }

    // audit_events.purpose is NOT NULL and references a registered purpose, so an
    // audited group without one would fail at insert — which, because a failed
    // audit write fails the operation it records, would take the request with it.
    if (g.audit !== 'none' && g.purpose === undefined) {
      problems.push(`${g.prefix}: audit is "${g.audit}" but no purpose is declared`);
    }

    if (g.authentication === 'none') {
      if (g.roles.length > 0) problems.push(`${g.prefix}: unauthenticated group lists roles`);
      if (g.stepUp) problems.push(`${g.prefix}: unauthenticated group requires step-up`);
      if (g.audit !== 'none') {
        problems.push(`${g.prefix}: unauthenticated group cannot attribute an audit event`);
      }
    } else if (g.roles.length === 0) {
      problems.push(`${g.prefix}: authenticated group permits no role, so it is unreachable`);
    }
  }

  // Every prefix any routable service claims must have a policy here. A claimed
  // prefix with no entry would 404 with no explanation of why.
  //
  // The gateway is skipped: it declares api_groups: ["*"] because it fronts every
  // group rather than owning one. It is the router, not an upstream, and routing to
  // itself would be a loop.
  for (const [service, claimed] of serviceGroups) {
    if (service === GATEWAY_SERVICE_ID) continue;
    for (const prefix of claimed) {
      if (prefix === '*') {
        problems.push(`"${service}" claims the "*" wildcard, which only the gateway may hold`);
        continue;
      }
      if (!seen.has(prefix)) {
        problems.push(`${prefix}: claimed by "${service}" but has no api-groups policy`);
      }
    }
  }

  // And nothing may route TO the gateway.
  for (const g of groups) {
    if (g.service === GATEWAY_SERVICE_ID) {
      problems.push(`${g.prefix}: routes to the gateway itself`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Gateway route policy is inconsistent. Refusing to start.\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
}
