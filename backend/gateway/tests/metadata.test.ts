/**
 * The route policy contract.
 *
 * These run against the real metadata/ files, not fixtures. That is the point: they
 * fail when someone edits a YAML file into an inconsistent state, which is the
 * failure mode the boot cross-check exists to prevent.
 */

import { describe, expect, it } from 'vitest';

import { loadMetadata } from '../src/config/metadata.ts';

const metadata = loadMetadata();

describe('metadata cross-check', () => {
  it('loads and validates every registry', () => {
    expect(metadata.groups.length).toBeGreaterThan(0);
    expect(metadata.purposes.size).toBeGreaterThan(0);
    // Seventeen domain services, the AI orchestrator, and the gateway itself
    // (backend/README.md). Asserted by NAME rather than by count: a bare number tells
    // whoever it fails on nothing about which service appeared or vanished, and the
    // honest fix for it is always to edit the number.
    const services = [...metadata.serviceGroups.keys()].filter((id) => id !== 'gateway');
    expect(services).toContain('ai-orchestrator');
    expect(services).toContain('auth-service');
    expect(services).toContain('pseudonym-service');
    expect(metadata.serviceGroups.size).toBe(services.length + 1);
  });

  it('never routes to the gateway itself', () => {
    for (const group of metadata.groups) {
      expect(group.service).not.toBe('gateway');
    }
  });

  it('never routes to an internal-only service', () => {
    // identity-vault-service and audit-service declare api_groups: [] precisely so
    // the frontend cannot reach them. If either ever appears in a route, the
    // identity vault has become internet-reachable.
    const internal = [...metadata.serviceGroups.entries()]
      .filter(([, groups]) => groups.length === 0)
      .map(([id]) => id);

    expect(internal).toContain('identity-vault-service');
    expect(internal).toContain('audit-service');

    for (const group of metadata.groups) {
      expect(internal).not.toContain(group.service);
    }
  });

  it('declares a registered purpose for every audited group', () => {
    for (const group of metadata.groups) {
      if (group.audit === 'none') continue;
      expect(group.purpose, `${group.prefix} is audited`).toBeDefined();
      expect(metadata.purposes.has(group.purpose!), `${group.purpose} registered`).toBe(true);
    }
  });

  it('permits at least one role on every authenticated group', () => {
    for (const group of metadata.groups) {
      if (group.authentication === 'none') continue;
      expect(group.roles.length, `${group.prefix} is reachable`).toBeGreaterThan(0);
    }
  });

  it('requires step-up on the groups that disclose or destroy', () => {
    const stepUp = metadata.groups.filter((g) => g.stepUp).map((g) => g.prefix);
    expect(stepUp).toContain('/api/break-glass');
    expect(stepUp).toContain('/api/data-rights');
    expect(stepUp).toContain('/api/admin');
  });

  it('audits every read on the highest-sensitivity groups', () => {
    for (const prefix of ['/api/break-glass', '/api/admin', '/api/safety', '/api/moderator']) {
      const group = metadata.groups.find((g) => g.prefix === prefix);
      expect(group?.audit, `${prefix} audit level`).toBe('all');
    }
  });

  it('routes the private writing surfaces to the clinical vault', () => {
    // Journal and short stories are paid surfaces, but the gateway does not know
    // that and must not: entitlement needs a plan tier, and the gateway holds no
    // billing credentials. It routes; clinical-vault-service refuses.
    for (const prefix of ['/api/journal', '/api/stories']) {
      const group = metadata.groups.find((g) => g.prefix === prefix);
      expect(group?.service, prefix).toBe('clinical-vault-service');
      expect(group?.roles, prefix).toEqual(['user']);
      expect(group?.audit, `${prefix} is audited by the owning service, not here`).toBe('none');
    }
  });

  it('leaves /api/auth reachable without a session', () => {
    const auth = metadata.groups.find((g) => g.prefix === '/api/auth');
    expect(auth?.authentication).toBe('none');
    expect(auth?.roles).toEqual([]);
  });
});
