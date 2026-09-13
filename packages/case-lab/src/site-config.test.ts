import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SITE_CONFIG_FILE, SITE_CONFIG_SCHEMA_VERSION, loadSiteConfig } from './site-config.js';

const FULL = {
  schemaVersion: SITE_CONFIG_SCHEMA_VERSION,
  siteUrl: 'https://sutura-case-lab.vercel.app',
  googleSiteVerification: 'f7PZNffeQUHV6bvX9Pzff2dL0yT9iyxDqT83uHy3Dfg',
  bingSiteVerification: '9E58012EFDC70E5C8289C62F90BD646F',
  ga4MeasurementId: 'G-Z65T5Y173D',
  clarityProjectId: 'ydi0lx4kw6',
  vercelAnalytics: 'true',
};

function writeConfig(value: unknown, name = 'site.json'): string {
  const path = join(mkdtempSync(join(tmpdir(), 'case-lab-site-config-')), name);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  return path;
}

describe('loadSiteConfig', () => {
  it('reads every field and turns the vercelAnalytics flag into a boolean', () => {
    expect(loadSiteConfig(writeConfig(FULL))).toEqual({
      siteUrl: 'https://sutura-case-lab.vercel.app',
      googleSiteVerification: 'f7PZNffeQUHV6bvX9Pzff2dL0yT9iyxDqT83uHy3Dfg',
      bingSiteVerification: '9E58012EFDC70E5C8289C62F90BD646F',
      ga4MeasurementId: 'G-Z65T5Y173D',
      clarityProjectId: 'ydi0lx4kw6',
      vercelAnalytics: true,
    });
    expect(loadSiteConfig(writeConfig({ ...FULL, vercelAnalytics: 'false' })).vercelAnalytics).toBe(false);
  });

  it('accepts an empty config and leaves every field absent', () => {
    const config = loadSiteConfig(writeConfig({ schemaVersion: SITE_CONFIG_SCHEMA_VERSION }));
    expect(config).toEqual({});
    expect(Object.keys(config)).toEqual([]);
    const partial = loadSiteConfig(writeConfig({ schemaVersion: SITE_CONFIG_SCHEMA_VERSION, siteUrl: 'https://example.test' }));
    expect(partial).toEqual({ siteUrl: 'https://example.test' });
  });

  it('refuses a malformed prefix or shape with a message that names the file and the field', () => {
    const ga4 = writeConfig({ ...FULL, ga4MeasurementId: 'UA-12345-1' });
    expect(() => loadSiteConfig(ga4)).toThrow(RangeError);
    expect(() => loadSiteConfig(ga4)).toThrow(`${ga4}: ga4MeasurementId must be a Google Analytics 4 measurement id starting with G-, received "UA-12345-1"`);
    const bing = writeConfig({ ...FULL, bingSiteVerification: 'not-hex' });
    expect(() => loadSiteConfig(bing)).toThrow(`${bing}: bingSiteVerification must be the 32 hex character content`);
    const google = writeConfig({ ...FULL, googleSiteVerification: 'has spaces and <tags>' });
    expect(() => loadSiteConfig(google)).toThrow(`${google}: googleSiteVerification must be`);
    const clarity = writeConfig({ ...FULL, clarityProjectId: 'UPPER' });
    expect(() => loadSiteConfig(clarity)).toThrow(`${clarity}: clarityProjectId must be`);
    const number = writeConfig({ ...FULL, clarityProjectId: 42 });
    expect(() => loadSiteConfig(number)).toThrow(`${number}: clarityProjectId must be a Microsoft Clarity project id (lowercase letters and digits), received 42`);
    const vercel = writeConfig({ ...FULL, vercelAnalytics: true });
    expect(() => loadSiteConfig(vercel)).toThrow(`${vercel}: vercelAnalytics must be "true" or "false", received true`);
    const slash = writeConfig({ ...FULL, siteUrl: 'https://sutura-case-lab.vercel.app/' });
    expect(() => loadSiteConfig(slash)).toThrow(`${slash}: siteUrl must not end with /`);
    const ftp = writeConfig({ ...FULL, siteUrl: 'ftp://sutura-case-lab.vercel.app' });
    expect(() => loadSiteConfig(ftp)).toThrow(`${ftp}: siteUrl must be an absolute http(s) origin`);
  });

  it('refuses a wrong schema, an unknown field, a non-object, invalid JSON, and a missing file', () => {
    const schema = writeConfig({ ...FULL, schemaVersion: 'sutura-case-lab-site-v0' });
    expect(() => loadSiteConfig(schema)).toThrow(`${schema}: schemaVersion must be "sutura-case-lab-site-v1"`);
    const unknown = writeConfig({ ...FULL, ga4measurementId: 'G-1234' });
    expect(() => loadSiteConfig(unknown)).toThrow(`${unknown}: ga4measurementId is not a known field`);
    const array = writeConfig([FULL]);
    expect(() => loadSiteConfig(array)).toThrow(`${array}: must be a JSON object`);
    const invalid = writeConfig('{');
    expect(() => loadSiteConfig(invalid)).toThrow(`${invalid} is not valid JSON`);
    const missing = join(mkdtempSync(join(tmpdir(), 'case-lab-site-config-')), 'nope.json');
    expect(() => loadSiteConfig(missing)).toThrow(`${missing} is missing`);
  });

  it('loads the committed site.json with the public identifiers', () => {
    const committed = loadSiteConfig(SITE_CONFIG_FILE);
    expect(committed.siteUrl).toBe('https://sutura-case-lab.vercel.app');
    expect(committed.ga4MeasurementId).toMatch(/^G-/u);
    expect(committed.vercelAnalytics).toBe(true);
  });
});
