import { spawn } from 'child_process';
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, type FSWatcher, unlinkSync, watch, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { frontendAssets } from './frontend-assets.ts';
import exampleProviderData from '../model-provider.example.json';
import exampleModelData from '../models.example.json';
import {
  createAiModel,
  copyProjectConversations,
  createProjectRecord,
  createProvider,
  deleteAiModel,
  deleteProjectRecord,
  deleteProvider,
  deleteSetting,
  getAiModelById,
  getAiModels,
  getProjectConversation,
  getProjectById,
  getProviderByName,
  getProviders,
  getSetting,
  listProjectConversations,
  listProjects,
  renameProjectRecord,
  seedModelsFromJson,
  seedProvidersFromJson,
  setSetting,
  upsertProjectConversation,
  updateAiModel,
  updateProjectRecord,
  updateProvider,
} from './db.ts';
import { createProjectChatResponse, generateProjectName, type ProjectChatUiMessage } from './project-agent.ts';
import { runProject } from './project-runner.ts';
import { exampleApiKeys } from './project-support.ts';
import { buildAttachmentDisposition } from './http-headers.ts';
import {
  buildRenamedProjectId,
  buildProjectId,
  buildUniqueProjectId,
  copyProjectDirectory,
  createProjectFiles,
  deleteProjectDirectory,
  getFileStatSafe,
  getProjectDir,
  listProjectDirectories,
  nextVersionProjectId,
  projectsRoot,
  renameProjectDirectory,
  resolveProjectFile,
  sanitizeProjectName,
  storageRoot,
  stripVersionSuffix,
} from './storage.ts';
import { replaceProjectPreviewImages } from './project-preview-cache.ts';
import { getProjectRecordSyncDiff } from './project-record-sync.ts';
import { listSystemFonts, getSystemFontData } from './system-fonts.ts';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

const TEXT_FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.csv', '.html', '.css', '.xml', '.yml', '.yaml', '.svg']);
const IMAGE_FILE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const MEDIA_FILE_EXTENSIONS = new Set(['.mp4', '.mp3', '.wav']);
const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
} as const;

function getBackendDir(): string {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

const backendDir = getBackendDir();
const isExeMode = frontendAssets !== null;
const backendRoot = isExeMode ? backendDir : path.join(backendDir, '..');

const modelProviderPath = path.join(backendRoot, 'model-provider.json');
if (existsSync(modelProviderPath)) {
  try {
    seedProvidersFromJson(readFileSync(modelProviderPath, 'utf-8'));
  } catch (error) {
    console.warn('Failed to migrate model-provider.json to DB:', error);
  }
}

if (getProviders().length === 0 && getAiModels().length === 0) {
  try {
    seedProvidersFromJson(exampleProviderData);
    seedModelsFromJson(exampleModelData);
  } catch (error) {
    console.warn('Failed to seed defaults:', error);
  }
}

function getMimeType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function withCrossOriginIsolationHeaders(headers: Record<string, string>): Record<string, string> {
  return { ...headers, ...CROSS_ORIGIN_ISOLATION_HEADERS };
}

function isTextFile(fileName: string): boolean {
  return TEXT_FILE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function getFileKind(fileName: string): 'text' | 'image' | 'media' | 'binary' {
  const ext = path.extname(fileName).toLowerCase();
  if (TEXT_FILE_EXTENSIONS.has(ext)) return 'text';
  if (IMAGE_FILE_EXTENSIONS.has(ext)) return 'image';
  if (MEDIA_FILE_EXTENSIONS.has(ext)) return 'media';
  return 'binary';
}

function findFrontendDistDir(): string | null {
  const candidates = [
    path.join(backendRoot, '..', 'frontend', 'dist'),
    path.join(backendRoot, 'public'),
    path.join(process.cwd(), 'public'),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

const embeddedAssets = frontendAssets;
const frontendDistDir = embeddedAssets ? null : findFrontendDistDir();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function createSseResponse(run: (push: (event: string, payload: unknown) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      const push = (event: string, payload: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        await run(push);
      } catch (error) {
        push('error', { error: error instanceof Error ? error.message : String(error) });
      } finally {
        controller.close();
      }
    },
  }), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

function getProjectFileUrl(projectId: string, fileName: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/files/raw?fileName=${encodeURIComponent(fileName)}`;
}

function extractMessageText(message: ProjectChatUiMessage): string {
  return (message.parts ?? [])
    .filter((part): part is Extract<ProjectChatUiMessage['parts'][number], { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('')
    .trim();
}

function buildConversationTitle(messages: ProjectChatUiMessage[]): string {
  const firstUserMessage = messages.find(message => message.role === 'user' && extractMessageText(message));
  const firstUserText = firstUserMessage ? extractMessageText(firstUserMessage) : '';
  if (!firstUserText) return '新对话';
  return firstUserText.slice(0, 40);
}

function buildConversationSummary(messages: ProjectChatUiMessage[]) {
  const lastMessage = [...messages].reverse().find(message => extractMessageText(message));
  return {
    title: buildConversationTitle(messages),
    preview: lastMessage ? extractMessageText(lastMessage).slice(0, 80) : '',
    messageCount: messages.length,
  };
}

function buildLegacyConversationId(projectId: string): string {
  return `legacy:${projectId}`;
}

type ProjectFileWatchEvent = {
  projectId: string;
  fileName?: string;
  change: 'change' | 'rename';
  updatedAt: string;
};

function isProjectIdAvailable(projectId: string) {
  return !getProjectById(projectId) && !existsSync(getProjectDir(projectId));
}

type ProjectWatchState = {
  watcher: FSWatcher;
  listeners: Set<(event: ProjectFileWatchEvent) => void>;
};

const projectWatchers = new Map<string, ProjectWatchState>();

function buildLegacyConversationMessages(projectId: string) {
  const project = getProjectById(projectId);
  if (!project?.chatHistory.length) return [];
  return project.chatHistory.map((message, index) => ({
    id: `${buildLegacyConversationId(projectId)}:${index}`,
    role: message.role,
    metadata: { projectId },
    parts: message.content ? [{ type: 'text' as const, text: message.content }] : [],
  } satisfies ProjectChatUiMessage));
}

function convertUiMessagesToProjectChatHistory(messages: ProjectChatUiMessage[]) {
  return messages
    .filter((message): message is ProjectChatUiMessage & { role: 'user' | 'assistant' } => message.role === 'user' || message.role === 'assistant')
    .map(message => ({
      role: message.role,
      content: extractMessageText(message),
      createdAt: new Date().toISOString(),
    }));
}

async function handleProjectChatRequest(projectId: string, payload: { id?: string; messages?: ProjectChatUiMessage[]; modelId?: number }) {
  if (!getProjectById(projectId)) return new Response('Not found', { status: 404 });
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const lastUserMessage = [...messages].reverse().find(message => message.role === 'user' && extractMessageText(message));
  if (!payload.modelId) return errorResponse('请先选择模型');
  if (!lastUserMessage) return errorResponse('消息不能为空');
  try {
    return await createProjectChatResponse(projectId, messages, payload.modelId, {
      onFinish: async ({ messages: nextMessages, activeProjectId }) => {
        upsertProjectConversation({
          id: payload.id,
          projectId: activeProjectId,
          title: buildConversationTitle(nextMessages),
          messages: nextMessages,
        });
        updateProjectRecord(activeProjectId, {
          chatHistory: convertUiMessagesToProjectChatHistory(nextMessages),
          touch: true,
        });
      },
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error), 500);
  }
}

function syncProjectsWithFilesystem(): void {
  const directoryIds = listProjectDirectories();
  const projects = listProjects();
  const { missingRecordIds, staleRecordIds } = getProjectRecordSyncDiff(directoryIds, projects.map(project => project.id));

  for (const projectId of staleRecordIds) {
    deleteProjectRecord(projectId);
  }

  for (const projectId of missingRecordIds) {
    if (!getProjectById(projectId)) {
      createProjectRecord({
        id: projectId,
        name: sanitizeProjectName(projectId.replace(/^\d{8}_/, '')),
        rootProjectId: stripVersionSuffix(projectId),
        chatHistory: [],
      });
    }
  }

  for (const projectId of directoryIds) {
    createProjectFiles(projectId);
  }

  const syncedProjects = listProjects();
  const currentProjectId = getCurrentProjectId();
  if (currentProjectId && !directoryIds.includes(currentProjectId)) {
    const nextProjectId = projects.find(project => directoryIds.includes(project.id))?.id ?? directoryIds[0] ?? syncedProjects[0]?.id;
    if (nextProjectId) setCurrentProjectId(nextProjectId);
    else deleteSetting('currentProjectId');
  }
}

function getCurrentProjectId(): string | null {
  return getSetting('currentProjectId') || null;
}

function setCurrentProjectId(projectId: string): void {
  setSetting('currentProjectId', projectId);
}

function buildProjectResponse(projectId: string) {
  const project = getProjectById(projectId);
  if (!project) return null;
  const projectDir = getProjectDir(projectId);
  const files = existsSync(projectDir)
    ? readdirSync(projectDir, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => {
          const filePath = path.join(projectDir, entry.name);
          const stats = getFileStatSafe(filePath);
          return {
            name: entry.name,
            size: stats.size,
            updatedAt: stats.updatedAt,
            kind: getFileKind(entry.name),
            url: getProjectFileUrl(projectId, entry.name),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return {
    id: project.id,
    name: project.name,
    rootProjectId: project.rootProjectId,
    sourcePrompt: project.sourcePrompt,
    chatHistory: project.chatHistory,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    files,
    projectDir,
  };
}

function openSystemPath(targetPath: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', targetPath], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [targetPath], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [targetPath], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (error) {
    console.warn('Failed to open path:', error);
  }
}

function openBrowserUrl(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (error) {
    console.warn('Failed to open browser URL:', error);
  }
}

function configStatus() {
  const providers = getProviders();
  const enabledModels = getAiModels(true);
  const usableProviders = providers.filter(provider => provider.api_key && !exampleApiKeys.has(provider.api_key));
  const usableModels = enabledModels.filter(model => usableProviders.some(provider => provider.name === model.provider));
  const hasStubProviders = providers.some(provider => exampleApiKeys.has(provider.api_key));
  return {
    hasStubProviders,
    hasEnabledModels: enabledModels.length > 0,
    hasUsableModel: usableModels.length > 0,
    needsAttention: hasStubProviders || usableModels.length === 0,
    firstUsableModelId: usableModels[0]?.id ?? null,
  };
}

function filterUsableModels(models: ReturnType<typeof getAiModels>) {
  const usableProviderNames = new Set(
    getProviders()
      .filter(provider => provider.api_key && !exampleApiKeys.has(provider.api_key))
      .map(provider => provider.name),
  );
  return models.filter(model => usableProviderNames.has(model.provider));
}

function ensureProjectWatcher(projectId: string): ProjectWatchState {
  const existing = projectWatchers.get(projectId);
  if (existing) return existing;

  mkdirSync(getProjectDir(projectId), { recursive: true });
  const listeners = new Set<(event: ProjectFileWatchEvent) => void>();
  const watcher = watch(getProjectDir(projectId), { persistent: false }, (change, fileName) => {
    const normalizedFileName = typeof fileName === 'string' && fileName.trim()
      ? fileName.replace(/\\/g, '/')
      : undefined;
    const event: ProjectFileWatchEvent = {
      projectId,
      fileName: normalizedFileName,
      change: change === 'rename' ? 'rename' : 'change',
      updatedAt: new Date().toISOString(),
    };
    for (const listener of listeners) {
      listener(event);
    }
  });
  watcher.on('error', error => {
    console.warn(`Project watcher failed for ${projectId}:`, error);
  });

  const state = { watcher, listeners };
  projectWatchers.set(projectId, state);
  return state;
}

function subscribeProjectWatcher(projectId: string, listener: (event: ProjectFileWatchEvent) => void): () => void {
  const state = ensureProjectWatcher(projectId);
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
    if (state.listeners.size > 0) return;
    state.watcher.close();
    projectWatchers.delete(projectId);
  };
}

function createProjectWatchResponse(projectId: string, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  let dispose: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let abortHandler: (() => void) | null = null;
  let closed = false;

  const close = (controller?: ReadableStreamDefaultController<Uint8Array>) => {
    if (closed) return;
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (dispose) {
      dispose();
      dispose = null;
    }
    if (abortHandler) {
      signal.removeEventListener('abort', abortHandler);
      abortHandler = null;
    }
    if (controller) {
      try {
        controller.close();
      } catch {
        // ignore repeated close
      }
    }
  };

  return new Response(new ReadableStream({
    start(controller) {
      const push = (event: string, payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };
      dispose = subscribeProjectWatcher(projectId, payload => push('change', payload));
      heartbeat = setInterval(() => {
        push('ping', { projectId, updatedAt: new Date().toISOString() });
      }, 15000);
      abortHandler = () => close(controller);
      signal.addEventListener('abort', abortHandler, { once: true });
      push('ready', { projectId, updatedAt: new Date().toISOString() });
    },
    cancel() {
      close();
    },
  }), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

syncProjectsWithFilesystem();

const app = new Elysia()
  .use(cors())
  .get('/api/health', () => ({ ok: true, storageRoot, projectsRoot }))
  .get('/api/config-status', () => configStatus())
  .get('/api/providers', () => getProviders())
  .post('/api/providers', ({ body }) => {
    const payload = body as { name: string; label?: string; base_url: string; api_key: string };
    if (getProviderByName(payload.name)) return errorResponse('Provider name already exists', 409);
    return createProvider(payload);
  })
  .put('/api/providers/:name', ({ params, body }) => {
    if (!getProviderByName(params.name)) return new Response('Not found', { status: 404 });
    updateProvider(params.name, body as { name?: string; label?: string; base_url?: string; api_key?: string });
    return getProviderByName(((body as any).name ?? params.name) as string);
  })
  .delete('/api/providers/:name', ({ params }) => {
    deleteProvider(params.name);
    return { success: true };
  })
  .get('/api/ai-models', ({ query }) => {
    const models = getAiModels(query.enabled === 'true');
    return query.usable === 'true' ? filterUsableModels(models) : models;
  })
  .get('/api/ai-models/:id', ({ params }) => {
    const model = getAiModelById(Number(params.id));
    return model ?? new Response('Not found', { status: 404 });
  })
  .post('/api/ai-models', ({ body }) => createAiModel(body as any))
  .put('/api/ai-models/:id', ({ params, body }) => {
    updateAiModel(Number(params.id), body as any);
    return { success: true };
  })
  .delete('/api/ai-models/:id', ({ params }) => {
    deleteAiModel(Number(params.id));
    return { success: true };
  })
  .get('/api/projects', () => {
    syncProjectsWithFilesystem();
    const projects = listProjects().map(project => buildProjectResponse(project.id));
    return { currentProjectId: getCurrentProjectId(), projects: projects.filter(Boolean) };
  })
  .post('/api/projects', async ({ body }) => {
    const payload = body as { name?: string; requirement?: string; modelId?: number };
    const derivedName = payload.name?.trim()
      ? sanitizeProjectName(payload.name)
      : payload.requirement?.trim() && payload.modelId
        ? await generateProjectName(payload.requirement, payload.modelId)
        : null;

    if (!derivedName) return errorResponse('请填写项目名称，或提供需求和模型以自动命名');

    const projectId = buildUniqueProjectId(derivedName, isProjectIdAvailable);
    createProjectFiles(projectId);
    createProjectRecord({
      id: projectId,
      name: derivedName,
      sourcePrompt: payload.requirement?.trim() ?? '',
      rootProjectId: stripVersionSuffix(projectId),
      chatHistory: [],
    });
    setCurrentProjectId(projectId);
    return buildProjectResponse(projectId);
  })
  .post('/api/projects/:id/clone', ({ params, body }) => {
    const source = getProjectById(params.id);
    if (!source) return new Response('Not found', { status: 404 });
    const name = sanitizeProjectName(((body as any).name ?? source.name) as string);
    const projectId = buildUniqueProjectId(name, isProjectIdAvailable);
    copyProjectDirectory(source.id, projectId);
    createProjectRecord({
      id: projectId,
      name,
      rootProjectId: source.rootProjectId,
      sourcePrompt: source.sourcePrompt,
      chatHistory: source.chatHistory,
    });
    copyProjectConversations(source.id, projectId);
    setCurrentProjectId(projectId);
    return buildProjectResponse(projectId);
  })
  .post('/api/projects/:id/create-version', ({ params }) => {
    const source = getProjectById(params.id);
    if (!source) return new Response('Not found', { status: 404 });
    const projectId = nextVersionProjectId(source.id);
    copyProjectDirectory(source.id, projectId);
    createProjectRecord({
      id: projectId,
      name: source.name,
      rootProjectId: source.rootProjectId,
      sourcePrompt: source.sourcePrompt,
      chatHistory: source.chatHistory,
    });
    copyProjectConversations(source.id, projectId);
    setCurrentProjectId(projectId);
    return buildProjectResponse(projectId);
  })
  .delete('/api/projects/:id', ({ params }) => {
    const project = getProjectById(params.id);
    if (!project) return new Response('Not found', { status: 404 });
    deleteProjectDirectory(params.id);
    deleteProjectRecord(params.id);
    if (getCurrentProjectId() === params.id) {
      const nextProjectId = listProjects()[0]?.id;
      if (nextProjectId) setSetting('currentProjectId', nextProjectId);
      else deleteSetting('currentProjectId');
    }
    return { success: true };
  })
  .post('/api/projects/:id/current', ({ params }) => {
    if (!getProjectById(params.id)) return new Response('Not found', { status: 404 });
    setCurrentProjectId(params.id);
    return { success: true };
  })
  .post('/api/projects/:id/rename', ({ params, body }) => {
    const project = getProjectById(params.id);
    if (!project) return new Response('Not found', { status: 404 });
    const nextName = sanitizeProjectName(((body as any).name ?? project.name) as string);
    const nextProjectId = buildRenamedProjectId(project.id, nextName);
    if (nextProjectId === project.id) return buildProjectResponse(project.id);
    if (getProjectById(nextProjectId) || existsSync(getProjectDir(nextProjectId))) return errorResponse('同名项目已存在，请换一个名称');
    renameProjectDirectory(project.id, nextProjectId);
    renameProjectRecord(project.id, nextProjectId, nextName);
    return buildProjectResponse(nextProjectId);
  })
  .get('/api/projects/:id', ({ params }) => {
    const project = buildProjectResponse(params.id);
    return project ?? new Response('Not found', { status: 404 });
  })
  .get('/api/projects/:id/chat', ({ params, query }) => {
    const project = getProjectById(params.id);
    if (!project) return new Response('Not found', { status: 404 });

    const chatId = String((query as any).chatId ?? '').trim();
    if (chatId) {
      const conversation = getProjectConversation(params.id, chatId);
      if (conversation) return conversation;
      if (chatId === buildLegacyConversationId(params.id)) {
        return {
          id: chatId,
          projectId: params.id,
          title: buildConversationTitle(buildLegacyConversationMessages(params.id)),
          messages: buildLegacyConversationMessages(params.id),
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        };
      }
      return new Response('Not found', { status: 404 });
    }

    const conversations = listProjectConversations(params.id).map(conversation => ({
      id: conversation.id,
      ...buildConversationSummary(conversation.messages),
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    }));

    if (!conversations.length && project.chatHistory.length) {
      const legacyMessages = buildLegacyConversationMessages(params.id);
      return {
        conversations: [{
          id: buildLegacyConversationId(params.id),
          ...buildConversationSummary(legacyMessages),
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        }],
      };
    }

    return { conversations };
  })
  .post('/api/projects/:id/chat', async ({ params, body }) => {
    return handleProjectChatRequest(params.id, body as { id?: string; messages?: ProjectChatUiMessage[]; modelId?: number })
  })
  .post('/api/projects/:id/chat/stream', ({ params, body }) => handleProjectChatRequest(params.id, body as { id?: string; messages?: ProjectChatUiMessage[]; modelId?: number }))
  .get('/api/projects/:id/files', ({ params }) => {
    const project = buildProjectResponse(params.id);
    return project ? project.files : new Response('Not found', { status: 404 });
  })
  .get('/api/projects/:id/files/watch', ({ params, request }) => {
    const project = getProjectById(params.id);
    if (!project) return new Response('Not found', { status: 404 });
    return createProjectWatchResponse(params.id, request.signal);
  })
  .get('/api/projects/:id/files/content', ({ params, query }) => {
    const fileName = String((query as any).fileName ?? '');
    if (!fileName) return errorResponse('缺少 fileName 参数');
    const project = getProjectById(params.id);
    if (!project) return new Response('Not found', { status: 404 });
    const filePath = resolveProjectFile(params.id, fileName);
    if (!existsSync(filePath)) return new Response('Not found', { status: 404 });
    if (!isTextFile(fileName)) return errorResponse('该文件不是文本文件');
    return { fileName, content: readFileSync(filePath, 'utf8') };
  })
  .get('/api/projects/:id/files/raw', ({ params, query }) => {
    const fileName = String((query as any).fileName ?? '');
    if (!fileName) return errorResponse('缺少 fileName 参数');
    const project = getProjectById(params.id);
    if (!project) return new Response('Not found', { status: 404 });
    const filePath = resolveProjectFile(params.id, fileName);
    if (!existsSync(filePath)) return new Response('Not found', { status: 404 });
    return new Response(readFileSync(filePath), {
      headers: withCrossOriginIsolationHeaders({ 'Content-Type': getMimeType(filePath), 'Cache-Control': 'no-cache' }),
    });
  })
  .put('/api/projects/:id/files/content', ({ params, body }) => {
    const payload = body as { fileName: string; content: string };
    if (!payload.fileName) return errorResponse('缺少 fileName');
    const filePath = resolveProjectFile(params.id, payload.fileName);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, payload.content ?? '', 'utf8');
    updateProjectRecord(params.id, { touch: true });
    return { success: true };
  })
  .post('/api/projects/:id/files/rename', ({ params, body }) => {
    const payload = body as { oldName: string; newName: string };
    if (payload.oldName === 'index.js') return errorResponse('index.js 不能重命名');
    const sourcePath = resolveProjectFile(params.id, payload.oldName);
    const targetPath = resolveProjectFile(params.id, payload.newName);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, readFileSync(sourcePath));
    unlinkSync(sourcePath);
    updateProjectRecord(params.id, { touch: true });
    return { success: true };
  })
  .delete('/api/projects/:id/files', ({ params, query }) => {
    const fileName = String((query as any).fileName ?? '');
    if (!fileName) return errorResponse('缺少 fileName 参数');
    if (fileName === 'index.js') return errorResponse('index.js 不能删除');
    const filePath = resolveProjectFile(params.id, fileName);
    if (existsSync(filePath)) unlinkSync(filePath);
    updateProjectRecord(params.id, { touch: true });
    return { success: true };
  })
  .post('/api/projects/:id/files/upload', async ({ params, request }) => {
    const form = await request.formData();
    const files = form.getAll('files');
    const uploaded: string[] = [];
    for (const entry of files) {
      if (!(entry instanceof File)) continue;
      const buffer = Buffer.from(await entry.arrayBuffer());
      const filePath = resolveProjectFile(params.id, entry.name);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, buffer);
      uploaded.push(entry.name);
    }
    updateProjectRecord(params.id, { touch: true });
    return { uploaded };
  })
  .post('/api/projects/:id/preview-images', async ({ params, request }) => {
    const project = getProjectById(params.id);
    if (!project) return new Response('Not found', { status: 404 });

    const form = await request.formData();
    const files = form.getAll('files');
    const images: Array<{ pageNumber: number; data: Uint8Array }> = [];

    for (const entry of files) {
      if (!(entry instanceof File)) continue;
      const match = entry.name.match(/^slide-(\d+)\.png$/i);
      if (!match) continue;
      images.push({
        pageNumber: Number(match[1]),
        data: new Uint8Array(await entry.arrayBuffer()),
      });
    }

    const storedImages = replaceProjectPreviewImages(params.id, images);
    updateProjectRecord(params.id, { touch: true });

    return {
      slideCount: storedImages.length,
      images: storedImages.map(image => ({
        pageNumber: image.pageNumber,
        url: `/api/projects/${encodeURIComponent(params.id)}/files/raw?fileName=${encodeURIComponent(`preview/${image.fileName}`)}&t=${encodeURIComponent(image.updatedAt)}`,
      })),
    };
  })
  .post('/api/projects/:id/open-folder', ({ params }) => {
    const project = getProjectById(params.id);
    if (!project) return new Response('Not found', { status: 404 });
    openSystemPath(getProjectDir(params.id));
    return { success: true };
  })
  .post('/api/projects/:id/run', async ({ params, body }) => {
    const payload = body as { includeLogs?: boolean };
    const project = getProjectById(params.id);
    if (!project) return new Response('Not found', { status: 404 });
    const result = await runProject({ projectId: params.id, includeLogs: payload?.includeLogs });
    return result.ok
      ? { ok: true, slideCount: result.slideCount, logs: result.logs }
      : errorResponse(result.error || '项目运行失败', 500);
  })
  .get('/api/projects/:id/export', async ({ params }) => {
    const project = getProjectById(params.id);
    if (!project) return new Response('Not found', { status: 404 });
    const result = await runProject({ projectId: params.id, includeLogs: true });
    if (!result.ok || !result.pptx) return errorResponse(result.error || '导出失败', 500);
    const buffer = await result.pptx.write({ outputType: 'nodebuffer' });
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': buildAttachmentDisposition(`${params.id}.pptx`),
      },
    });
  })
  .get('/api/system-fonts', () => {
    const fonts = listSystemFonts();
    return { fonts: fonts.map(f => ({ name: f.name, size: f.size })) };
  })
  .get('/api/system-fonts/data', ({ query }) => {
    const name = String((query as any).name ?? '');
    if (!name) return errorResponse('缺少 name 参数');
    const font = getSystemFontData(name);
    if (!font) return new Response('Not found', { status: 404 });
    return new Response(font.data, {
      headers: withCrossOriginIsolationHeaders({
        'Content-Type': font.mimeType,
        'Cache-Control': 'public, max-age=86400',
      }),
    });
  })
  .get('/*', ({ request }) => {
    const url = new URL(request.url);
    const reqPath = decodeURIComponent(url.pathname);
    const segments = reqPath.split('/').filter(Boolean);

    if (segments.length >= 2) {
      const [projectId, ...fileParts] = segments;
      if (getProjectById(projectId)) {
        try {
          const resourcePath = resolveProjectFile(projectId, fileParts.join('/'));
          if (existsSync(resourcePath) && statSync(resourcePath).isFile()) {
            return new Response(readFileSync(resourcePath), {
              headers: withCrossOriginIsolationHeaders({ 'Content-Type': getMimeType(resourcePath), 'Cache-Control': 'no-cache' }),
            });
          }
        } catch {
          return new Response('Not Found', { status: 404 });
        }
      }
    }

    if (embeddedAssets) {
      const asset = embeddedAssets.get(reqPath) || embeddedAssets.get('/index.html');
      if (asset) {
        return new Response(asset.content, {
          headers: withCrossOriginIsolationHeaders({ 'Content-Type': asset.mimeType, 'Cache-Control': 'no-cache' }),
        });
      }
      return new Response('Not Found', { status: 404 });
    }

    if (frontendDistDir) {
      let filePath = reqPath.startsWith('/') ? reqPath.slice(1) : reqPath;
      if (!filePath) filePath = 'index.html';
      const fullPath = path.join(frontendDistDir, filePath);
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        return new Response(readFileSync(fullPath), {
          headers: withCrossOriginIsolationHeaders({ 'Content-Type': getMimeType(fullPath), 'Cache-Control': 'no-cache' }),
        });
      }
      const indexPath = path.join(frontendDistDir, 'index.html');
      if (existsSync(indexPath)) {
        return new Response(readFileSync(indexPath), {
          headers: withCrossOriginIsolationHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }),
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  })
  .listen(3101);

console.log('Backend running on http://localhost:3101');
console.log(`Storage root: ${storageRoot}`);

if (process.env.NO_OPEN_BROWSER !== '1') {
  openBrowserUrl('http://localhost:3101');
}
