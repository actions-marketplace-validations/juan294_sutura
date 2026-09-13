import {
  DEFAULT_MODELS,
  TOKEN_FACTORY_BASE_URL,
} from '../config.js';
import { DEFAULT_MODEL_PRICES, type ModelTier } from './cost.js';
import {
  NebiusClient,
  type NebiusClientDependencies,
} from './nebius.js';
import { DEFAULT_ROUTING_PROFILE_ID, DEVELOPMENT_ROUTING_PROFILE_ID } from './router.js';

export interface TokenFactoryClientOptions {
  apiKey: string;
  models?: Readonly<Record<ModelTier, string>>;
  routingProfileId?: string;
}

export class TokenFactoryContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenFactoryContractError';
  }
}

export function createTokenFactoryClient(
  options: TokenFactoryClientOptions,
  dependencies: NebiusClientDependencies = {},
): NebiusClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new TokenFactoryContractError('Token Factory apiKey is required');
  }
  const models = options.models ?? DEFAULT_MODELS;
  if (models.super !== DEFAULT_MODELS.super) {
    throw new TokenFactoryContractError(
      `Token Factory requires the verified Super model ${DEFAULT_MODELS.super}`,
    );
  }
  const routingProfileId = options.routingProfileId ?? DEFAULT_ROUTING_PROFILE_ID;
  if (routingProfileId !== DEFAULT_ROUTING_PROFILE_ID && routingProfileId !== DEVELOPMENT_ROUTING_PROFILE_ID) {
    throw new TokenFactoryContractError(
      `Token Factory requires the verified routing profile ${DEFAULT_ROUTING_PROFILE_ID}`,
    );
  }

  if (routingProfileId === DEVELOPMENT_ROUTING_PROFILE_ID
    && (models.nano !== DEFAULT_MODELS.nano || models.ultra !== DEFAULT_MODELS.ultra)) {
    throw new TokenFactoryContractError('Development routing requires the verified model contracts for every tier');
  }

  return new NebiusClient({
    apiKey,
    baseUrl: TOKEN_FACTORY_BASE_URL,
    models,
    prices: DEFAULT_MODEL_PRICES,
    routingProfileId,
  }, dependencies);
}
