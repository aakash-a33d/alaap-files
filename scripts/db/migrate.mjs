#!/usr/bin/env node
/**
 * Migration and grant runner for the local stack.
 *
 * Runs psql INSIDE each container, so no local PostgreSQL client is required and the
 * same command works on Windows, macOS and Linux. `database/` is mounted read-only
 * at /alaap/database in every instance, so psql reads the real files and reports real
 * line numbers on error.
 *
 * ORDER MATTERS AND IS NOT ALPHABETICAL:
 *
 *   1. migrations   create the tables
 *   2. grants       reference those tables by name, so they must come after
 *   3. login roles  granted the group roles the grants file created
 *
 * Applying grants before migrations fails on a missing relation, which is the correct
 * failure — a grant that silently matched nothing would leave a service with no
 * access and no error, and that surfaces days later as an inexplicable permission
 * denial.
 *
 * Usage:
 *   node scripts/db/migrate.mjs              apply anything not yet applied
 *   node scripts/db/migrate.mjs --status     show what is applied, change nothing
 *   node scripts/db/migrate.mjs --reset      drop every volume and rebuild (destructive)
 */

import { createHash } from 'node:crypto';
import { parse as parseYaml } from '../../backend/gateway/node_modules/yaml/dist/index.js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const COMPOSE_DIR = resolve(ROOT, 'infrastructure/docker/compose');

/** Instance -> compose service. Container paths are what psql sees. */
const INSTANCES = {
  shared: 'postgres-shared',
  identity: 'postgres-identity',
  audit: 'postgres-audit',
};

/**
 * The ordered plan. `db` is the database psql connects to; a file containing
 * `\connect` switches databases itself, so those entries connect to `postgres`.
 */
const PLAN = [
  // --- schema -------------------------------------------------------------
  { instance: 'shared', db: 'core', file: 'database/migrations/core/0001_auth.sql' },
  { instance: 'shared', db: 'community_vault', file: 'database/migrations/community-vault/0001_community.sql' },
  { instance: 'shared', db: 'clinical_vault', file: 'database/migrations/clinical-vault/0001_clinical.sql' },
  { instance: 'shared', db: 'billing_vault', file: 'database/migrations/billing-vault/0001_billing.sql' },
  { instance: 'identity', db: 'identity_vault', file: 'database/migrations/identity-vault/0001_identity.sql' },
  { instance: 'identity', db: 'identity_vault', file: 'database/migrations/identity-vault/0002_break_glass.sql' },
  { instance: 'audit', db: 'audit_vault', file: 'database/migrations/audit-vault/0001_audit.sql' },

  // --- grants (after the tables they name) ---------------------------------
  { instance: 'shared', db: 'postgres', file: 'database/policies/roles-grants/0001_roles.shared.sql' },
  { instance: 'audit', db: 'postgres', file: 'database/policies/roles-grants/0002_roles.audit.sql' },
  { instance: 'identity', db: 'postgres', file: 'database/policies/roles-grants/0003_roles.identity.sql' },
  { instance: 'shared', db: 'postgres', file: 'database/policies/roles-grants/0004_roles.clinical-billing.sql' },

  // --- database CONNECT privileges (after the roles they grant to exist) ----
  { instance: 'shared', db: 'postgres', file: 'database/policies/roles-grants/0005_connect.shared.sql' },
  { instance: 'identity', db: 'postgres', file: 'database/policies/roles-grants/0006_connect.identity.sql' },
  { instance: 'audit', db: 'postgres', file: 'database/policies/roles-grants/0007_connect.audit.sql' },

  // --- later schema changes ------------------------------------------------
  //
  // Ordered AFTER the grant files above on purpose: 0002_permanent_handles drops
  // `public_handles`, which 0001_roles.shared.sql grants on. Running it earlier would
  // make a fresh --reset fail on a missing relation.
  { instance: 'shared', db: 'community_vault', file: 'database/migrations/community-vault/0002_permanent_handles.sql' },
  { instance: 'shared', db: 'community_vault', file: 'database/migrations/community-vault/0003_chosen_usernames.sql' },
  { instance: 'shared', db: 'community_vault', file: 'database/migrations/community-vault/0004_drawn_handles_only.sql' },
  { instance: 'shared', db: 'community_vault', file: 'database/migrations/community-vault/0005_drop_reply_visibility.sql' },

  // --- later schema, and the grants that name it ---------------------------
  //
  // 0002_retention creates retention-service's four bookkeeping tables; 0009 grants on
  // them, so the table file must come first.
  { instance: 'shared', db: 'core', file: 'database/migrations/core/0002_retention.sql' },

  // Adds the stress column the dashboard had been collecting and discarding. No
  // grant follows it: 0004 grants on `mood_checkins` as a table, and a new column
  // on an already-granted table needs no further privilege.
  { instance: 'shared', db: 'clinical_vault', file: 'database/migrations/clinical-vault/0002_stress_score.sql' },

  // --- later privilege changes ---------------------------------------------
  { instance: 'shared', db: 'postgres', file: 'database/policies/roles-grants/0008_reports_to_moderation.sql' },
  { instance: 'shared', db: 'postgres', file: 'database/policies/roles-grants/0009_retention.sql' },
  { instance: 'shared', db: 'postgres', file: 'database/policies/roles-grants/0010_retention_connect.sql' },
  { instance: 'shared', db: 'postgres', file: 'database/policies/roles-grants/0011_erasure_delete.sql' },
];

/**
 * Login roles, created last because they are granted the groups the files above
 * define. Passwords come from the environment — never from a migration.
 *
 * Note the two-instance split: a service that owns tables gets a role on its vault
 * instance AND a separate role on the audit instance. The gateway appears only on
 * audit, because audit append is its only database credential.
 */
const LOGIN_ROLES = [
  { instance: 'shared', role: 'auth_service_app', groups: ['auth_service'], env: 'AUTH_SERVICE_DB_PASSWORD' },
  { instance: 'shared', role: 'pseudonym_service_app', groups: ['pseudonym_service'], env: 'PSEUDONYM_SERVICE_DB_PASSWORD' },
  { instance: 'shared', role: 'community_service_app', groups: ['community_service'], env: 'COMMUNITY_SERVICE_DB_PASSWORD' },
  { instance: 'shared', role: 'moderation_service_app', groups: ['moderation_service'], env: 'MODERATION_SERVICE_DB_PASSWORD' },
  { instance: 'shared', role: 'clinical_vault_service_app', groups: ['clinical_vault_service'], env: 'CLINICAL_VAULT_SERVICE_DB_PASSWORD' },
  { instance: 'shared', role: 'consent_service_app', groups: ['consent_service'], env: 'CONSENT_SERVICE_DB_PASSWORD' },
  { instance: 'shared', role: 'safety_crisis_service_app', groups: ['safety_crisis_service'], env: 'SAFETY_CRISIS_SERVICE_DB_PASSWORD' },
  { instance: 'shared', role: 'billing_subsidy_service_app', groups: ['billing_subsidy_service'], env: 'BILLING_SUBSIDY_SERVICE_DB_PASSWORD' },
  { instance: 'shared', role: 'partner_service_app', groups: ['partner_service'], env: 'PARTNER_SERVICE_DB_PASSWORD' },
  { instance: 'shared', role: 'retention_service_app', groups: ['retention_service'], env: 'RETENTION_SERVICE_DB_PASSWORD' },

  { instance: 'identity', role: 'identity_vault_service_app', groups: ['identity_vault_service'], env: 'IDENTITY_VAULT_SERVICE_DB_PASSWORD' },
  { instance: 'identity', role: 'break_glass_service_app', groups: ['break_glass_service'], env: 'BREAK_GLASS_SERVICE_DB_PASSWORD' },

  { instance: 'audit', role: 'gateway_audit', groups: ['audit_writer'], env: 'GATEWAY_AUDIT_DB_PASSWORD' },
  { instance: 'audit', role: 'auth_service_audit', groups: ['audit_writer'], env: 'AUTH_SERVICE_AUDIT_DB_PASSWORD' },
  { instance: 'audit', role: 'pseudonym_service_audit', groups: ['audit_writer'], env: 'PSEUDONYM_SERVICE_AUDIT_DB_PASSWORD' },
  { instance: 'audit', role: 'community_service_audit', groups: ['audit_writer'], env: 'COMMUNITY_SERVICE_AUDIT_DB_PASSWORD' },
  { instance: 'audit', role: 'moderation_service_audit', groups: ['audit_writer'], env: 'MODERATION_SERVICE_AUDIT_DB_PASSWORD' },
  { instance: 'audit', role: 'retention_service_audit', groups: ['audit_writer'], env: 'RETENTION_SERVICE_AUDIT_DB_PASSWORD' },
  { instance: 'audit', role: 'audit_service_app', groups: ['audit_service'], env: 'AUDIT_SERVICE_DB_PASSWORD' },
];

const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS _migrations (
    filename    text        PRIMARY KEY,
    checksum    text        NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE _migrations IS
    'Applied migrations and their SHA-256. A changed checksum means a file was edited after being applied, which is refused rather than silently re-run.';
`;

// ---------------------------------------------------------------- helpers ---

const c = {
  dim: (s) => `[2m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  yellow: (s) => `[33m${s}[0m`,
  bold: (s) => `[1m${s}[0m`,
};

function compose(args, opts = {}) {
  return execFileSync('docker', ['compose', ...args], {
    cwd: COMPOSE_DIR,
    encoding: 'utf8',
    stdio: opts.inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    ...opts,
  });
}

/** Run SQL through psql in a container. ON_ERROR_STOP so a mid-file failure is fatal. */
function psql(instance, db, { file, sql, quiet = true }) {
  const service = INSTANCES[instance];
  const args = [
    'exec', '-T', service,
    'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db,
  ];
  if (quiet) args.push('-q');
  if (file !== undefined) args.push('-f', `/alaap/${file}`);
  else args.push('-c', sql);

  try {
    return compose(args, { input: undefined });
  } catch (err) {
    const stderr = err.stderr?.toString() ?? '';
    const stdout = err.stdout?.toString() ?? '';
    throw new Error(`${instance}/${db}: ${file ?? sql.slice(0, 60)}\n${stderr || stdout}`);
  }
}

function scalar(instance, db, sql) {
  const service = INSTANCES[instance];
  return compose([
    'exec', '-T', service,
    'psql', '-U', 'postgres', '-d', db, '-tAc', sql,
  ]).trim();
}

function checksum(relPath) {
  return createHash('sha256').update(readFileSync(resolve(ROOT, relPath))).digest('hex');
}

/** The ledger lives on the instance, in `postgres`, so it survives per-database work. */
function ensureLedger(instance) {
  psql(instance, 'postgres', { sql: LEDGER_DDL });
}

function applied(instance) {
  const rows = scalar(instance, 'postgres', 'SELECT filename || \'|\' || checksum FROM _migrations');
  const map = new Map();
  for (const line of rows.split('\n')) {
    if (!line.trim()) continue;
    const [name, sum] = line.split('|');
    map.set(name, sum);
  }
  return map;
}

function record(instance, filename, sum) {
  psql(instance, 'postgres', {
    sql: `INSERT INTO _migrations (filename, checksum) VALUES ('${filename}', '${sum}')`,
  });
}

function waitForHealthy() {
  process.stdout.write('waiting for containers to report healthy ');
  for (let i = 0; i < 60; i += 1) {
    const ps = compose(['ps', '--format', 'json']);
    const lines = ps.split('\n').filter((l) => l.trim());
    const states = lines.map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    const relevant = states.filter((s) => Object.values(INSTANCES).includes(s.Service));
    const healthy = relevant.filter((s) => (s.Health ?? '') === 'healthy');

    if (relevant.length >= 3 && healthy.length === relevant.length) {
      process.stdout.write(c.green(' ok\n'));
      return;
    }
    process.stdout.write('.');
    execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},2000)']);
  }
  process.stdout.write('\n');
  throw new Error('containers did not become healthy. Try: docker compose logs');
}

// ------------------------------------------------------------------- main ---

const args = process.argv.slice(2);

if (args.includes('--reset')) {
  console.log(c.yellow('\nDestroying every volume in the dev stack.\n'));
  compose(['down', '-v'], { inherit: true });
  compose(['up', '-d'], { inherit: true });
  waitForHealthy();
}

if (args.includes('--status')) {
  console.log(c.bold('\nApplied migrations\n'));
  for (const instance of Object.keys(INSTANCES)) {
    try {
      ensureLedger(instance);
      const map = applied(instance);
      console.log(`  ${c.bold(instance)}`);
      if (map.size === 0) console.log(c.dim('    (none)'));
      for (const [name] of map) console.log(`    ${c.green('applied')}  ${name}`);
    } catch {
      console.log(`  ${c.bold(instance)}  ${c.red('unreachable')}`);
    }
  }
  const pending = PLAN.filter((s) => {
    try { return !applied(s.instance).has(s.file); } catch { return true; }
  });
  console.log(`\n  ${pending.length} pending\n`);
  process.exit(0);
}

console.log(c.bold('\nApplying schema and grants\n'));

for (const instance of Object.keys(INSTANCES)) ensureLedger(instance);

let changed = 0;
for (const step of PLAN) {
  const sum = checksum(step.file);
  const already = applied(step.instance).get(step.file);

  if (already === sum) {
    console.log(`  ${c.dim('skip   ')} ${step.file}`);
    continue;
  }
  if (already !== undefined && already !== sum) {
    console.error(
      `\n${c.red('refusing to continue')}\n\n` +
        `  ${step.file} was applied and has since been edited.\n\n` +
        `  A published migration is superseded, never edited — a checksum that no\n` +
        `  longer matches means the database and the repository disagree about what\n` +
        `  is deployed. Add a new migration, or --reset to rebuild from scratch.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`  ${c.yellow('apply  ')} ${step.file} ... `);
  psql(step.instance, step.db, { file: step.file });
  record(step.instance, step.file, sum);
  console.log(c.green('ok'));
  changed += 1;
}

// --- audit event types ------------------------------------------------------
//
// Seeded from metadata rather than a hand-written SQL file. `audit_events.action_type`
// is a foreign key to this table, and because a failed audit write fails the operation
// it was recording, an unseeded type takes the request down with it — a 503 on every
// audited route until these rows exist.
//
// Gateway types are DERIVED from api-groups.v1.yaml using the same rule the gateway
// itself applies, so the registry cannot drift from the route policy.
console.log('');
{
  const registry = parseYaml(readFileSync(resolve(ROOT, 'metadata/audit/event-types/event-types.v1.yaml'), 'utf8'));
  const groups = parseYaml(readFileSync(resolve(ROOT, 'metadata/api/api-groups/api-groups.v1.yaml'), 'utf8'));

  const rows = new Map();
  for (const e of registry.events) {
    rows.set(e.id, { sensitivity: e.sensitivity, retention: e.retention });
  }

  const { verbs, by_audit_level: byLevel, overrides = {} } = registry.gateway_derived;
  const defaultAudit = groups.defaults.audit;
  for (const g of groups.groups) {
    const level = g.audit ?? defaultAudit;
    if (level === 'none') continue;
    const cls = overrides[g.prefix] ?? byLevel[level];
    const domain = g.prefix.replace(/^\/api\//, '').replaceAll('-', '_');
    for (const verb of verbs) {
      rows.set(`gateway.${domain}.${verb}`, cls);
    }
  }

  const values = [...rows.entries()]
    .map(([id, c2]) => `('${id}', ${c2.sensitivity}, '${c2.retention}')`)
    .join(',\n           ');

  psql('audit', 'audit_vault', {
    sql: `INSERT INTO audit_event_types (id, sensitivity, retention)
          VALUES ${values}
          ON CONFLICT (id) DO UPDATE
            SET sensitivity = EXCLUDED.sensitivity,
                retention   = EXCLUDED.retention`,
  });

  const derived = rows.size - registry.events.length;
  console.log(
    `  ${c.green('events ')} ${rows.size} audit event types seeded ` +
      c.dim(`(${registry.events.length} declared, ${derived} derived from route policy)`),
  );
}

// --- community categories ---------------------------------------------------
//
// Seeded from metadata for the same reason the audit types are: `community_posts
// .category_id` is a foreign key, so an unseeded category makes posting fail with a
// constraint violation rather than a message anyone can act on.
//
// Retiring a category means setting `active: false` in the YAML, never deleting the
// row - posts already filed under it keep their foreign key, and a member's post does
// not disappear because a topic was reorganised.
{
  const doc = parseYaml(readFileSync(resolve(ROOT, 'metadata/community/categories.v1.yaml'), 'utf8'));
  const values = doc.categories
    .map((cat, i) => `('${cat.id}', ${i}, ${cat.active === false ? 'false' : 'true'})`)
    .join(',\n           ');

  psql('shared', 'community_vault', {
    sql: `INSERT INTO community_categories (id, display_order, active)
          VALUES ${values}
          ON CONFLICT (id) DO UPDATE
            SET display_order = EXCLUDED.display_order,
                active        = EXCLUDED.active`,
  });

  const retired = doc.categories.filter((cat) => cat.active === false).length;
  console.log(
    `  ${c.green('topics ')} ${doc.categories.length} community categories seeded` +
      (retired ? c.dim(` (${retired} retired)`) : ''),
  );
}

// --- moderation policy ------------------------------------------------------
//
// `moderation_verdicts.policy_version` is a foreign key, so a verdict cannot be
// recorded until a policy version exists — which means moderation would fail closed on
// a fresh database and take every reply on the platform with it.
//
// Versions are append-only. A policy change publishes a NEW version rather than
// editing one, because a verdict references the policy that produced it and an appeal
// months later has to be judged against the rules that were in force at the time.
{
  const cats = parseYaml(readFileSync(resolve(ROOT, 'metadata/moderation/categories/categories.v1.yaml'), 'utf8'));
  const values = cats.categories
    .map((cat) => `('${cat.id}', ${cat.severity}, ${cat.active === false ? 'false' : 'true'})`)
    .join(',' + '\n' + '           ');

  psql('shared', 'community_vault', {
    sql: `INSERT INTO moderation_categories (id, severity, active)
          VALUES ${values}
          ON CONFLICT (id) DO UPDATE
            SET severity = EXCLUDED.severity,
                active   = EXCLUDED.active;

          INSERT INTO moderation_policy_versions (version, notes)
          VALUES (1, 'Initial policy. Categories and severities from metadata/moderation/categories/categories.v1.yaml.')
          ON CONFLICT (version) DO NOTHING`,
  });

  console.log(
    `  ${c.green('policy ')} ${cats.categories.length} moderation categories seeded ` +
      c.dim('(policy version 1)'),
  );
}

// --- consent versions -------------------------------------------------------
//
// `consent_records.consent_version_id` is a foreign key, so without these a member
// cannot grant consent to anything — and consent-service refuses rather than recording
// an agreement that points at no text, which is the correct failure and a total one.
//
// Append-only: `ON CONFLICT DO NOTHING`. Changing what a purpose means publishes a NEW
// id; it never edits the text somebody already agreed to.
{
  const doc = parseYaml(readFileSync(resolve(ROOT, 'metadata/consent/versions/versions.v1.yaml'), 'utf8'));
  const values = doc.versions
    .map((v) => `('${v.id}', '${v.purpose}', $$${v.body_markdown}$$)`)
    .join(', ');

  psql('shared', 'clinical_vault', {
    sql: `INSERT INTO consent_versions (id, purpose, body_markdown)
          VALUES ${values}
          ON CONFLICT (id) DO NOTHING`,
  });

  console.log(`  ${c.green('consent')} ${doc.versions.length} consent versions seeded`);
}

// --- login roles ------------------------------------------------------------
console.log('');
for (const { instance, role, groups, env } of LOGIN_ROLES) {
  const password = process.env[env];
  if (!password) {
    console.error(`\n${c.red('missing')} ${env} — set it in infrastructure/docker/compose/.env\n`);
    process.exit(1);
  }
  if (password.length < 16) {
    console.error(`\n${c.red('weak')} ${env} is under 16 characters.\n`);
    process.exit(1);
  }

  // Idempotent: create if absent, always reset the password so rotating .env is
  // enough. Passwords are passed as a quoted literal to psql inside the container
  // and never reach a shell argument list.
  const sql = `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE ${role} LOGIN;
      END IF;
    END $$;
    ALTER ROLE ${role} WITH PASSWORD ${literal(password)};
    ${groups.map((g) => `GRANT ${g} TO ${role};`).join('\n    ')}
  `;
  psql(instance, 'postgres', { sql });
  console.log(`  ${c.green('role   ')} ${instance}/${role} ${c.dim(`-> ${groups.join(', ')}`)}`);
}

console.log(`\n${c.green('done')} — ${changed} migration(s) applied, ${LOGIN_ROLES.length} login role(s) ensured\n`);

/** PostgreSQL string literal with quote doubling. */
function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
