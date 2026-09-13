type Outcome = { kind: 'ok'; value: number } | { kind: 'error'; message: string };

export function describe(outcome: Outcome): string {
  return outcome.kind === 'ok' ? String(outcome.value) : outcome.message;
}
