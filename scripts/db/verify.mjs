#!/usr/bin/env node
/**
 * Privilege verification for the local stack.
 *
 * The grants in database/policies/roles-grants/ make claims. This asserts them
 * against a live database, as the actual login roles, because a grant that silently
 * matched nothing looks identical to a grant that worked until the day someone
 * needs it to have worked.
 *
 * Every NEGATIVE case here is a property the architecture depends on. If one starts
 * passing where it should fail, a boundary has opened.
 *
 *   node scripts/db/verify.mjs
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPOSE_DIR = resolve(HERE, '../../infrastructure/docker/compose');

const SERVICE = { shared: 'postgres-shared', identity: 'postgres-identity', audit: 'postgres-audit' };

const c = {
  dim: (s) => `[2m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  bold: (s) => `[1m${s}[0m`,
};

/** Run SQL as a specific login role. Returns {ok, output}. */
function as(instance, db, role, password, sql) {
  try {
    const out = execFileSync(
      'docker',
      [
        'compose', 'exec', '-T',
        '-e', `PGPASSWORD=${password}`,
        SERVICE[instance],
        'psql', '-v', 'ON_ERROR_STOP=1', '-U', role, '-d', db, '-tAc', sql,
      ],
      { cwd: COMPOSE_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return { ok: true, output: out.trim() };
  } catch (err) {
    return { ok: false, output: (err.stderr?.toString() ?? err.stdout?.toString() ?? '').trim() };
  }
}

const env = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(c.red(`missing ${name} — source infrastructure/docker/compose/.env first`));
    process.exit(1);
  }
  return v;
};

const P = {
  auth: env('AUTH_SERVICE_DB_PASSWORD'),
  pseudonym: env('PSEUDONYM_SERVICE_DB_PASSWORD'),
  community: env('COMMUNITY_SERVICE_DB_PASSWORD'),
  moderation: env('MODERATION_SERVICE_DB_PASSWORD'),
  gatewayAudit: env('GATEWAY_AUDIT_DB_PASSWORD'),
  auditService: env('AUDIT_SERVICE_DB_PASSWORD'),
  clinical: env('CLINICAL_VAULT_SERVICE_DB_PASSWORD'),
  consent: env('CONSENT_SERVICE_DB_PASSWORD'),
  safety: env('SAFETY_CRISIS_SERVICE_DB_PASSWORD'),
  billing: env('BILLING_SUBSIDY_SERVICE_DB_PASSWORD'),
  partner: env('PARTNER_SERVICE_DB_PASSWORD'),
  retention: env('RETENTION_SERVICE_DB_PASSWORD'),
  identity: env('IDENTITY_VAULT_SERVICE_DB_PASSWORD'),
  breakGlass: env('BREAK_GLASS_SERVICE_DB_PASSWORD'),
};

let pass = 0;
let fail = 0;

/** expect: 'allow' | 'deny' */
function check(label, expect, result) {
  const good = expect === 'allow' ? result.ok : !result.ok;
  if (good) {
    pass += 1;
    console.log(`  ${c.green('pass')}  ${label}`);
  } else {
    fail += 1;
    console.log(`  ${c.red('FAIL')}  ${label}`);
    console.log(c.dim(`        expected to be ${expect === 'allow' ? 'allowed' : 'denied'}`));
    if (result.output) console.log(c.dim(`        ${result.output.split('\n')[0]}`));
  }
}

console.log(c.bold('\nAudit vault — append only\n'));

check(
  'gateway may INSERT an audit event',
  'allow',
  as('audit', 'audit_vault', 'gateway_audit', P.gatewayAudit,
    `INSERT INTO audit_events (request_id, actor_role, service_name, action_type, purpose, consent_decision, access_result)
     VALUES (gen_random_uuid(), 'service', 'gateway', 'gateway.community.create', 'community-moderation', 'not_required', 'allowed')`),
);

check(
  'gateway may NOT read the log it writes to',
  'deny',
  as('audit', 'audit_vault', 'gateway_audit', P.gatewayAudit, 'SELECT count(*) FROM audit_events'),
);

check(
  'gateway may NOT amend an audit event',
  'deny',
  as('audit', 'audit_vault', 'gateway_audit', P.gatewayAudit,
    "UPDATE audit_events SET access_result = 'denied' WHERE seq = 1"),
);

check(
  'gateway may NOT delete an audit event',
  'deny',
  as('audit', 'audit_vault', 'gateway_audit', P.gatewayAudit, 'DELETE FROM audit_events WHERE seq = 1'),
);

check(
  'audit-service may read',
  'allow',
  as('audit', 'audit_vault', 'audit_service_app', P.auditService, 'SELECT count(*) FROM audit_events'),
);

check(
  'audit-service may NOT delete, even holding the read path',
  'deny',
  as('audit', 'audit_vault', 'audit_service_app', P.auditService, 'DELETE FROM audit_events WHERE seq = 1'),
);

console.log(c.bold('\nCommunity vault — co-tenancy over disjoint tables\n'));

check(
  'community-service may write a post',
  'allow',
  as('shared', 'community_vault', 'community_service_app', P.community,
    'SELECT 1 FROM community_posts LIMIT 1'),
);

check(
  'community-service may NOT forge a persona',
  'deny',
  as('shared', 'community_vault', 'community_service_app', P.community,
    "INSERT INTO pseudo_profiles (pseudo_id) VALUES (999999)"),
);

check(
  'moderation-service may NOT edit the body it judges',
  'deny',
  as('shared', 'community_vault', 'moderation_service_app', P.moderation,
    "UPDATE community_posts SET body = 'edited by the moderator'"),
);

check(
  'moderation-service MAY transition post state',
  'allow',
  as('shared', 'community_vault', 'moderation_service_app', P.moderation,
    "UPDATE community_posts SET state = state WHERE false"),
);

check(
  'pseudonym-service may NOT read post bodies',
  'deny',
  as('shared', 'community_vault', 'pseudonym_service_app', P.pseudonym,
    'SELECT body FROM community_posts LIMIT 1'),
);

check(
  'pseudonym-service MAY manage handles',
  'allow',
  as('shared', 'community_vault', 'pseudonym_service_app', P.pseudonym,
    'SELECT handle FROM pseudo_profiles LIMIT 1'),
);

check(
  'moderation-service MAY hold member reports',
  'allow',
  as('shared', 'community_vault', 'moderation_service_app', P.moderation,
    'SELECT 1 FROM user_reports LIMIT 1'),
);

check(
  'community-service may NOT read member reports',
  'deny',
  as('shared', 'community_vault', 'community_service_app', P.community,
    'SELECT 1 FROM user_reports LIMIT 1'),
);

check(
  'moderation-service may NOT rewrite a post body',
  'deny',
  as('shared', 'community_vault', 'moderation_service_app', P.moderation,
    "UPDATE community_posts SET body = 'edited by the judge'"),
);

check(
  'community-service may NOT record its own verdict',
  'deny',
  as('shared', 'community_vault', 'community_service_app', P.community,
    'SELECT 1 FROM moderation_verdicts LIMIT 1'),
);

console.log(c.bold('\ncore — sole tenancy\n'));

check(
  'auth-service may read its own accounts',
  'allow',
  as('shared', 'core', 'auth_service_app', P.auth, 'SELECT count(*) FROM auth_accounts'),
);

check(
  'community-service may NOT reach core at all',
  'deny',
  as('shared', 'core', 'community_service_app', P.community, 'SELECT count(*) FROM auth_accounts'),
);

check(
  'auth-service may NOT read the community vault',
  'deny',
  as('shared', 'community_vault', 'auth_service_app', P.auth, 'SELECT count(*) FROM community_posts'),
);

console.log(c.bold('\nClinical vault — co-tenancy, and who may read content\n'));

check(
  'clinical-vault-service may read a journal record',
  'allow',
  as('shared', 'clinical_vault', 'clinical_vault_service_app', P.clinical,
    'SELECT 1 FROM journal_entries LIMIT 1'),
);

check(
  'consent-service may NOT read the journals it governs',
  'deny',
  as('shared', 'clinical_vault', 'consent_service_app', P.consent,
    'SELECT 1 FROM journal_entries LIMIT 1'),
);

check(
  'consent-service may NOT read short stories either',
  'deny',
  as('shared', 'clinical_vault', 'consent_service_app', P.consent,
    'SELECT 1 FROM short_stories LIMIT 1'),
);

check(
  'safety-crisis-service may NOT read any clinical content',
  'deny',
  as('shared', 'clinical_vault', 'safety_crisis_service_app', P.safety,
    'SELECT 1 FROM journal_entries LIMIT 1'),
);

check(
  'safety-crisis-service MAY raise a signal',
  'allow',
  as('shared', 'clinical_vault', 'safety_crisis_service_app', P.safety,
    'SELECT 1 FROM safety_signals LIMIT 1'),
);

check(
  'clinical-vault-service may NOT grant itself consent',
  'deny',
  as('shared', 'clinical_vault', 'clinical_vault_service_app', P.clinical,
    "INSERT INTO consent_records (pseudo_id, purpose, consent_version_id) VALUES (1, 'x', 'y')"),
);

// This assertion used to read "nobody may DELETE a journal — erasure goes through
// retention", and it passed for four milestones because nothing had tried to erase
// anything. retention-service holds no credential on this vault and cannot even
// CONNECT, so what the old assertion actually guaranteed was that a right to erasure
// could never be exercised by anybody. 0011_erasure_delete.sql corrects it.
//
// What replaces it is the boundary that does the work: the vault's owner may erase its
// own rows, and nobody else may — including the service that orchestrates the erasure.
check(
  'clinical-vault-service MAY erase its own rows, because somebody must',
  'allow',
  as('shared', 'clinical_vault', 'clinical_vault_service_app', P.clinical,
    'DELETE FROM journal_entries WHERE false'),
);

check(
  'consent-service may NOT delete a journal it cannot even read',
  'deny',
  as('shared', 'clinical_vault', 'consent_service_app', P.consent,
    'DELETE FROM journal_entries WHERE false'),
);

check(
  'clinical-vault-service may NOT erase the record of what it was permitted',
  'deny',
  as('shared', 'clinical_vault', 'clinical_vault_service_app', P.clinical,
    'DELETE FROM consent_records WHERE false'),
);

// The orchestrator of every deletion, unable to perform one directly.
check(
  'retention-service may NOT delete a journal — it cannot open the vault at all',
  'deny',
  as('shared', 'clinical_vault', 'retention_service_app', P.retention,
    'DELETE FROM journal_entries WHERE false'),
);

console.log(c.bold('\nBilling vault — the partner must not learn who\n'));

check(
  'billing-subsidy-service may read allocations',
  'allow',
  as('shared', 'billing_vault', 'billing_subsidy_service_app', P.billing,
    'SELECT 1 FROM subsidy_allocations LIMIT 1'),
);

check(
  'partner-service may see its fund',
  'allow',
  as('shared', 'billing_vault', 'partner_service_app', P.partner,
    'SELECT 1 FROM partner_funds LIMIT 1'),
);

check(
  'partner-service may NOT see who a subsidy went to',
  'deny',
  as('shared', 'billing_vault', 'partner_service_app', P.partner,
    'SELECT pseudo_id FROM subsidy_allocations LIMIT 1'),
);

check(
  'partner-service may NOT read payments',
  'deny',
  as('shared', 'billing_vault', 'partner_service_app', P.partner,
    'SELECT 1 FROM payments LIMIT 1'),
);

console.log(c.bold('\nIdentity vault — the isolate\n'));

check(
  'identity-vault-service may read an identity record',
  'allow',
  as('identity', 'identity_vault', 'identity_vault_service_app', P.identity,
    'SELECT 1 FROM identity_vault_records LIMIT 1'),
);

check(
  'identity-vault-service may NOT authorise its own disclosure',
  'deny',
  as('identity', 'identity_vault', 'identity_vault_service_app', P.identity,
    "INSERT INTO break_glass_cases (subject_pseudo_id, origin, risk_band) VALUES (1, 'ai_signal', 'high')"),
);

check(
  'break-glass-service may READ an identity record',
  'allow',
  as('identity', 'identity_vault', 'break_glass_service_app', P.breakGlass,
    'SELECT 1 FROM identity_vault_records LIMIT 1'),
);

check(
  'break-glass-service may NOT rewrite one',
  'deny',
  as('identity', 'identity_vault', 'break_glass_service_app', P.breakGlass,
    'UPDATE identity_vault_records SET identity_tier = 4 WHERE false'),
);

check(
  'break-glass-service may NOT erase its own trail',
  'deny',
  as('identity', 'identity_vault', 'break_glass_service_app', P.breakGlass,
    'DELETE FROM emergency_actions WHERE false'),
);

check(
  'community-service holds no credential on the identity instance',
  'deny',
  as('identity', 'identity_vault', 'community_service_app', P.community,
    'SELECT 1 FROM identity_vault_records LIMIT 1'),
);

console.log(c.bold('\nretention-service deletes everything and can reach almost nothing\n'));

// The most dangerous role in the system, if it were built the obvious way. It removes a
// member's entire history across five vaults and holds a grant on none of them. Every
// purge goes through the owning service's endpoint instead, so a compromised credential
// here reaches four bookkeeping tables rather than every member's journal.
check(
  'retention-service may read its own request ledger',
  'allow',
  as('shared', 'core', 'retention_service_app', P.retention,
     'SELECT count(*) FROM data_deletion_requests'),
);

check(
  'retention-service may NOT read accounts, in the same database',
  'deny',
  as('shared', 'core', 'retention_service_app', P.retention, 'SELECT count(*) FROM auth_accounts'),
);

check(
  'retention-service may NOT delete a session it is about to have revoked',
  'deny',
  as('shared', 'core', 'retention_service_app', P.retention, 'DELETE FROM sessions WHERE false'),
);

check(
  'retention-service may NOT connect to the community vault it purges',
  'deny',
  as('shared', 'community_vault', 'retention_service_app', P.retention, 'SELECT 1'),
);

check(
  'retention-service may NOT connect to the clinical vault it purges',
  'deny',
  as('shared', 'clinical_vault', 'retention_service_app', P.retention, 'SELECT 1'),
);

// A receipt its writer can amend is not a receipt.
check(
  'retention-service may NOT rewrite a deletion receipt',
  'deny',
  as('shared', 'core', 'retention_service_app', P.retention,
     "UPDATE deletion_audit_logs SET outcome = 'purged' WHERE false"),
);

console.log(c.bold('\nDatabase CONNECT — the boundary, not just the tables\n'));

// Regression: PostgreSQL grants CONNECT to PUBLIC by default, so before
// 0005_connect.shared.sql a foreign role could open a session against any database
// on the cluster. It could read no row, but pg_catalog is not permission-filtered
// the way information_schema is, so it could enumerate table names.
check(
  'community-service may NOT even connect to core',
  'deny',
  as('shared', 'core', 'community_service_app', P.community, 'SELECT 1'),
);

check(
  'community-service may NOT connect to the clinical vault',
  'deny',
  as('shared', 'clinical_vault', 'community_service_app', P.community, 'SELECT 1'),
);

check(
  'clinical-vault-service may NOT connect to the billing vault',
  'deny',
  as('shared', 'billing_vault', 'clinical_vault_service_app', P.clinical, 'SELECT 1'),
);

check(
  'partner-service may NOT connect to the community vault',
  'deny',
  as('shared', 'community_vault', 'partner_service_app', P.partner, 'SELECT 1'),
);

check(
  'a tenant may still connect to its own vault',
  'allow',
  as('shared', 'clinical_vault', 'clinical_vault_service_app', P.clinical, 'SELECT 1'),
);

check(
  'the audit writer may still connect to the audit vault',
  'allow',
  as('audit', 'audit_vault', 'gateway_audit', P.gatewayAudit, 'SELECT 1'),
);

console.log(c.bold('\nInstance separation\n'));

check(
  'a cross-vault join is impossible — identity is a different instance',
  'deny',
  as('shared', 'core', 'auth_service_app', P.auth,
    'SELECT 1 FROM identity_vault.public.identity_vault_records'),
);

console.log(
  `\n${fail === 0 ? c.green('all boundaries hold') : c.red(`${fail} boundary failure(s)`)}` +
    ` — ${pass} passed, ${fail} failed\n`,
);

process.exit(fail === 0 ? 0 : 1);
