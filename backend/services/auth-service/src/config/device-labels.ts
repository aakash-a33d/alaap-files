/**
 * Load the device label list.
 *
 * Small file, but the same rule as everywhere else in this repository: the strings a
 * member reads are metadata, not constants in a service. These particular strings are
 * also the only thing standing between a user-agent and the database, so the list
 * being reviewable matters more than its size suggests.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

import type { DeviceLabelPolicy } from '../domain/devices.ts';

interface RawPolicy {
  default_label: string;
  families: { label: string; all_of: string[] }[];
}

export function loadDeviceLabels(root: string): DeviceLabelPolicy {
  const path = resolve(root, 'metadata/auth/device-families.v1.yaml');
  const raw = parseYaml(readFileSync(path, 'utf8')) as RawPolicy;

  if (typeof raw.default_label !== 'string' || raw.default_label.length === 0) {
    throw new Error('device families: default_label is required');
  }

  const families = raw.families.map((f) => {
    if (typeof f.label !== 'string' || f.label.length === 0) {
      throw new Error(`device families: ${JSON.stringify(f)} has no label`);
    }
    if (!Array.isArray(f.all_of) || f.all_of.length === 0) {
      throw new Error(`device families: ${f.label} matches nothing`);
    }
    for (const needle of f.all_of) {
      // Matching is done against a lower-cased user-agent, so an upper-case needle
      // would never fire — a family that silently matches nothing reads as coverage
      // that is not there.
      if (typeof needle !== 'string' || needle !== needle.toLowerCase() || needle.length === 0) {
        throw new Error(
          `device families: ${f.label} matches on ${JSON.stringify(needle)}, which is not ` +
            `a non-empty lower-case string and would never match`,
        );
      }
    }
    return { label: f.label, allOf: f.all_of };
  });

  return { defaultLabel: raw.default_label, families };
}
