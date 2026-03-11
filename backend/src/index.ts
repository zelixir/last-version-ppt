import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import { existsSync, readFileSync } from 'fs';
import pathModule from 'path';
import { fileURLToPath } from 'url';
import { generateText } from 'ai';
import {
  getConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  clearConversations,
  getRecentPrompts,
  getAiModels,
  getAiModelById,
  createAiModel,
  updateAiModel,
  deleteAiModel,
  seedModelsFromJson,
  getProviders,
  getProviderByName,
  createProvider,
  updateProvider,
  deleteProvider,
  seedProvidersFromJson,
} from './db';
import { createModelClient } from './dashscope-model';
import { frontendAssets } from './frontend-assets';
import exampleProviderData from '../model-provider.example.json';
import exampleModelData from '../models.example.json';

type ChatRole = 'system' | 'user' | 'assistant';
type ChatMessage = { role: ChatRole; content: string };

function getBackendDir(): string {
  try {
    return pathModule.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

function normalizeMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

function normalizeMessages(messages: Array<{ role?: unknown; content?: unknown }>): ChatMessage[] {
  return messages
    .map(message => {
      const role: ChatRole =
        message.role === 'system'
          ? 'system'
          : message.role === 'assistant'
            ? 'assistant'
            : 'user';

      return {
        role,
        content: normalizeMessageContent(message.content),
      };
    })
    .filter(message => Boolean(message.content));
}

function deriveConversationTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(message => message.role === 'user')?.content?.trim();
  if (!firstUser) return '新对话';
  return firstUser.length > 40 ? `${firstUser.slice(0, 40)}…` : firstUser;
}

const backendDir = getBackendDir();
const isExeMode = frontendAssets !== null;
const backendRoot = isExeMode ? backendDir : pathModule.join(backendDir, '..');

const modelProviderPath = pathModule.join(backendRoot, 'model-provider.json');
if (existsSync(modelProviderPath)) {
  try {
    seedProvidersFromJson(readFileSync(modelProviderPath, 'utf-8'));
  } catch (e) {
    console.warn('Failed to migrate model-provider.json to DB:', e);
  }
}

{
  const providerCount = getProviders().length;
  const modelCount = getAiModels().length;
  if (providerCount === 0 && modelCount === 0) {
    try {
      seedProvidersFromJson(exampleProviderData);
    } catch (e) {
      console.warn('Failed to seed providers from example:', e);
    }
    try {
      seedModelsFromJson(exampleModelData);
    } catch (e) {
      console.warn('Failed to seed models from example:', e);
    }
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
};

function getMimeType(filePath: string): string {
  const ext = pathModule.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function findFrontendDistDir(): string | null {
  const candidates = [
    pathModule.join(backendRoot, '..', 'frontend', 'dist'),
    pathModule.join(backendRoot, 'public'),
    pathModule.join(process.cwd(), 'public'),
  ];
  for (const candidate of candidates) {
    if (existsSync(pathModule.join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

const embeddedAssets = frontendAssets;
const frontendDistDir = embeddedAssets ? null : findFrontendDistDir();

const app = new Elysia()
  .use(cors())
  .get('/api/health', () => ({ ok: true }))
  .get('/api/providers', () => getProviders())
  .post('/api/providers', ({ body }) => {
    const payload = body as { name: string; label?: string; base_url: string; api_key: string };
    if (getProviderByName(payload.name)) {
      return new Response(JSON.stringify({ error: 'Provider name already exists' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    return createProvider(payload);
  }, {
    body: t.Object({
      name: t.String(),
      label: t.Optional(t.String()),
      base_url: t.String(),
      api_key: t.String(),
    }),
  })
  .put('/api/providers/:name', ({ params, body }) => {
    if (!getProviderByName(params.name)) return new Response('Not found', { status: 404 });
    updateProvider(params.name, body as { name?: string; label?: string; base_url?: string; api_key?: string });
    return getProviderByName((body as { name?: string }).name ?? params.name);
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      label: t.Optional(t.String()),
      base_url: t.Optional(t.String()),
      api_key: t.Optional(t.String()),
    }),
  })
  .delete('/api/providers/:name', ({ params }) => {
    deleteProvider(params.name);
    return { success: true };
  })
  .get('/api/ai-models', ({ query }) => {
    const enabledOnly = query.enabled === 'true';
    return getAiModels(enabledOnly);
  })
  .get('/api/ai-models/:id', ({ params }) => {
    const model = getAiModelById(Number(params.id));
    if (!model) return new Response('Not found', { status: 404 });
    return model;
  })
  .post('/api/ai-models', ({ body }) => createAiModel(body as any), {
    body: t.Object({
      model_name: t.String(),
      display_name: t.Optional(t.String()),
      provider: t.String(),
      capabilities: t.Optional(t.Record(t.String(), t.Boolean())),
      enabled: t.Optional(t.String()),
    }),
  })
  .put('/api/ai-models/:id', ({ params, body }) => {
    updateAiModel(Number(params.id), body as any);
    return { success: true };
  }, {
    body: t.Object({
      model_name: t.Optional(t.String()),
      display_name: t.Optional(t.String()),
      provider: t.Optional(t.String()),
      capabilities: t.Optional(t.Record(t.String(), t.Boolean())),
      enabled: t.Optional(t.String()),
    }),
  })
  .delete('/api/ai-models/:id', ({ params }) => {
    deleteAiModel(Number(params.id));
    return { success: true };
  })
  .get('/api/conversations', ({ query }) => getConversations({
    search: query.search as string | undefined,
    limit: query.limit ? Number(query.limit) : undefined,
    offset: query.offset ? Number(query.offset) : undefined,
  }))
  .get('/api/conversations/:id', ({ params }) => {
    const conversation = getConversation(Number(params.id));
    if (!conversation) return new Response('Not found', { status: 404 });
    return conversation;
  })
  .post('/api/conversations', ({ body }) => createConversation(body as { title: string; messages: string }), {
    body: t.Object({
      title: t.String(),
      messages: t.String(),
    }),
  })
  .put('/api/conversations/:id', ({ params, body }) => {
    updateConversation(Number(params.id), body as { title?: string; messages?: string });
    return { success: true };
  }, {
    body: t.Object({
      title: t.Optional(t.String()),
      messages: t.Optional(t.String()),
    }),
  })
  .delete('/api/conversations/:id', ({ params }) => {
    deleteConversation(Number(params.id));
    return { success: true };
  })
  .delete('/api/conversations', () => {
    clearConversations();
    return { success: true };
  })
  .get('/api/prompts/recent', ({ query }) => getRecentPrompts({
    limit: query.limit ? Number(query.limit) : undefined,
  }))
  .post('/api/chat', async ({ body }) => {
    const { messages, modelId, conversationId } = body as {
      messages: Array<{ role?: unknown; content?: unknown }>;
      modelId: number;
      conversationId?: number;
    };

    const modelConfig = getAiModelById(modelId);
    if (!modelConfig || modelConfig.enabled !== 'Y') {
      return new Response(JSON.stringify({ error: 'Model not found or disabled' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const providerConfig = getProviderByName(modelConfig.provider);
    if (!providerConfig || !providerConfig.api_key || providerConfig.api_key.startsWith('your_')) {
      return new Response(JSON.stringify({ error: 'Please configure a valid API key for the selected provider first' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const normalizedMessages = normalizeMessages(messages);
    if (normalizedMessages.length === 0) {
      return new Response(JSON.stringify({ error: 'At least one message is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    try {
      const result = await generateText({
        model: createModelClient(modelConfig.model_name, modelConfig.provider),
        messages: normalizedMessages,
        maxOutputTokens: 2000,
      });

      const assistantMessage: ChatMessage = { role: 'assistant', content: result.text.trim() };
      const fullConversation = [...normalizedMessages, assistantMessage];
      const title = deriveConversationTitle(normalizedMessages);

      let persistedConversationId = conversationId;
      if (conversationId && getConversation(conversationId)) {
        updateConversation(conversationId, { title, messages: JSON.stringify(fullConversation) });
      } else {
        const conversation = createConversation({ title, messages: JSON.stringify(fullConversation) });
        persistedConversationId = conversation.id;
      }

      return {
        message: assistantMessage.content,
        conversationId: persistedConversationId,
        title,
        usage: result.usage,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }, {
    body: t.Object({
      messages: t.Array(t.Object({
        role: t.String(),
        content: t.Any(),
      })),
      modelId: t.Number(),
      conversationId: t.Optional(t.Number()),
    }),
  })
  .get('/*', ({ request }) => {
    const url = new URL(request.url);
    const reqPath = url.pathname;

    if (embeddedAssets) {
      const asset = embeddedAssets.get(reqPath) || embeddedAssets.get('/index.html');
      if (asset) {
        return new Response(asset.content, {
          headers: { 'Content-Type': asset.mimeType, 'Cache-Control': 'no-cache' },
        });
      }
      return new Response('Not Found', { status: 404 });
    }

    if (frontendDistDir) {
      let filePath = reqPath.startsWith('/') ? reqPath.slice(1) : reqPath;
      if (!filePath) filePath = 'index.html';
      const fullPath = pathModule.join(frontendDistDir, filePath);
      if (existsSync(fullPath)) {
        return new Response(readFileSync(fullPath), {
          headers: { 'Content-Type': getMimeType(fullPath), 'Cache-Control': 'no-cache' },
        });
      }
      const indexPath = pathModule.join(frontendDistDir, 'index.html');
      if (existsSync(indexPath)) {
        return new Response(readFileSync(indexPath), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  })
  .listen(3101);

console.log('Backend running on http://localhost:3101');

if (embeddedAssets) {
  const url = 'http://localhost:3101';
  try {
    if (process.platform === 'win32') {
      Bun.spawn(['cmd', '/c', 'start', url]);
    } else if (process.platform === 'darwin') {
      Bun.spawn(['open', url]);
    } else {
      Bun.spawn(['xdg-open', url]);
    }
  } catch (e) {
    console.warn('Failed to open browser:', e);
  }
}
