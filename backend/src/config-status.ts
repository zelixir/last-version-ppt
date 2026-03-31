import type { AiModel, ProviderRow } from './db.ts';
import { exampleApiKeys } from './project-support.ts';

export interface ConfigStatus {
  hasStubProviders: boolean;
  hasEnabledModels: boolean;
  hasUsableModel: boolean;
  needsAttention: boolean;
  firstUsableModelId: number | null;
}

export function buildConfigStatus(providers: ProviderRow[], enabledModels: AiModel[]): ConfigStatus {
  const usableProviders = providers.filter(provider => provider.api_key && !exampleApiKeys.has(provider.api_key));
  const usableModels = enabledModels.filter(model => usableProviders.some(provider => provider.name === model.provider));
  const hasStubProviders = providers.some(provider => exampleApiKeys.has(provider.api_key));
  return {
    hasStubProviders,
    hasEnabledModels: enabledModels.length > 0,
    hasUsableModel: usableModels.length > 0,
    needsAttention: usableModels.length === 0,
    firstUsableModelId: usableModels[0]?.id ?? null,
  };
}
