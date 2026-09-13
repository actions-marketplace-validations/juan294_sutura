import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

export const SHA_PATTERN = /^[a-f0-9]{40}$/u;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function exactSha(value, label) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    throw new Error(`${label} must be an exact lowercase 40-character commit`);
  }
  return value;
}

export function nonnegativeNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite nonnegative number`);
  }
  return value;
}

export function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative integer`);
  }
  return value;
}

export function publicGitHubUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a public GitHub URL`);
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password ||
      url.port || url.search || url.hash) {
    throw new Error(`${label} must be a public GitHub URL`);
  }
  return url.toString();
}

export function assertPublicEvidenceText(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const forbidden = /(?:\/Users\/|\/home\/[^/\s]+\/|\/var\/folders\/|[A-Z]:\\Users\\|(?:^|\s)(?:\.\.?\/|~\/)[^\s]+|Authorization:\s*(?:Bearer|Basic)|(?:NEBIUS_API_KEY|CONTREE_TOKEN|CONTREE_PROJECT|TAVILY_API_KEY|GITHUB_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN)\s*[:=]\s*\S+|github_pat_|ghp_|npm_[A-Za-z0-9]{20,}|xox[baprs]-|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/u;
  if (forbidden.test(value)) throw new Error(`${label} contains a credential or private local path`);
  return value;
}

export function workflowActionReferences(value, label = 'workflow') {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 256 * 1024) {
    throw new Error(`${label} must be bounded YAML text`);
  }
  let document;
  try {
    document = parseYaml(value);
  } catch (error) {
    throw new Error(`${label} must be valid YAML`, { cause: error });
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document) ||
      document.jobs === null || typeof document.jobs !== 'object' || Array.isArray(document.jobs)) {
    throw new Error(`${label} must define workflow jobs`);
  }
  const references = [];
  for (const job of Object.values(document.jobs)) {
    if (job === null || typeof job !== 'object' || Array.isArray(job) || !Array.isArray(job.steps)) continue;
    for (const step of job.steps) {
      if (step !== null && typeof step === 'object' && !Array.isArray(step) &&
          typeof step.uses === 'string' && step.uses.startsWith('juan294/sutura@')) {
        references.push(step.uses);
      }
    }
  }
  return references;
}
