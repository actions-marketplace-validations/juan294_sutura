import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCaseLabCli, USAGE } from './cli.js';
import { validateCaseLabResult } from './result.js';

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { write: (text: string) => { out.push(text); }, writeError: (text: string) => { err.push(text); } } };
}

const EMPTY_REPLAY_DIR = mkdtempSync(join(tmpdir(), 'case-lab-cli-no-replay-'));
const NOW = () => new Date('2026-09-04T12:00:00.000Z');

describe('case-lab CLI', () => {
  it('writes the five-case catalog and refuses to overwrite it', { timeout: 60_000 }, async () => {
    const outDir = join(mkdtempSync(join(tmpdir(), 'case-lab-cli-')), 'catalog');
    const first = io();
    const code = await runCaseLabCli(['catalog', '--out', outDir], { io: first.io, catalog: { replayDir: EMPTY_REPLAY_DIR, now: NOW } });
    expect(code).toBe(0);
    expect(readdirSync(outDir).sort()).toEqual([
      'flaky-failure.json', 'greenwash-trap.json', 'javascript-repair.json', 'python-repair.json', 'upstream-incident.json',
    ]);
    for (const file of readdirSync(outDir)) {
      validateCaseLabResult(JSON.parse(readFileSync(join(outDir, file), 'utf8')));
    }
    expect(first.out.join('')).toContain('greenwash-trap\trecorded\trefused\n');
    const second = io();
    expect(await runCaseLabCli(['catalog', '--out', outDir], { io: second.io, catalog: { replayDir: EMPTY_REPLAY_DIR, now: NOW } })).toBe(1);
    expect(second.err.join('')).toContain('EEXIST');
  });

  it('prints or writes one deterministic result', { timeout: 60_000 }, async () => {
    const printed = io();
    expect(await runCaseLabCli(['replay', 'flaky-failure'], { io: printed.io, catalog: { replayDir: EMPTY_REPLAY_DIR, now: NOW } })).toBe(0);
    const result = validateCaseLabResult(JSON.parse(printed.out.join('')));
    expect(result.caseId).toBe('flaky-failure');
    const file = join(mkdtempSync(join(tmpdir(), 'case-lab-cli-')), 'result.json');
    expect(await runCaseLabCli(['replay', 'flaky-failure', '--out', file], { catalog: { replayDir: EMPTY_REPLAY_DIR, now: NOW } })).toBe(0);
    expect(existsSync(file)).toBe(true);
  });

  it('reports usage and argument errors with exit code 2', async () => {
    const unknown = io();
    expect(await runCaseLabCli(['nope'], { io: unknown.io })).toBe(2);
    expect(unknown.err.join('')).toBe(`${USAGE}\n`);
    const missing = io();
    expect(await runCaseLabCli(['catalog'], { io: missing.io })).toBe(2);
    expect(missing.err.join('')).toBe('--out is required\n');
    const badCase = io();
    expect(await runCaseLabCli(['replay', 'nope'], { io: badCase.io, catalog: { replayDir: EMPTY_REPLAY_DIR } })).toBe(2);
    expect(badCase.err.join('')).toContain('caseId must be one of');
    const noCase = io();
    expect(await runCaseLabCli(['replay', '--out', 'x'], { io: noCase.io })).toBe(2);
    expect(noCase.err.join('')).toContain('replay requires a case id');
  });

  it('refuses a site URL with a trailing slash before writing the site', { timeout: 60_000 }, async () => {
    const outDir = join(mkdtempSync(join(tmpdir(), 'case-lab-cli-')), 'site');
    const bad = io();
    const code = await runCaseLabCli(['build-site', '--out', outDir, '--site-url', 'https://sutura-case-lab.vercel.app/'], {
      io: bad.io,
      catalog: { replayDir: EMPTY_REPLAY_DIR, now: NOW },
    });
    expect(code).toBe(1);
    expect(bad.err.join('')).toContain('siteUrl must not end with /');
    expect(existsSync(join(outDir, 'index.html'))).toBe(false);
  });

  it('reads --site-config for the default site URL and the identifiers, and lets --site-url win', { timeout: 120_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'case-lab-cli-config-'));
    const configPath = join(dir, 'site.json');
    writeFileSync(configPath, JSON.stringify({
      schemaVersion: 'sutura-case-lab-site-v1',
      siteUrl: 'https://config.example.test',
      googleSiteVerification: 'google-token-for-tests_0123456789',
      ga4MeasurementId: 'G-CLI12345',
      vercelAnalytics: 'false',
    }));
    const outDir = join(dir, 'site');
    const fromConfig = io();
    expect(await runCaseLabCli(['build-site', '--out', outDir, '--site-config', configPath], {
      io: fromConfig.io, catalog: { replayDir: EMPTY_REPLAY_DIR, now: NOW },
    })).toBe(0);
    const index = readFileSync(join(outDir, 'index.html'), 'utf8');
    expect(index).toContain('<link rel="canonical" href="https://config.example.test/">');
    expect(index).toContain('<meta name="google-site-verification" content="google-token-for-tests_0123456789">');
    expect(index).toContain('gtag/js?id=G-CLI12345');
    expect(index).not.toContain('msvalidate.01');
    expect(index).not.toContain('clarity');
    expect(index).not.toContain('_vercel/insights');
    const overridden = io();
    expect(await runCaseLabCli(['build-site', '--out', outDir, '--site-config', configPath, '--site-url', 'https://flag.example.test'], {
      io: overridden.io, catalog: { replayDir: EMPTY_REPLAY_DIR, now: NOW },
    })).toBe(0);
    expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toContain('<link rel="canonical" href="https://flag.example.test/">');
    const malformedPath = join(dir, 'bad.json');
    writeFileSync(malformedPath, JSON.stringify({ schemaVersion: 'sutura-case-lab-site-v1', ga4MeasurementId: 'UA-1' }));
    const malformed = io();
    expect(await runCaseLabCli(['build-site', '--out', join(dir, 'never'), '--site-config', malformedPath], {
      io: malformed.io, catalog: { replayDir: EMPTY_REPLAY_DIR, now: NOW },
    })).toBe(1);
    expect(malformed.err.join('')).toBe(`${malformedPath}: ga4MeasurementId must be a Google Analytics 4 measurement id starting with G-, received "UA-1"\n`);
    expect(existsSync(join(dir, 'never'))).toBe(false);
    const missing = io();
    expect(await runCaseLabCli(['build-site', '--out', join(dir, 'never'), '--site-config', join(dir, 'absent.json')], {
      io: missing.io, catalog: { replayDir: EMPTY_REPLAY_DIR, now: NOW },
    })).toBe(1);
    expect(missing.err.join('')).toBe(`${join(dir, 'absent.json')} is missing at ${join(dir, 'absent.json')}\n`);
  });

  it('builds from the committed site.json by default with the public identifiers', { timeout: 120_000 }, async () => {
    const outDir = join(mkdtempSync(join(tmpdir(), 'case-lab-cli-default-')), 'site');
    const run = io();
    expect(await runCaseLabCli(['build-site', '--out', outDir, '--api-base', ''], {
      io: run.io, catalog: { replayDir: EMPTY_REPLAY_DIR, now: NOW },
    })).toBe(0);
    const index = readFileSync(join(outDir, 'index.html'), 'utf8');
    expect(index).toContain('<link rel="canonical" href="https://sutura-case-lab.vercel.app/">');
    expect(index).toContain('<meta name="google-site-verification" content="f7PZNffeQUHV6bvX9Pzff2dL0yT9iyxDqT83uHy3Dfg">');
    expect(index).toContain('<meta name="msvalidate.01" content="9E58012EFDC70E5C8289C62F90BD646F">');
    expect(index).toContain('gtag/js?id=G-Z65T5Y173D');
    expect(index).toContain("'clarity', 'script', \"ydi0lx4kw6\")");
    expect(index).toContain('/_vercel/insights/script.js');
    expect(index).toContain('data-api-base="" data-consent="ga4,clarity"');
  });
});
