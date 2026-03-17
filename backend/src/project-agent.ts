import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { createAgentUIStreamResponse, createIdGenerator, streamText, ToolLoopAgent, tool, type UIMessage } from 'ai';
import { z } from 'zod';
import { createModelClient } from './dashscope-model.ts';
import { appendProjectChat, createProjectRecord, getAiModelById, getProjectById, getProviderByName, ProjectChatEntry, ProjectChatMessagePart, ProjectChatToolEvent, renameProjectRecord, setSetting } from './db.ts';
import { appendTextPart, mergeToolPart } from './chat-message-parts.ts';
import { PPTXGENJS_GUIDE } from './pptxgenjs-guide.ts';
import { exampleApiKeys, summarizeModelConfigurationError } from './project-support.ts';
import { runProject } from './project-runner.ts';
import { APPLY_PATCH_AGENT_INSTRUCTIONS, APPLY_PATCH_TOOL_DESCRIPTION, applyLegacySearchReplace, applyProjectPatch } from './apply-patch.ts';
import {
  buildRenamedProjectId,
  buildUniqueProjectId,
  copyProjectDirectory,
  createProjectFiles,
  getProjectDir,
  nextVersionProjectId,
  renameProjectDirectory,
  resolveProjectFile,
  sanitizeProjectName,
} from './storage.ts';
import { readProjectPreviewImage } from './project-preview-cache.ts';
import {
  buildImageToolModelOutput,
  getImageMediaType,
  isImageFile,
  readProjectTextFile,
  readProjectTextFileRange,
} from './project-tool-helpers.ts';

function summarizeToolEvent(toolName: string, details: string, success = true): ProjectChatToolEvent {
  return { toolName, summary: details, success };
}

function countTextLines(value: string): number {
  if (!value) return 0;
  return value.split(/\r?\n/).length;
}

function isProjectIdAvailable(projectId: string) {
  return !getProjectById(projectId) && !existsSync(getProjectDir(projectId));
}

export type ProjectAgentStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool'; toolName: string; summary: string; state: 'running' | 'done'; success?: boolean };

export type ProjectChatUiMessage = UIMessage<{ projectId?: string }>;

const generateMessageId = createIdGenerator({ prefix: 'msg', size: 16 });
const MAX_TOOL_LOOP_STEPS = 20;

const TOOL_CAPABILITY_GROUPS = [
  {
    title: '项目整理',
    tools: ['create-project', 'clone-project', 'switch-project', 'create-version', 'rename-project', 'get-current-project'],
    summary: '新建、复制、切换、保存版本、改名，以及查看当前项目情况。',
  },
  {
    title: '文件处理',
    tools: ['list-file', 'read-file', 'read-range', 'create-file', 'rename-file', 'delete-file', 'grep', 'apply-patch'],
    summary: '查看文件、按需读取内容、批量修改、写入新内容、重命名或删除资源。',
  },
  {
    title: '检查效果',
    tools: ['run-project', 'read-ppt-page'],
    summary: '运行并检查演示稿是否能正常生成，也能查看某一页的预览效果。',
  },
  {
    title: '看图辅助',
    tools: ['read-image-file'],
    summary: '查看你上传的图片，帮助判断配图是否合适。',
  },
] as const;

function ensureProject(projectId: string) {
  const project = getProjectById(projectId);
  if (!project) throw new Error('项目不存在');
  return project;
}

function listProjectFiles(projectId: string): Array<{ name: string; size: number; isDirectory: boolean }> {
  const dir = getProjectDir(projectId);
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith('.'))
    .map(entry => {
      const fullPath = path.join(dir, entry.name);
      return {
        name: entry.name,
        size: entry.isDirectory() ? 0 : statSync(fullPath).size,
        isDirectory: entry.isDirectory(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function grepProjectFiles(projectId: string, pattern: string): Array<{ fileName: string; count: number }> {
  const matcher = new RegExp(pattern, 'gi');
  return listProjectFiles(projectId)
    .filter(file => !file.isDirectory)
    .map(file => {
      const content = readFileSync(resolveProjectFile(projectId, file.name), 'utf8');
      const matches = content.match(matcher);
      return { fileName: file.name, count: matches?.length ?? 0 };
    })
    .filter(item => item.count > 0);
}

export async function generateProjectName(requirement: string, modelId: number): Promise<string> {
  const model = getAiModelById(modelId);
  if (!model || model.enabled !== 'Y') {
    throw new Error('没有可用模型，无法为项目命名');
  }
  const provider = getProviderByName(model.provider);
  if (!provider || !provider.api_key || exampleApiKeys.has(provider.api_key)) {
    throw new Error(summarizeModelConfigurationError());
  }

  const result = streamText({
    model: createModelClient(model.model_name, model.provider),
    prompt: `请根据下面的 PPT 需求生成一个简洁的项目名，只返回项目名本身，不要解释，不超过 18 个字符。\n\n需求：${requirement}`,
    maxOutputTokens: 80,
  });

  return sanitizeProjectName((await result.text).replace(/[\r\n]+/g, ' ').trim() || 'project');
}

function summarizeToolIntent(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'create-project':
      return `准备新建项目 ${(input.name as string) || ''}`.trim();
    case 'clone-project':
      return `准备复制成 ${(input.name as string) || ''}`.trim();
    case 'switch-project':
      return `准备切换到 ${(input.projectId as string) || ''}`.trim();
    case 'create-version':
      return '准备保存一个新版本';
    case 'rename-project':
      return `准备把项目改名为 ${(input.name as string) || ''}`.trim();
    case 'get-current-project':
      return '正在查看当前项目';
    case 'run-project':
      return '正在检查这份 PPT 能否正常生成';
    case 'list-file':
      return '正在查看项目文件列表';
    case 'read-file':
      return `正在读取 ${(input.fileName as string) || ''}`.trim();
    case 'read-range':
      return `正在分段读取 ${(input.fileName as string) || ''}`.trim();
    case 'create-file':
      return `准备写入 ${(input.fileName as string) || ''}`.trim();
    case 'rename-file':
      return `准备把 ${(input.oldName as string) || ''} 改成 ${(input.newName as string) || ''}`.trim();
    case 'delete-file':
      return `准备删除 ${(input.fileName as string) || ''}`.trim();
    case 'grep':
      return `正在查找 ${(input.pattern as string) || ''}`.trim();
    case 'read-image-file':
      return `正在查看图片 ${(input.fileName as string) || ''}`.trim();
    case 'read-ppt-page':
      return `正在查看第 ${(input.pageNumber as number) || ''} 页`.trim();
    case 'apply-patch':
      return input.fileName ? `准备给 ${(input.fileName as string) || ''} 应用补丁`.trim() : '准备应用补丁';
    default:
      return '正在处理';
  }
}

export function buildToolCapabilitySummary(enabledToolNames: string[]): string {
  const enabledToolNameSet = new Set(enabledToolNames);
  return TOOL_CAPABILITY_GROUPS
    .map(group => {
      const availableTools = group.tools.filter(toolName => enabledToolNameSet.has(toolName));
      if (!availableTools.length) return null;
      return `- ${group.title}：${group.summary}`;
    })
    .filter((item): item is string => Boolean(item))
    .join('\n');
}

export function buildProjectAgentSystemPrompt(projectId: string, supportsMultimodal: boolean, enabledToolNames: string[]): string {
  return [
    '你是“最后一版PPT”的内置 PPT 生成助手。你的目标是根据用户需求创建或编辑当前项目中的 PPT 脚本和资源文件。',
    '你只能操作当前项目，优先保持输出简洁、可靠、可运行。',
    '必须尽量完整实现用户要的 PPT 内容，不能只给最小骨架或占位内容。',
    '在你认为已经完成时，必须先调用 run-project 检查脚本是否能运行；如果失败，要继续修复直到成功或明确说明阻塞原因。',
    '如果你要在代码、文案或文本内容里表达换行，必须直接写真正的换行，不要把换行写成两个字符的“\\n”。',
    '如果用户问你“你能做什么”或“怎么用”，请按下面的能力清单，用自然中文做简短介绍，不要展开成长文：',
    buildToolCapabilitySummary(enabledToolNames),
    '读取文本文件时，优先使用 read-file；如果文件较大或只需要局部内容，要改用 read-range 工具按行查看。',
    '修改已有文件时，优先使用 apply-patch（应用补丁）；只有在新建文件或确实需要整份重写时，才使用 create-file。',
    APPLY_PATCH_AGENT_INSTRUCTIONS,
    '最终回复面向不懂技术的普通用户，尽量使用自然中文，避免技术术语和英文缩写。',
    supportsMultimodal
      ? '当前模型支持看图：必要时可以读取上传的图片，也可以查看当前 PPT 某一页的预览图来判断版式是否合适。'
      : '当前模型暂时不支持看图，请主要依靠文本文件和运行结果来完成任务。如果用户问你"能做什么"或在帮助信息中，请告知用户：切换到支持多模态的模型后，AI 可以直接查看预览效果来检查排版是否合适。',
    PPTXGENJS_GUIDE,
    `当前项目：${projectId}`,
    `当前资源：${listProjectFiles(projectId).map(file => file.name).join(', ') || '（空）'}`,
    '所有工具渲染都需要简短明确，不输出 JSON 给最终用户。',
  ].join('\n\n');
}

function createToolEventEmitter(
  toolEvents: ProjectChatToolEvent[],
  messageParts: ProjectChatMessagePart[],
  onEvent?: (event: ProjectAgentStreamEvent) => void,
) {
  return {
    start(toolName: string, input: Record<string, unknown>) {
      const summary = summarizeToolIntent(toolName, input);
      messageParts.splice(0, messageParts.length, ...mergeToolPart(messageParts, { toolName, summary, state: 'running' }));
      onEvent?.({ type: 'tool', toolName, summary, state: 'running' });
    },
    finish(toolName: string, summary: string, success = true) {
      const event = summarizeToolEvent(toolName, summary, success);
      toolEvents.push(event);
      messageParts.splice(0, messageParts.length, ...mergeToolPart(messageParts, { toolName, summary, state: 'done', success }));
      onEvent?.({ type: 'tool', toolName, summary, state: 'done', success });
      return event;
    },
  };
}

function createProjectToolLoopAgent(options: {
  projectId: string;
  modelName: string;
  providerName: string;
  supportsMultimodal: boolean;
  tools: ReturnType<typeof buildProjectTools>;
}) {
  return new ToolLoopAgent({
    model: createModelClient(options.modelName, options.providerName),
    instructions: buildProjectAgentSystemPrompt(options.projectId, options.supportsMultimodal, Object.keys(options.tools)),
    tools: options.tools,
    stopWhen: [step => (step.steps?.length ?? 0) >= MAX_TOOL_LOOP_STEPS],
  });
}

function buildProjectTools(options: {
  getProjectId: () => string;
  setProjectId: (projectId: string) => void;
  toolEvents: ProjectChatToolEvent[];
  messageParts: ProjectChatMessagePart[];
  supportsMultimodal?: boolean;
  onEvent?: (event: ProjectAgentStreamEvent) => void;
}) {
  const emitter = createToolEventEmitter(options.toolEvents, options.messageParts, options.onEvent);

  return {
    'create-project': tool({
      description: '创建一个新项目并切换到该项目。',
      inputSchema: z.object({ name: z.string(), requirement: z.string().optional() }),
      execute: async ({ name, requirement }) => {
        emitter.start('create-project', { name, requirement });
        const newId = buildUniqueProjectId(name, isProjectIdAvailable);
        createProjectFiles(newId);
        createProjectRecord({ id: newId, name: sanitizeProjectName(name), sourcePrompt: requirement ?? '', chatHistory: [] });
        options.setProjectId(newId);
        emitter.finish('create-project', `创建项目 ${newId}`);
        return { projectId: newId };
      },
    }),
    'clone-project': tool({
      description: '克隆当前项目为新的项目名称和日期。',
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        emitter.start('clone-project', { name });
        const currentProjectId = options.getProjectId();
        const newId = buildUniqueProjectId(name, isProjectIdAvailable);
        copyProjectDirectory(currentProjectId, newId);
        const current = ensureProject(currentProjectId);
        createProjectRecord({
          id: newId,
          name: sanitizeProjectName(name),
          sourcePrompt: current.sourcePrompt,
          chatHistory: current.chatHistory,
        });
        options.setProjectId(newId);
        emitter.finish('clone-project', `克隆为 ${newId}`);
        return { projectId: newId };
      },
    }),
    'switch-project': tool({
      description: '切换当前工作项目。',
      inputSchema: z.object({ projectId: z.string() }),
      execute: async ({ projectId: nextProjectId }) => {
        emitter.start('switch-project', { projectId: nextProjectId });
        ensureProject(nextProjectId);
        options.setProjectId(nextProjectId);
        emitter.finish('switch-project', `切换到 ${nextProjectId}`);
        return { projectId: nextProjectId };
      },
    }),
    'create-version': tool({
      description: '按 _vNN 规则为当前项目创建版本副本。',
      inputSchema: z.object({}),
      execute: async () => {
        emitter.start('create-version', {});
        const currentProjectId = options.getProjectId();
        const nextId = nextVersionProjectId(currentProjectId);
        copyProjectDirectory(currentProjectId, nextId);
        const current = ensureProject(currentProjectId);
        createProjectRecord({
          id: nextId,
          name: current.name,
          rootProjectId: current.rootProjectId,
          sourcePrompt: current.sourcePrompt,
          chatHistory: current.chatHistory,
        });
        options.setProjectId(nextId);
        emitter.finish('create-version', `创建版本 ${nextId}`);
        return { projectId: nextId };
      },
    }),
    'rename-project': tool({
      description: '直接重命名当前项目目录，并同步更新项目编号。',
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        emitter.start('rename-project', { name });
        const currentProjectId = options.getProjectId();
        const nextName = sanitizeProjectName(name);
        const nextProjectId = buildRenamedProjectId(currentProjectId, nextName);
        if (nextProjectId === currentProjectId) {
          emitter.finish('rename-project', `项目名称保持为 ${nextProjectId}`);
          return { projectId: nextProjectId };
        }
        if (getProjectById(nextProjectId) || existsSync(getProjectDir(nextProjectId))) {
          throw new Error(`项目 ${nextProjectId} 已存在，请换一个名称`);
        }
        renameProjectDirectory(currentProjectId, nextProjectId);
        renameProjectRecord(currentProjectId, nextProjectId, nextName);
        options.setProjectId(nextProjectId);
        emitter.finish('rename-project', `项目改名为 ${nextProjectId}`);
        return { projectId: nextProjectId };
      },
    }),
    'get-current-project': tool({
      description: '获取当前项目信息。',
      inputSchema: z.object({}),
      execute: async () => {
        emitter.start('get-current-project', {});
        const current = ensureProject(options.getProjectId());
        emitter.finish('get-current-project', `当前项目 ${current.id}`);
        return current;
      },
    }),
    'run-project': tool({
      description: '运行当前项目的 index.js，检查是否成功。',
      inputSchema: z.object({ includeLogs: z.boolean().optional() }),
      execute: async ({ includeLogs }) => {
        emitter.start('run-project', { includeLogs });
        const runResult = await runProject({ projectId: options.getProjectId(), includeLogs });
        emitter.finish('run-project', runResult.ok ? `运行成功，${runResult.slideCount} 页` : '运行失败', runResult.ok);
        return {
          ok: runResult.ok,
          slideCount: runResult.slideCount,
          logs: includeLogs ? runResult.logs : undefined,
          error: runResult.error,
        };
      },
    }),
    'list-file': tool({
      description: '列出当前项目中的文件。',
      inputSchema: z.object({}),
      execute: async () => {
        emitter.start('list-file', {});
        const files = listProjectFiles(options.getProjectId());
        emitter.finish('list-file', `列出 ${files.length} 个文件`);
        return files;
      },
    }),
    'read-file': tool({
      description: '读取当前项目中的文本文件，如果文件过大，会提示改用按行读取。',
      inputSchema: z.object({ fileName: z.string() }),
      execute: async ({ fileName }) => {
        emitter.start('read-file', { fileName });
        const result = readProjectTextFile(options.getProjectId(), fileName);
        emitter.finish('read-file', `读取 ${fileName}`);
        return result;
      },
    }),
    'read-range': tool({
      description: '按行范围读取当前项目中的文本文件，适合查看较大的文件。',
      inputSchema: z.object({ fileName: z.string(), startLine: z.number().int().min(1), endLine: z.number().int().min(1) }),
      execute: async ({ fileName, startLine, endLine }) => {
        emitter.start('read-range', { fileName, startLine, endLine });
        const result = await readProjectTextFileRange(options.getProjectId(), fileName, startLine, endLine);
        emitter.finish('read-range', `读取 ${fileName} 的第 ${result.startLine}-${result.endLine} 行`);
        return result;
      },
    }),
    'create-file': tool({
      description: '仅在新建文本文件，或确实需要整份覆盖文件内容时使用。',
      inputSchema: z.object({ fileName: z.string(), content: z.string() }),
      execute: async ({ fileName, content }) => {
        emitter.start('create-file', { fileName });
        const filePath = resolveProjectFile(options.getProjectId(), fileName);
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, 'utf8');
        emitter.finish('create-file', `写入 ${fileName}`);
        return { fileName, size: Buffer.byteLength(content, 'utf8'), lineCount: countTextLines(content) };
      },
    }),
    'rename-file': tool({
      description: '重命名当前项目中的文件。',
      inputSchema: z.object({ oldName: z.string(), newName: z.string() }),
      execute: async ({ oldName, newName }) => {
        emitter.start('rename-file', { oldName, newName });
        if (oldName === 'index.js') throw new Error('不能重命名 index.js');
        const currentProjectId = options.getProjectId();
        const sourcePath = resolveProjectFile(currentProjectId, oldName);
        const targetPath = resolveProjectFile(currentProjectId, newName);
        renameSync(sourcePath, targetPath);
        emitter.finish('rename-file', `${oldName} → ${newName}`);
        return { oldName, newName };
      },
    }),
    'delete-file': tool({
      description: '删除当前项目中的文件，但不能删除 index.js。',
      inputSchema: z.object({ fileName: z.string() }),
      execute: async ({ fileName }) => {
        emitter.start('delete-file', { fileName });
        if (fileName === 'index.js') throw new Error('不能删除 index.js');
        rmSync(resolveProjectFile(options.getProjectId(), fileName), { recursive: true, force: true });
        emitter.finish('delete-file', `删除 ${fileName}`);
        return { deleted: fileName };
      },
    }),
    grep: tool({
      description: '在当前项目的文本文件中查找内容。',
      inputSchema: z.object({ pattern: z.string() }),
      execute: async ({ pattern }) => {
        emitter.start('grep', { pattern });
        const matches = grepProjectFiles(options.getProjectId(), pattern);
        emitter.finish('grep', `匹配 ${matches.length} 个文件`);
        return matches;
      },
    }),
    'apply-patch': tool({
      description: APPLY_PATCH_TOOL_DESCRIPTION,
      inputSchema: z.object({
        input: z.string().optional(),
        fileName: z.string().optional(),
        search: z.string().optional(),
        replace: z.string().optional(),
        replaceAll: z.boolean().optional(),
      }).superRefine((value, ctx) => {
        if (value.input) return;
        if (value.fileName && typeof value.search === 'string' && typeof value.replace === 'string') return;
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '请提供 input，或提供 fileName + search + replace。' });
      }),
      execute: async ({ input, fileName, search, replace, replaceAll }) => {
        emitter.start('apply-patch', { fileName });
        const currentProjectId = options.getProjectId();
        if (input) {
          const summary = applyProjectPatch(getProjectDir(currentProjectId), input);
          const details = summary.changedFiles.length > 0
            ? `修改 ${summary.changedFiles.join(', ')}`
            : '补丁未产生文件变更';
          emitter.finish('apply-patch', details);
          return {
            changed: summary.changedFiles,
            created: summary.createdFiles,
            deleted: summary.deletedFiles,
            moved: summary.movedFiles,
            fuzz: summary.fuzz,
            lineCount: countTextLines(input),
          };
        }

        if (!fileName || typeof search !== 'string' || typeof replace !== 'string') {
          throw new Error('apply-patch 缺少必要的 legacy 参数');
        }
        const targetPath = resolveProjectFile(currentProjectId, fileName);
        const original = readFileSync(targetPath, 'utf8');
        const updated = applyLegacySearchReplace(original, search, replace, replaceAll);
        writeFileSync(targetPath, updated, 'utf8');
        emitter.finish('apply-patch', `修改 ${fileName}`);
        return { changed: [fileName], legacy: true, lineCount: countTextLines(updated) };
      },
    }),
    ...(options.supportsMultimodal ? {
      'read-image-file': tool({
        description: '读取当前项目中的图片，供支持看图的模型直接查看。',
        inputSchema: z.object({ fileName: z.string() }),
        execute: async ({ fileName }) => {
          emitter.start('read-image-file', { fileName });
          if (!isImageFile(fileName)) throw new Error('该文件不是图片');
          const filePath = resolveProjectFile(options.getProjectId(), fileName);
          if (!existsSync(filePath) || statSync(filePath).isDirectory()) throw new Error(`文件 ${fileName} 不存在`);
          const buffer = readFileSync(filePath);
          emitter.finish('read-image-file', `读取图片 ${fileName}`);
          return {
            fileName,
            mediaType: getImageMediaType(fileName),
            data: buffer.toString('base64'),
          };
        },
        toModelOutput: ({ output }) => ({
          ...buildImageToolModelOutput(`图片 ${output.fileName}`, output.fileName, output.mediaType, output.data),
        }),
      }),
      'read-ppt-page': tool({
        description: '读取当前项目 preview 文件夹里的指定页预览图，便于检查排版和视觉内容。',
        inputSchema: z.object({ pageNumber: z.number().int().min(1) }),
        execute: async ({ pageNumber }) => {
          emitter.start('read-ppt-page', { pageNumber });
          const rendered = readProjectPreviewImage(options.getProjectId(), pageNumber);
          emitter.finish('read-ppt-page', `读取第 ${pageNumber} 页预览图`);
          return {
            pageNumber,
            slideCount: rendered.slideCount,
            mediaType: rendered.mediaType,
            data: rendered.data,
          };
        },
        toModelOutput: ({ output }) => ({
          ...buildImageToolModelOutput(`当前 PPT 第 ${output.pageNumber} 页预览，共 ${output.slideCount} 页`, `slide-${output.pageNumber}.png`, output.mediaType, output.data),
        }),
      }),
    } : {}),
  };
}

export async function chatWithProjectAgent(
  projectId: string,
  content: string,
  modelId: number,
  options?: {
    includeHistory?: boolean;
    onEvent?: (event: ProjectAgentStreamEvent) => void;
  },
): Promise<{ history: ProjectChatEntry[]; toolEvents: ProjectChatToolEvent[]; activeProjectId: string }> {
  const project = ensureProject(projectId);
  const model = getAiModelById(modelId);
  if (!model || model.enabled !== 'Y') {
    throw new Error('所选模型不存在或未启用');
  }
  const provider = getProviderByName(model.provider);
  if (!provider || !provider.api_key || exampleApiKeys.has(provider.api_key)) {
    throw new Error(summarizeModelConfigurationError());
  }

  const history = options?.includeHistory ? project.chatHistory : [];
  const toolEvents: ProjectChatToolEvent[] = [];
  const assistantParts: ProjectChatMessagePart[] = [];
  let activeProjectId = projectId;
  const tools = buildProjectTools({
    getProjectId: () => activeProjectId,
    setProjectId: nextProjectId => {
      activeProjectId = nextProjectId;
      setSetting('currentProjectId', nextProjectId);
    },
    toolEvents,
    messageParts: assistantParts,
    supportsMultimodal: model.capabilities.multimodal === true,
    onEvent: options?.onEvent,
  });

  const result = streamText({
    model: createModelClient(model.model_name, model.provider),
    system: buildProjectAgentSystemPrompt(project.id, model.capabilities.multimodal === true, Object.keys(tools)),
    messages: history.concat({ role: 'user', content, createdAt: new Date().toISOString() }).map(item => ({ role: item.role, content: item.content })),
    tools,
  });

  let assistantText = '';
  for await (const chunk of result.fullStream) {
    if (chunk.type === 'text-delta' && chunk.text) {
      assistantText += chunk.text;
      assistantParts.splice(0, assistantParts.length, ...appendTextPart(assistantParts, chunk.text));
      options?.onEvent?.({ type: 'text-delta', text: chunk.text });
    }
  }

  const finalAssistantText = (assistantText.trim() || await result.text).trim() || '这次已经处理完成，你可以继续补充要求。';
  if (!assistantParts.some(part => part.type === 'text' && part.text.trim())) {
    assistantParts.splice(0, assistantParts.length, ...appendTextPart(assistantParts, finalAssistantText));
  }

  const newHistory: ProjectChatEntry[] = [
    { role: 'user', content, createdAt: new Date().toISOString() },
    { role: 'assistant', content: finalAssistantText, createdAt: new Date().toISOString(), toolEvents, parts: assistantParts },
  ];

  const updated = appendProjectChat(activeProjectId, newHistory);
  if (!updated) throw new Error('保存对话失败');
  return { history: updated.chatHistory, toolEvents, activeProjectId };
}

export async function createProjectChatResponse(
  projectId: string,
  messages: ProjectChatUiMessage[],
  modelId: number,
  options?: {
    onFinish?: (payload: { messages: ProjectChatUiMessage[]; activeProjectId: string }) => Promise<void> | void;
  },
): Promise<Response> {
  const project = ensureProject(projectId);
  const model = getAiModelById(modelId);
  if (!model || model.enabled !== 'Y') {
    throw new Error('所选模型不存在或未启用');
  }
  const provider = getProviderByName(model.provider);
  if (!provider || !provider.api_key || exampleApiKeys.has(provider.api_key)) {
    throw new Error(summarizeModelConfigurationError());
  }
  setSetting('currentModelId', String(modelId));

  const toolEvents: ProjectChatToolEvent[] = [];
  const assistantParts: ProjectChatMessagePart[] = [];
  let activeProjectId = projectId;
  const tools = buildProjectTools({
    getProjectId: () => activeProjectId,
    setProjectId: nextProjectId => {
      activeProjectId = nextProjectId;
      setSetting('currentProjectId', nextProjectId);
    },
    toolEvents,
    messageParts: assistantParts,
    supportsMultimodal: model.capabilities.multimodal === true,
  });
  const agent = createProjectToolLoopAgent({
    projectId: project.id,
    modelName: model.model_name,
    providerName: model.provider,
    supportsMultimodal: model.capabilities.multimodal === true,
    tools,
  });

  return createAgentUIStreamResponse<never, typeof tools, never, { projectId?: string }>({
    agent,
    uiMessages: messages,
    generateMessageId,
    messageMetadata: ({ part }) => part.type === 'finish' ? { projectId: activeProjectId } : undefined,
    onFinish: async ({ messages: nextMessages }) => {
      await options?.onFinish?.({ messages: nextMessages, activeProjectId });
    },
  });
}
