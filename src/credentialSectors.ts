/**
 * Resolve RP sectors from FIDES credential catalog via acceptedCredentialRefs (cred:… IDs),
 * with fallback from legacy RP-catalog sector enums.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/** Canonical sector codes — keep aligned with credential-catalog / organization-catalog schema. */
export const CANONICAL_SECTOR_CODES = [
  'public_sector',
  'finance',
  'trade',
  'supply_chain',
  'manufacturing',
  'energy',
  'agriculture',
  'food',
  'retail',
  'healthcare',
  'education',
  'construction',
  'mobility',
  'digital'
] as const;

const CANONICAL_SET = new Set<string>(CANONICAL_SECTOR_CODES);

/** Legacy RP schema sector values → canonical credential/org sector code. */
const LEGACY_RP_SECTOR_MAP: Record<string, string> = {
  government: 'public_sector',
  finance: 'finance',
  healthcare: 'healthcare',
  education: 'education',
  retail: 'retail',
  travel: 'mobility',
  hospitality: 'retail',
  employment: 'digital',
  telecom: 'digital',
  utilities: 'energy',
  insurance: 'finance',
  'real-estate': 'construction',
  automotive: 'mobility',
  entertainment: 'retail',
  other: 'digital'
};

export type CredentialSectorMap = Map<string, string[]>;

interface CredentialAggregated {
  credentials?: Array<{ id?: string; sectors?: string[] }>;
}

function buildSectorMapFromRows(
  credentials: Array<{ id?: string; sectors?: string[] }>
): CredentialSectorMap {
  const map: CredentialSectorMap = new Map();
  for (const c of credentials) {
    if (c.id && Array.isArray(c.sectors)) {
      const filtered = c.sectors.filter((s): s is string => typeof s === 'string' && CANONICAL_SET.has(s));
      map.set(c.id, filtered);
    }
  }
  return map;
}

/**
 * Load credential id → sectors[] from local file, env URL, or GitHub main.
 */
export async function loadCredentialSectorMap(cwd: string): Promise<CredentialSectorMap> {
  const tryParse = (raw: string) => {
    const data = JSON.parse(raw) as CredentialAggregated;
    return buildSectorMapFromRows(data.credentials || []);
  };

  const localPath =
    process.env.CREDENTIAL_CATALOG_PATH ||
    path.join(cwd, '..', 'credential-catalog', 'data', 'aggregated.json');

  try {
    const raw = await fs.readFile(localPath, 'utf-8');
    const map = tryParse(raw);
    console.log(`   📎 Credential sectors: loaded ${map.size} credential type(s) from ${localPath}`);
    return map;
  } catch {
    // continue to remote fallbacks
  }

  const url =
    process.env.CREDENTIAL_CATALOG_URL ||
    'https://raw.githubusercontent.com/FIDEScommunity/fides-credential-catalog/main/data/aggregated.json';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const map = tryParse(await res.text());
    console.log(`   📎 Credential sectors: loaded ${map.size} credential type(s) from ${url}`);
    return map;
  } catch (e) {
    console.warn('   ⚠️  Credential catalog not loaded; RP sectors use legacy mapping only:', e);
  }

  return new Map();
}

function extractCredentialRefIds(rp: Record<string, unknown>): string[] {
  const out: string[] = [];
  const refs = rp.acceptedCredentialRefs ?? rp.credentialRefs;
  if (!Array.isArray(refs)) return out;
  for (const item of refs) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = o.credentialCatalogId ?? o.id;
    if (typeof id === 'string' && id.startsWith('cred:')) out.push(id);
  }
  return out;
}

function sectorsFromRefs(refIds: string[], credMap: CredentialSectorMap): string[] {
  const set = new Set<string>();
  for (const id of refIds) {
    const segs = credMap.get(id);
    if (segs) {
      for (const s of segs) set.add(s);
    }
  }
  return [...set].sort();
}

export function mapLegacyRpSectors(sectors: string[] | undefined): string[] {
  const set = new Set<string>();
  for (const s of sectors || []) {
    if (CANONICAL_SET.has(s)) {
      set.add(s);
      continue;
    }
    const mapped = LEGACY_RP_SECTOR_MAP[s];
    if (mapped) set.add(mapped);
  }
  return [...set].sort();
}

/**
 * Canonical sectors: from acceptedCredentialRefs (and legacy credentialRefs) when any cred:… ID
 * resolves in the credential catalog; otherwise legacy `sectors` on the RP JSON.
 */
export function resolveCanonicalSectors(rp: Record<string, unknown>, credMap: CredentialSectorMap): string[] {
  const fromRefs = sectorsFromRefs(extractCredentialRefIds(rp), credMap);
  if (fromRefs.length > 0) return fromRefs;
  const raw = rp.sectors;
  const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  return mapLegacyRpSectors(list);
}
