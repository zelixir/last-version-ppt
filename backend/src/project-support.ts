import exampleProviderData from '../model-provider.example.json';

export const exampleApiKeys = new Set(
  ((exampleProviderData as { providers?: Array<{ api_key?: string }> }).providers ?? [])
    .map(provider => provider.api_key)
    .filter((apiKey): apiKey is string => Boolean(apiKey))
);

export function summarizeModelConfigurationError(): string {
  return '请先在模型配置页填写真实可用的 API Key，并启用至少一个支持工具调用的模型。';
}
