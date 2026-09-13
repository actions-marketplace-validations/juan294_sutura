import type { Diagnosis, Grounding } from '../domain.js';
import type { HttpRequestInit, HttpResponse } from '../llm/nebius.js';
import { redactExternalText } from '../security/external-text.js';
import { trimTrailing } from '../text/trim-edge.js';

const DEFAULT_BASE_URL = 'https://api.tavily.com';
const WEB_HELPFUL_CLASSES = new Set(['dep-upstream-breaking', 'env-config', 'build']);
const DEPENDENCY_NOT_FUNCTION = /\bTypeError:\s+[@\w$./-]+\s+is not a function\b/i;
const VERSION_PATTERN_SOURCE = '[~^]?\\d+\\.\\d+\\.\\d+(?:-[\\w.-]+)?';
const NESTED_SPECIFIER = new RegExp(
  `^specifier:\\s*(?<version>${VERSION_PATTERN_SOURCE})$`,
  'i',
);
const PACKAGE_VERSION_KEY = new RegExp(
  `^["']?(?<package>@?[a-z0-9][\\w./-]*)@(?<version>${VERSION_PATTERN_SOURCE})["']?:$`,
  'i',
);
const PACKAGE_VERSION_VALUE = new RegExp(
  `^["']?(?<package>@?[a-z0-9][\\w./-]*)["']?:\\s*(?<version>${VERSION_PATTERN_SOURCE})$`,
  'i',
);
const MAX_QUERY_CHARACTERS = 2_000;
const MAX_ERROR_QUERY_CHARACTERS = 1_000;
const MAX_RELEASE_CITATION_TITLE_CHARACTERS = 255;
const MAX_RELEASE_CITATION_SNIPPET_CHARACTERS = 2_000;

export type TavilyHttpResponse = Pick<HttpResponse, 'ok' | 'status' | 'json'>;
export type TavilyHttpRequestInit = Omit<HttpRequestInit, 'body'> & { body?: string };

export type TavilyFetch = (
  input: string,
  init: TavilyHttpRequestInit,
) => Promise<TavilyHttpResponse>;

export interface TavilyClientDependencies {
  fetch?: TavilyFetch;
  baseUrl?: string;
}

export interface TavilySearchOptions {
  maxResults?: number;
}

export type TavilyCitation = Grounding['citations'][number];

export interface TavilySearch {
  search(query: string, options?: TavilySearchOptions): Promise<TavilyCitation[]>;
  extract?(urls: readonly string[], query: string): Promise<TavilyCitation[]>;
  packageRepository?(name: string, version: string): Promise<string | null>;
}

export interface GroundOptions {
  tavilyEnabled: boolean;
  lockfileDiff?: string;
  dependencyHints?: readonly string[];
}

export class TavilyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TavilyConfigError';
  }
}

export class TavilyRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TavilyRequestError';
  }
}

interface TavilyExtractResult {
  url: string;
  raw_content: string;
}

function githubRepository(value: unknown): string | null {
  const raw = typeof value === 'string'
    ? value
    : typeof value === 'object' && value !== null && typeof (value as { url?: unknown }).url === 'string'
      ? (value as { url: string }).url
      : null;
  if (!raw) return null;
  const normalized = raw
    .replace(/^git\+/u, '')
    .replace(/^git:\/\/github\.com\//u, 'https://github.com/')
    .replace(/^git@github\.com:/u, 'https://github.com/');
  try {
    const url = new URL(normalized);
    const [owner, repository, ...extra] = url.pathname.split('/').filter(Boolean);
    if (url.hostname !== 'github.com' || !owner || !repository || extra.length > 0) return null;
    return `https://github.com/${owner}/${repository.replace(/\.git$/u, '')}`;
  } catch {
    return null;
  }
}

function endpoint(baseUrl: string): string {
  return `${trimTrailing(baseUrl, '/')}/search`;
}

function isCitation(value: unknown): value is {
  title: string;
  url: string;
  content: string;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    typeof result.title === 'string' &&
    typeof result.url === 'string' &&
    /^https?:\/\//.test(result.url) &&
    typeof result.content === 'string'
  );
}

export class TavilyClient implements TavilySearch {
  private readonly apiKey: string | undefined;
  private readonly fetch: TavilyFetch;
  private readonly baseUrl: string;

  constructor(
    apiKey: string | undefined,
    dependencies: TavilyClientDependencies = {},
  ) {
    const runtimeFetch = (globalThis as unknown as { fetch?: TavilyFetch }).fetch;
    if (!dependencies.fetch && !runtimeFetch) {
      throw new TavilyConfigError('This runtime does not provide fetch');
    }
    this.apiKey = apiKey?.trim() || undefined;
    this.fetch = dependencies.fetch ?? (runtimeFetch as TavilyFetch);
    this.baseUrl = dependencies.baseUrl ?? DEFAULT_BASE_URL;
  }

  async search(
    query: string,
    { maxResults = 5 }: TavilySearchOptions = {},
  ): Promise<TavilyCitation[]> {
    if (!this.apiKey?.trim()) {
      throw new TavilyConfigError('Tavily grounding requires TAVILY_API_KEY');
    }
    if (!Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > 20) {
      throw new RangeError('maxResults must be an integer from 1 to 20');
    }
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new RangeError('query must not be empty');
    }

    const searchEndpoint = endpoint(this.baseUrl);
    const request: TavilyHttpRequestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: normalizedQuery,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: false,
      }),
    };
    let response: TavilyHttpResponse;
    try {
      response = await this.fetch(searchEndpoint, request);
      if (response.status === 403) {
        const forbidden = new TavilyRequestError(
          'Tavily search request failed with status 403',
          403,
        );
        response = await this.fetch(searchEndpoint, request);
        if (response.status === 403) throw forbidden;
      }
    } catch (error) {
      if (error instanceof TavilyRequestError) throw error;
      throw new TavilyRequestError('Tavily search request failed');
    }

    if (!response.ok) {
      throw new TavilyRequestError(
        `Tavily search request failed with status ${response.status}`,
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TavilyRequestError('Tavily search returned an invalid response');
    }
    if (typeof body !== 'object' || body === null) {
      throw new TavilyRequestError('Tavily search returned an invalid response');
    }

    const results = (body as { results?: unknown }).results;
    if (!Array.isArray(results)) {
      throw new TavilyRequestError('Tavily search returned an invalid response');
    }

    return results.filter(isCitation).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.content.slice(0, 2_000),
    }));
  }

  async extract(urls: readonly string[], query: string): Promise<TavilyCitation[]> {
    if (!this.apiKey?.trim()) {
      throw new TavilyConfigError('Tavily grounding requires TAVILY_API_KEY');
    }
    const safeUrls = [...new Set(urls)].filter((url) => /^https:\/\/github\.com\//u.test(url));
    if (safeUrls.length === 0 || safeUrls.length > 10) {
      throw new RangeError('urls must contain from 1 to 10 GitHub URLs');
    }
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new RangeError('query must not be empty');

    let response: TavilyHttpResponse;
    try {
      response = await this.fetch(`${trimTrailing(this.baseUrl, '/')}/extract`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          urls: safeUrls,
          query: normalizedQuery,
          chunks_per_source: 3,
          extract_depth: 'basic',
          format: 'markdown',
          include_images: false,
        }),
      });
    } catch {
      throw new TavilyRequestError('Tavily extract request failed');
    }
    if (!response.ok) {
      throw new TavilyRequestError(
        `Tavily extract request failed with status ${response.status}`,
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TavilyRequestError('Tavily extract returned an invalid response');
    }
    if (typeof body !== 'object' || body === null) {
      throw new TavilyRequestError('Tavily extract returned an invalid response');
    }
    const results = (body as { results?: unknown }).results;
    if (!Array.isArray(results)) {
      throw new TavilyRequestError('Tavily extract returned an invalid response');
    }
    return results
      .filter((value): value is TavilyExtractResult => {
        if (typeof value !== 'object' || value === null) return false;
        const result = value as Record<string, unknown>;
        return typeof result.url === 'string' &&
          safeUrls.includes(result.url) &&
          typeof result.raw_content === 'string' &&
          result.raw_content.trim().length > 0;
      })
      .map((result) => ({
        title: `GitHub release: ${new URL(result.url).pathname.split('/').at(-1) ?? 'release'}`,
        url: result.url,
        snippet: result.raw_content.trim().slice(0, MAX_RELEASE_CITATION_SNIPPET_CHARACTERS),
      }));
  }

  async packageRepository(name: string, version: string): Promise<string | null> {
    if (!/^@?[a-z0-9][\w./-]*$/iu.test(name) || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(version)) {
      throw new RangeError('package name and version must be valid');
    }
    try {
      const response = await this.fetch(
        `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
        },
      );
      if (!response.ok) return null;
      const body = await response.json();
      if (typeof body !== 'object' || body === null) return null;
      const metadata = body as Record<string, unknown>;
      if (metadata.name !== name || metadata.version !== version) return null;
      return githubRepository(metadata.repository);
    } catch {
      return null;
    }
  }
}

function packageVersions(lockfileDiff: string, characterBudget: number): string[] {
  const versions = new Set<string>();
  let pendingPackage: { name: string; indent: number } | undefined;
  let usedCharacters = 0;

  function addVersion(value: string): boolean {
    if (versions.has(value)) {
      return true;
    }
    const cost = value.length + (versions.size === 0 ? 0 : 1);
    if (cost > characterBudget - usedCharacters) {
      return false;
    }
    versions.add(value);
    usedCharacters += cost;
    return true;
  }

  for (let cursor = 0; cursor <= lockfileDiff.length; ) {
    const nextNewline = lockfileDiff.indexOf('\n', cursor);
    const end = nextNewline === -1 ? lockfileDiff.length : nextNewline;
    const rawLine = lockfileDiff.slice(cursor, end).replace(/\r$/, '');
    cursor = nextNewline === -1 ? lockfileDiff.length + 1 : end + 1;
    if (!rawLine.startsWith('+') || rawLine.startsWith('+++')) {
      continue;
    }
    const addedLine = rawLine.slice(1);
    const indent = /^\s*/.exec(addedLine)?.[0].length ?? 0;
    const line = addedLine.trim();
    const nestedVersion = NESTED_SPECIFIER.exec(line);
    if (
      pendingPackage &&
      indent > pendingPackage.indent &&
      nestedVersion?.groups?.version
    ) {
      if (!addVersion(`${pendingPackage.name}@${nestedVersion.groups.version}`)) {
        break;
      }
      continue;
    }
    if (pendingPackage && indent <= pendingPackage.indent) {
      pendingPackage = undefined;
    }

    const keyMatch = PACKAGE_VERSION_KEY.exec(line);
    const valueMatch = PACKAGE_VERSION_VALUE.exec(line);
    const match = keyMatch ?? valueMatch;
    if (
      match?.groups?.package &&
      match.groups.version &&
      !['specifier', 'version'].includes(match.groups.package.toLowerCase())
    ) {
      if (!addVersion(`${match.groups.package}@${match.groups.version}`)) {
        break;
      }
      continue;
    }

    const packageStart = /^["']?(?<package>@?[a-z0-9][\w./-]*)["']?:$/i.exec(line);
    if (packageStart?.groups?.package) {
      pendingPackage = { name: packageStart.groups.package, indent };
    }
  }

  return [...versions];
}

const DEPENDENCY_HINT = /^(?<name>@?[a-z0-9][\w./-]*)@(?<version>\d+\.\d+\.\d+(?:-[\w.-]+)?)$/iu;

function validDependencyHints(hints: readonly string[] = []): string[] {
  return [...new Set(hints.filter((hint) => DEPENDENCY_HINT.test(hint)))].slice(0, 25);
}

function relevantDependencyHints(
  diagnosis: Diagnosis,
  hints: readonly string[] = [],
): string[] {
  const valid = validDependencyHints(hints);
  const excerpt = diagnosis.errorExcerpt.toLowerCase();
  const mentioned = valid.filter((hint) => {
    const dependency = packageNameAndVersion(hint);
    if (!dependency) return false;
    const basename = dependency.name.split('/').at(-1) ?? dependency.name;
    const names = [
      dependency.name,
      basename,
      ...basename.split(/[-_]/u).filter((part) => part.length >= 4),
    ];
    return names.some((name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      return new RegExp(`(?:^|[^a-z0-9_@.-])${escaped}(?=$|[^a-z0-9_@-])`, 'iu')
        .test(excerpt);
    });
  });
  return mentioned.slice(0, 1);
}

function groundingQuery(
  diagnosis: Diagnosis,
  lockfileDiff = '',
  dependencyHints: readonly string[] = [],
): string {
  const safeExcerpt = redactExternalText(diagnosis.errorExcerpt.trim()).text
    .replace(/\s+/g, ' ')
    .slice(0, MAX_ERROR_QUERY_CHARACTERS);
  const hints = relevantDependencyHints(diagnosis, dependencyHints);
  const hintText = hints.join(' ');
  const packageBudget = MAX_QUERY_CHARACTERS - safeExcerpt.length - hintText.length - 2;
  const packages = packageVersions(lockfileDiff, Math.max(0, packageBudget));
  return [...hints, ...packages, safeExcerpt]
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_QUERY_CHARACTERS);
}

function packageNameAndVersion(hint: string): { name: string; version: string } | null {
  const match = DEPENDENCY_HINT.exec(hint);
  return match?.groups?.name && match.groups.version
    ? { name: match.groups.name, version: match.groups.version }
    : null;
}

function exactPublicGithubRepository(value: string): string | null {
  const normalized = githubRepository(value);
  return normalized === value ? normalized : null;
}

function isExactReleaseCitation(
  value: unknown,
  releaseUrls: readonly string[],
): value is TavilyCitation {
  if (typeof value !== 'object' || value === null) return false;
  const citation = value as Record<string, unknown>;
  if (
    typeof citation.title !== 'string' ||
    citation.title.trim().length === 0 ||
    citation.title.length > MAX_RELEASE_CITATION_TITLE_CHARACTERS ||
    typeof citation.url !== 'string' ||
    !releaseUrls.includes(citation.url) ||
    typeof citation.snippet !== 'string' ||
    citation.snippet.trim().length === 0 ||
    citation.snippet.length > MAX_RELEASE_CITATION_SNIPPET_CHARACTERS
  ) return false;
  try {
    const url = new URL(citation.url);
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.username === '' &&
      url.password === '' &&
      url.port === '';
  } catch {
    return false;
  }
}

async function addRegistryVerifiedReleaseCitations(
  tavily: TavilySearch,
  citations: TavilyCitation[],
  hints: readonly string[],
): Promise<TavilyCitation[]> {
  if (!tavily.extract || !tavily.packageRepository) return citations;
  const additions: TavilyCitation[] = [];
  for (const hint of validDependencyHints(hints)) {
    const dependency = packageNameAndVersion(hint);
    if (!dependency) continue;
    try {
      const repository = await tavily.packageRepository(
        dependency.name,
        dependency.version,
      );
      if (!repository) continue;
      const verifiedRepository = exactPublicGithubRepository(repository);
      if (!verifiedRepository) continue;
      const major = dependency.version.split('.')[0];
      const releaseUrls = [
        `${verifiedRepository}/releases/tag/v${dependency.version}`,
        ...(major ? [`${verifiedRepository}/blob/main/docs/v${major}-UPGRADE-GUIDE.md`] : []),
      ];
      const extracted = await tavily.extract(
        releaseUrls,
        redactExternalText(
          `${dependency.name} ${dependency.version} breaking changes migration`,
        ).text,
      );
      additions.push(...extracted.filter((citation) =>
        isExactReleaseCitation(citation, releaseUrls)));
    } catch {
      // The primary search remains useful when optional release extraction is unavailable.
    }
  }
  return [...citations, ...additions].filter(
    (citation, index, all) => all.findIndex(({ url }) => url === citation.url) === index,
  );
}

export async function ground(
  tavily: TavilySearch,
  diagnosis: Diagnosis,
  options: GroundOptions,
): Promise<Grounding> {
  if (!options.tavilyEnabled) {
    return { query: '', citations: [], skipped: true, reason: 'disabled' };
  }
  const webHelpful = WEB_HELPFUL_CLASSES.has(diagnosis.class) ||
    (diagnosis.class === 'test-bug' && DEPENDENCY_NOT_FUNCTION.test(diagnosis.errorExcerpt));
  if (!webHelpful) {
    return { query: '', citations: [], skipped: true, reason: 'not-applicable' };
  }

  const query = groundingQuery(
    diagnosis,
    options.lockfileDiff,
    options.dependencyHints,
  );
  const safeQuery = redactExternalText(query).text;
  const relevantHints = relevantDependencyHints(diagnosis, options.dependencyHints);
  let searched: TavilyCitation[];
  try {
    searched = await tavily.search(safeQuery, { maxResults: 5 });
  } catch (error) {
    if (!(error instanceof TavilyRequestError) || error.status !== 403) throw error;
    const extracted = await addRegistryVerifiedReleaseCitations(tavily, [], relevantHints);
    if (extracted.length === 0) throw error;
    return { query: safeQuery, citations: extracted, skipped: false };
  }
  const citations = await addRegistryVerifiedReleaseCitations(
    tavily,
    searched,
    relevantHints,
  );
  return { query: safeQuery, citations, skipped: false };
}

export function promoteUpstreamDependencyDiagnosis(
  diagnosis: Diagnosis,
  dependencyHints: readonly string[] = [],
): Diagnosis {
  if (
    !DEPENDENCY_NOT_FUNCTION.test(diagnosis.errorExcerpt) ||
    relevantDependencyHints(diagnosis, dependencyHints).length === 0
  ) {
    return diagnosis;
  }
  return {
    ...diagnosis,
    class: 'dep-upstream-breaking',
    confidence: Math.max(diagnosis.confidence, 0.8),
    signals: [...new Set([...diagnosis.signals, 'mechanical:dep-upstream-breaking'])],
  };
}
