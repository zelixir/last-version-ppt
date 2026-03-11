import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import { createModelClient } from './dashscope-model.ts';
import { appendProjectChat, createProjectRecord, getAiModelById, getProjectById, getProviderByName, ProjectChatEntry, ProjectChatToolEvent, renameProjectRecord, setSetting } from './db.ts';
import { PPTXGENJS_GUIDE } from './pptxgenjs-guide.ts';
import { exampleApiKeys, summarizeModelConfigurationError } from './project-support.ts';
import { runProject } from './project-runner.ts';
import { APPLY_PATCH_AGENT_INSTRUCTIONS, APPLY_PATCH_TOOL_DESCRIPTION, applyLegacySearchReplace, applyProjectPatch } from './apply-patch.ts';
import {
  buildRenamedProjectId,
  buildProjectId,
  copyProjectDirectory,
  createProjectFiles,
  getProjectDir,
  nextVersionProjectId,
  renameProjectDirectory,
  resolveProjectFile,
  sanitizeProjectName,
} from './storage.ts';

function summarizeToolEvent(toolName: string, details: string, success = true): ProjectChatToolEvent {
  return { toolName, summary: details, success };
}

export type ProjectAgentStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool'; toolName: string; summary: string; state: 'running' | 'done'; success?: boolean };

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
      return '正在查看当前文件';
    case 'create-file':
      return `准备写入 ${(input.fileName as string) || ''}`.trim();
    case 'rename-file':
      return `准备把 ${(input.oldName as string) || ''} 改成 ${(input.newName as string) || ''}`.trim();
    case 'delete-file':
      return `准备删除 ${(input.fileName as string) || ''}`.trim();
    case 'grep':
      return `正在查找 ${(input.pattern as string) || ''}`.trim();
    case 'apply-patch':
      return input.fileName ? `准备修改 ${(input.fileName as string) || ''}`.trim() : '准备批量修改文件';
    default:
      return '正在处理';
  }
}

function createToolEventEmitter(
  toolEvents: ProjectChatToolEvent[],
  onEvent?: (event: ProjectAgentStreamEvent) => void,
) {
  return {
    start(toolName: string, input: Record<string, unknown>) {
      onEvent?.({ type: 'tool', toolName, summary: summarizeToolIntent(toolName, input), state: 'running' });
    },
    finish(toolName: string, summary: string, success = true) {
      const event = summarizeToolEvent(toolName, summary, success);
      toolEvents.push(event);
      onEvent?.({ type: 'tool', toolName, summary, state: 'done', success });
      return event;
    },
  };
}

function buildProjectTools(options: {
  getProjectId: () => string;
  setProjectId: (projectId: string) => void;
  toolEvents: ProjectChatToolEvent[];
  onEvent?: (event: ProjectAgentStreamEvent) => void;
}) {
  const emitter = createToolEventEmitter(options.toolEvents, options.onEvent);

  return {
    'create-project': tool({
      description: '创建一个新项目并切换到该项目。',
      inputSchema: z.object({ name: z.string(), requirement: z.string().optional() }),
      execute: async ({ name, requirement }) => {
        emitter.start('create-project', { name, requirement });
        const newId = buildProjectId(name);
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
        const newId = buildProjectId(name);
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
    'create-file': tool({
      description: '创建或覆盖当前项目中的文本文件。',
      inputSchema: z.object({ fileName: z.string(), content: z.string() }),
      execute: async ({ fileName, content }) => {
        emitter.start('create-file', { fileName });
        const filePath = resolveProjectFile(options.getProjectId(), fileName);
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, 'utf8');
        emitter.finish('create-file', `写入 ${fileName}`);
        return { fileName, size: Buffer.byteLength(content, 'utf8') };
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
          return { changed: summary.changedFiles, created: summary.createdFiles, deleted: summary.deletedFiles, moved: summary.movedFiles, fuzz: summary.fuzz };
        }

        if (!fileName || typeof search !== 'string' || typeof replace !== 'string') {
          throw new Error('apply-patch 缺少必要的 legacy 参数');
        }
        const targetPath = resolveProjectFile(currentProjectId, fileName);
        const original = readFileSync(targetPath, 'utf8');
        const updated = applyLegacySearchReplace(original, search, replace, replaceAll);
        writeFileSync(targetPath, updated, 'utf8');
        emitter.finish('apply-patch', `修改 ${fileName}`);
        return { changed: [fileName], legacy: true };
      },
    }),
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
  let activeProjectId = projectId;

  const result = streamText({
    model: createModelClient(model.model_name, model.provider),
    system: [
      '你是“最后一版PPT”的内置 PPT 生成助手。你的目标是根据用户需求创建或编辑当前项目中的 PPT 脚本和资源文件。',
      '你只能操作当前项目，优先保持输出简洁、可靠、可运行。',
      '必须尽量完整实现用户要的 PPT 内容，不能只给最小骨架或占位内容。',
      '在你认为已经完成时，必须先调用 run-project 检查脚本是否能运行；如果失败，要继续修复直到成功或明确说明阻塞原因。',
      '最终回复面向不懂技术的普通用户，尽量使用自然中文，避免技术术语和英文缩写。',
      PPTXGENJS_GUIDE,
      `当前项目：${project.id}`,
      `当前资源：${listProjectFiles(projectId).map(file => file.name).join(', ') || '（空）'}`,
      '所有工具渲染都需要简短明确，不输出 JSON 给最终用户。',
    ].join('\n\n'),
    messages: history.concat({ role: 'user', content, createdAt: new Date().toISOString() }).map(item => ({ role: item.role, content: item.content })),
    tools: buildProjectTools({
      getProjectId: () => activeProjectId,
      setProjectId: nextProjectId => {
        activeProjectId = nextProjectId;
        setSetting('currentProjectId', nextProjectId);
      },
      toolEvents,
      onEvent: options?.onEvent,
    }),
    stopWhen: stepCountIs(8),
  });

  let assistantText = '';
  for await (const chunk of result.fullStream) {
    if (chunk.type === 'text-delta' && chunk.text) {
      assistantText += chunk.text;
      options?.onEvent?.({ type: 'text-delta', text: chunk.text });
    }
  }

  const newHistory: ProjectChatEntry[] = [
    { role: 'user', content, createdAt: new Date().toISOString() },
    { role: 'assistant', content: (assistantText.trim() || await result.text).trim(), createdAt: new Date().toISOString(), toolEvents },
  ];

  const updated = appendProjectChat(activeProjectId, newHistory);
  if (!updated) throw new Error('保存对话失败');
  return { history: updated.chatHistory, toolEvents, activeProjectId };
}
