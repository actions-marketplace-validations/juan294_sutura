/**
 * Public site identifiers read from `site.json`: the canonical origin, search
 * engine verification tokens, and analytics ids. Every value appears in the
 * served HTML, so none is a secret. Every field is optional; a missing field
 * renders nothing.
 */
import { resolve } from 'node:path';

import type { SiteIdentifiers } from './render.js';
import { PACKAGE_DIR } from './replay.js';
import { assertSiteUrl } from './site.js';
import { isRecord, readBoundedJson } from './util.js';

export const SITE_CONFIG_SCHEMA_VERSION = 'sutura-case-lab-site-v1' as const;
export const SITE_CONFIG_FILE = resolve(PACKAGE_DIR, 'site.json');
const MAX_SITE_CONFIG_BYTES = 4_096;

export interface SiteConfig extends SiteIdentifiers {
  /** Absolute origin of the deployed site without a trailing slash. */
  readonly siteUrl?: string;
}

/** Field name, allowed shape, and the reason a value is refused. */
const STRING_FIELDS: Readonly<Record<Exclude<keyof SiteConfig, 'vercelAnalytics'>, { readonly pattern: RegExp; readonly expected: string }>> = Object.freeze({
  siteUrl: { pattern: /^https?:\/\//u, expected: 'an absolute http(s) origin' },
  googleSiteVerification: { pattern: /^[A-Za-z0-9_-]{16,128}$/u, expected: 'the content of the google-site-verification meta tag (letters, digits, - and _)' },
  bingSiteVerification: { pattern: /^[A-Fa-f0-9]{32}$/u, expected: 'the 32 hex character content of the msvalidate.01 meta tag' },
  ga4MeasurementId: { pattern: /^G-[A-Z0-9]{4,32}$/u, expected: 'a Google Analytics 4 measurement id starting with G-' },
  clarityProjectId: { pattern: /^[a-z0-9]{4,32}$/u, expected: 'a Microsoft Clarity project id (lowercase letters and digits)' },
});

const KNOWN_FIELDS = new Set<string>(['schemaVersion', ...Object.keys(STRING_FIELDS), 'vercelAnalytics']);

function refuse(path: string, field: string, reason: string): RangeError {
  return new RangeError(`${path}: ${field} ${reason}`);
}

/** Read and validate `site.json`. Errors name the file and the field. */
export function loadSiteConfig(path: string): SiteConfig {
  const { value } = readBoundedJson(path, MAX_SITE_CONFIG_BYTES, path, (message) => new RangeError(message));
  if (!isRecord(value)) throw new RangeError(`${path}: must be a JSON object`);
  if (value.schemaVersion !== SITE_CONFIG_SCHEMA_VERSION) {
    throw refuse(path, 'schemaVersion', `must be ${JSON.stringify(SITE_CONFIG_SCHEMA_VERSION)}`);
  }
  for (const key of Object.keys(value)) {
    if (!KNOWN_FIELDS.has(key)) throw refuse(path, key, `is not a known field (expected one of ${[...KNOWN_FIELDS].join(', ')})`);
  }
  const config: { -readonly [K in keyof SiteConfig]?: SiteConfig[K] } = {};
  for (const [field, rule] of Object.entries(STRING_FIELDS) as [Exclude<keyof SiteConfig, 'vercelAnalytics'>, { pattern: RegExp; expected: string }][]) {
    const raw = value[field];
    if (raw === undefined) continue;
    if (typeof raw !== 'string' || !rule.pattern.test(raw)) throw refuse(path, field, `must be ${rule.expected}, received ${JSON.stringify(raw)}`);
    if (field === 'siteUrl') {
      try {
        assertSiteUrl(raw);
      } catch (error) {
        throw refuse(path, field, error instanceof Error ? error.message.replace(/^siteUrl /u, '') : String(error));
      }
    }
    config[field] = raw;
  }
  const vercel = value.vercelAnalytics;
  if (vercel !== undefined) {
    if (vercel !== 'true' && vercel !== 'false') throw refuse(path, 'vercelAnalytics', `must be "true" or "false", received ${JSON.stringify(vercel)}`);
    config.vercelAnalytics = vercel === 'true';
  }
  return config;
}
