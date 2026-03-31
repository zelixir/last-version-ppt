import { expect, test } from 'bun:test';

import { buildConfigStatus } from './config-status.ts';

test('buildConfigStatus 在已有真实可用模型时不再要求用户处理示例密钥提醒', () => {
  const status = buildConfigStatus(
    [
      {
        id: 1,
        name: 'example-provider',
        label: '示例服务',
        base_url: 'https://example.test',
        api_key: 'your_dashscope_api_key_here',
        created_at: '2026-03-31T00:00:00.000Z',
      },
      {
        id: 2,
        name: 'real-provider',
        label: '真实服务',
        base_url: 'https://real-provider.test',
        api_key: 'real-secret-key',
        created_at: '2026-03-31T00:00:00.000Z',
      },
    ],
    [
      {
        id: 11,
        model_name: 'demo-model',
        display_name: '演示模型',
        provider: 'real-provider',
        capabilities: {},
        enabled: 'Y',
      },
    ],
  );

  expect(status.hasStubProviders).toBe(true);
  expect(status.hasUsableModel).toBe(true);
  expect(status.needsAttention).toBe(false);
  expect(status.firstUsableModelId).toBe(11);
});

test('buildConfigStatus 在没有真实可用模型时仍然提示用户先完成模型配置', () => {
  const status = buildConfigStatus(
    [
      {
        id: 1,
        name: 'example-provider',
        label: '示例服务',
        base_url: 'https://example.test',
        api_key: 'your_dashscope_api_key_here',
        created_at: '2026-03-31T00:00:00.000Z',
      },
    ],
    [
      {
        id: 10,
        model_name: 'demo-model',
        display_name: '演示模型',
        provider: 'example-provider',
        capabilities: {},
        enabled: 'Y',
      },
    ],
  );

  expect(status.hasStubProviders).toBe(true);
  expect(status.hasUsableModel).toBe(false);
  expect(status.needsAttention).toBe(true);
  expect(status.firstUsableModelId).toBeNull();
});
