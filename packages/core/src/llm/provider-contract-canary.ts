import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import {
  DEFAULT_MODELS,
  TOKEN_FACTORY_BASE_URL,
} from '../config.js';
import type { Diagnosis } from '../domain.js';
import { runControlledRepairAttempt } from '../engine/repair-attempt.js';
import { RepairBudget } from '../engine/repair-budget.js';
import { InMemoryExecutor } from '../executor/memory.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import type { NebiusClientDependencies } from './nebius.js';
import { createTokenFactoryClient } from './token-factory.js';
import type { LlmReply, TierLlm } from './types.js';

export const SUPER_REPAIR_PROVIDER_CONTRACT_VERSION = 'sutura-super-repair-v5';

const BROKEN_SOURCE = [
  'export function add(left: number, right: number): number {',
  '  return left - right;',
  '}',
  '',
].join('\n');
const FIXED_SOURCE = BROKEN_SOURCE.replace('left - right', 'left + right');
const EXPECTED_DIFF = [
  'diff --git a/src/add.ts b/src/add.ts',
  '--- a/src/add.ts',
  '+++ b/src/add.ts',
  '@@ -1,3 +1,3 @@',
  ' export function add(left: number, right: number): number {',
  '-  return left - right;',
  '+  return left + right;',
  ' }',
  '',
].join('\n');

const DIAGNOSIS: Diagnosis = {
  class: 'test-assertion',
  confidence: 0.99,
  signals: ['expected -1 to be 5'],
  failingCmd: 'pnpm test',
  errorExcerpt: 'src/add.test.ts: expected -1 to be 5',
};

export interface SuperRepairProviderContractCanaryInput {
  apiKey: string;
}

export interface SuperRepairProviderContractCanaryResult {
  contractVersion: typeof SUPER_REPAIR_PROVIDER_CONTRACT_VERSION;
  endpoint: string;
  model: string;
  finishReason: string;
  usage: LlmReply['usage'];
  replacementCodePoints: number;
  replacementSha256: string;
  latencyMs: number;
  requestId: string | null;
}

export class SuperRepairProviderContractCanaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuperRepairProviderContractCanaryError';
  }
}

function decodedPatch(command: string): string | null {
  const encoded = /printf '%s' '?([A-Za-z0-9+/=]+)'? \|/u.exec(command)?.[1];
  return encoded === undefined ? null : Buffer.from(encoded, 'base64').toString('utf8');
}

export async function runSuperRepairProviderContractCanary(
  input: SuperRepairProviderContractCanaryInput,
  dependencies: NebiusClientDependencies = {},
): Promise<SuperRepairProviderContractCanaryResult> {
  if (!input.apiKey.trim()) {
    throw new SuperRepairProviderContractCanaryError('NEBIUS_API_KEY is required');
  }
  const client = createTokenFactoryClient({ apiKey: input.apiKey }, dependencies);
  const replies: LlmReply[] = [];
  const capturingClient: TierLlm<'super'> = {
    capacitySnapshot: () => client.capacitySnapshot(),
    modelId: (tier) => client.modelId(tier),
    modelQuote: (tier, messages, options) => client.modelQuote(tier, messages, options),
    async chat(tier, messages, options) {
      const reply = await client.chat(tier, messages, options);
      replies.push(reply);
      return reply;
    },
  };
  const executor = new InMemoryExecutor((command, _parent, index) => {
    if (index === 0) {
      const patch = decodedPatch(command);
      return {
        exitCode: patch === EXPECTED_DIFF ? 0 : 1,
        stdout: patch === EXPECTED_DIFF ? EXPECTED_DIFF : '',
        stderr: patch === EXPECTED_DIFF ? '' : 'unexpected canary patch',
        truncated: false,
        metrics: {},
      };
    }
    return {
      exitCode: 0,
      stdout: '1 passed',
      stderr: '',
      truncated: false,
      metrics: {},
    };
  });
  const outcome = await runControlledRepairAttempt({
    llm: capturingClient,
    executor,
    initialImageId: 'provider-contract-canary-baseline',
    diagnosis: DIAGNOSIS,
    policy: createDefaultRepositoryPolicy(),
    budget: new RepairBudget(),
    trustedCommands: { diagnosed: 'pnpm test' },
    sourceContext: {
      sources: [
        {
          path: 'src/add.test.ts',
          startLine: 1,
          content: "import { add } from './add.js';\nexpect(add(2, 3)).toBe(5);\n",
          truncated: false,
        },
        {
          path: 'src/add.ts',
          startLine: 1,
          content: BROKEN_SOURCE,
          truncated: false,
        },
      ],
    },
  });

  if (replies.length > 1) {
    throw new SuperRepairProviderContractCanaryError(
      `Super provider contract canary failed: expected exactly one response, received ${replies.length}`,
    );
  }
  const reply = replies[0];
  if (reply !== undefined && reply.finishReason !== 'stop') {
    throw new SuperRepairProviderContractCanaryError(
      `Super provider contract returned finish_reason ${reply.finishReason ?? 'null'}`,
    );
  }
  if (reply !== undefined && reply.providerModel !== DEFAULT_MODELS.super) {
    throw new SuperRepairProviderContractCanaryError(
      `Super provider contract returned model ${reply.providerModel ?? 'null'}`,
    );
  }
  if (reply?.hadThinkPrefix === true) {
    throw new SuperRepairProviderContractCanaryError(
      'Super provider contract returned a think prefix while thinking was disabled',
    );
  }
  if (
    reply === undefined ||
    outcome.status !== 'submitted' ||
    outcome.candidate.diff !== EXPECTED_DIFF
  ) {
    const detail = outcome.status === 'submitted'
      ? 'candidate diff did not match the arithmetic contract'
      : outcome.status === 'checkpoint'
        ? 'trusted arithmetic test did not pass'
        : `${outcome.status}: ${outcome.reason}`;
    throw new SuperRepairProviderContractCanaryError(
      `Super provider contract canary failed: ${detail}`,
    );
  }
  const completionTokens = reply.usage.outTok + reply.usage.reasoningTok;
  if (reply.usage.inTok <= 0 || completionTokens <= 0) {
    throw new SuperRepairProviderContractCanaryError(
      'Super provider contract returned empty token usage',
    );
  }
  if (reply.usage.reasoningTok !== 0) {
    throw new SuperRepairProviderContractCanaryError(
      'Super provider contract returned reasoning tokens while thinking was disabled',
    );
  }

  return {
    contractVersion: SUPER_REPAIR_PROVIDER_CONTRACT_VERSION,
    endpoint: `${TOKEN_FACTORY_BASE_URL}chat/completions`,
    model: DEFAULT_MODELS.super,
    finishReason: 'stop',
    usage: reply.usage,
    replacementCodePoints: [...FIXED_SOURCE].length,
    replacementSha256: createHash('sha256').update(FIXED_SOURCE).digest('hex'),
    latencyMs: reply.latencyMs,
    requestId: reply.requestId,
  };
}
