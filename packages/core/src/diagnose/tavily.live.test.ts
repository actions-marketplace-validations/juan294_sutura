import { describe, expect, it } from 'vitest';

import { TavilyClient, ground } from './tavily.js';

const LIVE = process.env.SUTURA_LIVE === '1';

describe.skipIf(!LIVE)('Tavily live search', () => {
  it('returns a relevant citation for a Vitest assertion error', async () => {
    const tavily = new TavilyClient(process.env.TAVILY_API_KEY);

    const citations = await tavily.search(
      'Vitest AssertionError expected value to equal received value debugging',
      { maxResults: 3 },
    );

    expect(citations.length).toBeGreaterThanOrEqual(1);
    expect(citations[0]).toMatchObject({
      title: expect.any(String),
      url: expect.stringMatching(/^https?:\/\//),
      snippet: expect.any(String),
    });
    expect(
      citations.some((citation) =>
        /vitest|assert|expect|test/i.test(`${citation.title} ${citation.snippet}`),
      ),
    ).toBe(true);
  });

  it('returns the exact Execa 6 release grounding used by upstream-retry-release', async () => {
    const tavily = new TavilyClient(process.env.TAVILY_API_KEY);

    const grounding = await ground(
      tavily,
      {
        class: 'dep-upstream-breaking',
        confidence: 0.8,
        signals: ['TypeError: execa is not a function'],
        failingCmd: 'vitest run',
        errorExcerpt: 'TypeError: execa is not a function',
      },
      { tavilyEnabled: true, dependencyHints: ['execa@6.0.0'] },
    );

    expect(grounding.query).toBe('execa@6.0.0 TypeError: execa is not a function');
    expect(grounding.citations).toContainEqual(expect.objectContaining({
      url: 'https://github.com/sindresorhus/execa/releases/tag/v6.0.0',
    }));
  });
});
