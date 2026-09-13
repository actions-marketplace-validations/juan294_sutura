import { Buffer } from 'node:buffer';

const MAX_EXTERNAL_TEXT_BYTES = 1 * 1_024 * 1_024;
const REDACTED_CREDENTIAL = '[redacted credential]';
const EXTERNAL_TEXT_REDACTION_MARKERS = [
  REDACTED_CREDENTIAL,
  '[redacted private key]',
  '[redacted token]',
  '[redacted secret]',
] as const;

export interface ExternalTextRedaction {
  text: string;
  count: number;
}

export class ExternalTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExternalTextError';
  }
}

export function redactExternalText(value: string): ExternalTextRedaction {
  if (Buffer.byteLength(value, 'utf8') > MAX_EXTERNAL_TEXT_BYTES) {
    throw new ExternalTextError('external text exceeds the redaction input limit');
  }
  let text = value;
  let count = 0;
  const replace = (
    pattern: RegExp,
    replacement: string,
  ): void => {
    text = text.replace(pattern, (...args: unknown[]) => {
      count += 1;
      return replacement.replace(/\$(?<index>[1-9])/gu, (_token, index: string) => {
        const capture = args[Number(index)];
        return typeof capture === 'string' ? capture : '';
      });
    });
  };

  // The 8192-character body bound keeps each BEGIN marker's lazy scan local
  // instead of running to the end of the input; PEM key bodies are far shorter.
  replace(
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]{0,8192}?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/gu,
    '[redacted private key]',
  );
  replace(
    /\b(https?:\/\/)[^/@\s]+@([^\s/]+)([^\s]*)/giu,
    `$1${REDACTED_CREDENTIAL}@$2$3`,
  );
  replace(
    /\b(Authorization\s*[:=]\s*)(?!\[redacted credential\])(?:(?:Bearer|Basic)\s+)?[^\s,;]+/giu,
    `$1${REDACTED_CREDENTIAL}`,
  );
  replace(
    /^([ \t]*(?:const|let|var)\s+)([A-Z][A-Z0-9_]{0,64}(?:API_KEY|ACCESS_KEY|TOKEN|SECRET|PASSWORD)|API[_-]?KEY|ACCESS[_-]?TOKEN|CLIENT[_-]?SECRET|TOKEN|SECRET|PASSWORD)\s*(?::\s*[^=\r\n;]{1,120})?=\s*(?!\[redacted credential\])(?:"[^"]*"|'[^']*')/gimu,
    `$1$2=${REDACTED_CREDENTIAL}`,
  );
  replace(
    /^([ \t]*)([A-Z][A-Z0-9_]{0,64}(?:API_KEY|ACCESS_KEY|TOKEN|SECRET|PASSWORD)|API[_-]?KEY|ACCESS[_-]?TOKEN|CLIENT[_-]?SECRET|TOKEN|SECRET|PASSWORD)\s*[:=]\s*(?!\[redacted credential\])(?:"[^"]*"|'[^']*'|[^\s,;]+)/gimu,
    `$1$2=${REDACTED_CREDENTIAL}`,
  );
  replace(
    /(["'](?:api[_-]?key|access[_-]?token|client[_-]?secret|token|secret|password)["']\s*:\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/giu,
    `$1"${REDACTED_CREDENTIAL}"`,
  );
  replace(
    /\b(?:github_pat_|gh[pousr]_|sk_(?:live|test)_|sk-)[A-Za-z0-9_-]{8,}(?:\s+[A-Za-z0-9_-]{8,})*/gu,
    '[redacted token]',
  );

  return { text, count };
}

export function containsExternalTextRedaction(value: string): boolean {
  return EXTERNAL_TEXT_REDACTION_MARKERS.some((marker) => value.includes(marker));
}

export function assertExternalEditableText(value: string): string {
  const result = redactExternalText(value);
  if (result.count > 0) {
    throw new ExternalTextError(
      `editable external text contains ${result.count} credential pattern${result.count === 1 ? '' : 's'}`,
    );
  }
  return value;
}

export function redactExternalMessages<
  T extends Readonly<{ role: string; content: string }>,
>(messages: readonly T[]): T[] {
  return messages.map((message) => ({
    ...message,
    content: redactExternalText(message.content).text,
  }));
}

export function redactExternalJsonValue<T>(value: T): T {
  if (typeof value === 'string') {
    return redactExternalText(value).text as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactExternalJsonValue(item)) as T;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactExternalJsonValue(item)]),
    ) as T;
  }
  return value;
}
