import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const metadataUrl = new URL('../action.yml', import.meta.url);
const rootMetadataUrl = new URL('../../../action.yml', import.meta.url);

describe('GitHub Action metadata', () => {
  it('uses the supported Node 24 runtime and committed CommonJS bundle', async () => {
    const metadata = await readFile(metadataUrl, 'utf8');

    expect(metadata).toMatch(/^runs:\n  using: node24\n  main: dist\/index\.cjs$/m);
  });

  it('publishes equivalent metadata at the repository root', async () => {
    const metadata = await readFile(metadataUrl, 'utf8');
    const rootMetadata = await readFile(rootMetadataUrl, 'utf8');

    expect(rootMetadata).toBe(metadata.replace('main: dist/index.cjs', 'main: packages/action/dist/index.cjs'));
  });

  it('declares every mapped input and the outcome output', async () => {
    const metadata = await readFile(metadataUrl, 'utf8');

    for (const input of [
      'github-token',
      'run-id',
      'nebius-api-key',
      'tavily-api-key',
      'contree-token',
      'contree-project',
      'triage-n',
      'routing-profile',
      'require-fixed',
      'capture-replay',
      'model-nano',
      'model-super',
      'model-ultra',
    ]) {
      expect(metadata).toContain(`  ${input}:\n`);
    }
    expect(metadata).toContain('outputs:\n  outcome:\n');
    expect(metadata).toContain('  require-fixed:\n');
  });

  it('declares complete GitHub Marketplace identity and supported branding', async () => {
    const metadata = await readFile(metadataUrl, 'utf8');

    expect(metadata).toMatch(/^name: Sutura Verified Self-Healing CI$/mu);
    expect(metadata).toMatch(/^description: .{40,125}$/mu);
    expect(metadata).toMatch(/^author: Sutura$/mu);
    expect(metadata).toMatch(/^branding:\n  icon: activity\n  color: red$/mu);
  });
});
