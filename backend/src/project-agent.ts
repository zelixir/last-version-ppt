import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { createModelClient } from './dashscope-model.ts';
import { appendProjectChat, createProjectRecord, getAiModelById, getProjectById, getProviderByName, ProjectChatEntry, ProjectChatToolEvent, setSetting } from './db.ts';
import { exampleApiKeys, summarizeModelConfigurationError } from './project-support.ts';
import { runProject } from './project-runner.ts';
import { APPLY_PATCH_AGENT_INSTRUCTIONS, APPLY_PATCH_TOOL_DESCRIPTION, applyLegacySearchReplace, applyProjectPatch } from './apply-patch.ts';
import {
  buildProjectId,
  copyProjectDirectory,
  createProjectFiles,
  getProjectDir,
  nextVersionProjectId,
  resolveProjectFile,
  sanitizeProjectName,
} from './storage.ts';

const PPTXGENJS_GUIDE = [
  'PptxGenJS 快速使用要点：',
  '1. 使用 const pptx = context.pptx; 不要自己写文件，框架会负责预览与导出。',
  '2. 添加页面：const slide = pptx.addSlide(); 常用 layout 为 LAYOUT_WIDE / LAYOUT_16X9。',
  '3. 文本：slide.addText(text, { x, y, w, h, fontSize, color, bold, align, valign });',
  '4. 图片：slide.addImage({ path: getResourceUrl("图片名.png"), x, y, w, h });',
  '5. 形状：slide.addShape("rect", { x, y, w, h, fill: { color }, line: { color } });',
  '6. 表格：slide.addTable(rows, { x, y, w, h, fontSize, color, border });',
  '7. 可以设置 slide.background = { color: "F8FAFC" }；也可以设置 pptx.author/title/subject。',
  '8. 如需日志，请调用 log("说明")。日志会在运行项目时展示。',
  '9. index.js 必须导出函数：module.exports = async function ({ pptx, pptxgenjs, getResourceUrl, log }) { ... }',
  '10. 不要使用 import / require 外部模块，不要直接 writeFile / write。',
].join('\n');

function summarizeToolEvent(toolName: string, details: string, success = true): ProjectChatToolEvent {
  return { toolName, summary: details, success };
}

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

  const result = await generateText({
    model: createModelClient(model.model_name, model.provider),
    prompt: `请根据下面的 PPT 需求生成一个简洁的项目名，只返回项目名本身，不要解释，不超过 18 个字符。\n\n需求：${requirement}`,
    maxOutputTokens: 80,
  });

  return sanitizeProjectName(result.text.replace(/[\r\n]+/g, ' ').trim() || 'project');
}

export async function chatWithProjectAgent(projectId: string, content: string, modelId: number): Promise<{ history: ProjectChatEntry[]; toolEvents: ProjectChatToolEvent[] }> {
  const project = ensureProject(projectId);
  const model = getAiModelById(modelId);
  if (!model || model.enabled !== 'Y') {
    throw new Error('所选模型不存在或未启用');
  }
  const provider = getProviderByName(model.provider);
  if (!provider || !provider.api_key || exampleApiKeys.has(provider.api_key)) {
    throw new Error(summarizeModelConfigurationError());
  }

  const history = project.chatHistory;
  const toolEvents: ProjectChatToolEvent[] = [];

  const result = await generateText({
    model: createModelClient(model.model_name, model.provider),
    system: [
      '你是 last-version-ppt 的内置 PPT 生成代理。你的目标是根据用户需求创建或编辑当前项目中的 index.js 和资源文件。',
      '你只能操作当前项目，优先保持输出简洁、可靠、可运行。',
      PPTXGENJS_GUIDE,
      `当前项目：${project.id}`,
      `当前资源：${listProjectFiles(projectId).map(file => file.name).join(', ') || '（空）'}`,
      '所有工具渲染都需要简短明确，不输出 JSON 给最终用户。',
    ].join('\n\n'),
    messages: history.concat({ role: 'user', content, createdAt: new Date().toISOString() }).map(item => ({ role: item.role, content: item.content })),
    tools: {
      'create-project': tool({
        description: '创建一个新项目并切换到该项目。',
        inputSchema: z.object({ name: z.string(), requirement: z.string().optional() }),
        execute: async ({ name, requirement }) => {
          const newId = buildProjectId(name);
          createProjectFiles(newId);
          createProjectRecord({ id: newId, name: sanitizeProjectName(name), sourcePrompt: requirement ?? '', chatHistory: [] });
          setSetting('currentProjectId', newId);
          toolEvents.push(summarizeToolEvent('create-project', `创建项目 ${newId}`));
          return { projectId: newId };
        },
      }),
      'clone-project': tool({
        description: '克隆当前项目为新的项目名称和日期。',
        inputSchema: z.object({ name: z.string() }),
        execute: async ({ name }) => {
          const newId = buildProjectId(name);
          copyProjectDirectory(projectId, newId);
          const current = ensureProject(projectId);
          createProjectRecord({
            id: newId,
            name: sanitizeProjectName(name),
            sourcePrompt: current.sourcePrompt,
            chatHistory: current.chatHistory,
          });
          setSetting('currentProjectId', newId);
          toolEvents.push(summarizeToolEvent('clone-project', `克隆为 ${newId}`));
          return { projectId: newId };
        },
      }),
      'switch-project': tool({
        description: '切换当前工作项目。',
        inputSchema: z.object({ projectId: z.string() }),
        execute: async ({ projectId: nextProjectId }) => {
          ensureProject(nextProjectId);
          setSetting('currentProjectId', nextProjectId);
          toolEvents.push(summarizeToolEvent('switch-project', `切换到 ${nextProjectId}`));
          return { projectId: nextProjectId };
        },
      }),
      'create-version': tool({
        description: '按 _vNN 规则为当前项目创建版本副本。',
        inputSchema: z.object({}),
        execute: async () => {
          const nextId = nextVersionProjectId(projectId);
          copyProjectDirectory(projectId, nextId);
          const current = ensureProject(projectId);
          createProjectRecord({
            id: nextId,
            name: current.name,
            rootProjectId: current.rootProjectId,
            sourcePrompt: current.sourcePrompt,
            chatHistory: current.chatHistory,
          });
          setSetting('currentProjectId', nextId);
          toolEvents.push(summarizeToolEvent('create-version', `创建版本 ${nextId}`));
          return { projectId: nextId };
        },
      }),
      'get-current-project': tool({
        description: '获取当前项目信息。',
        inputSchema: z.object({}),
        execute: async () => {
          const current = ensureProject(projectId);
          toolEvents.push(summarizeToolEvent('get-current-project', `当前项目 ${current.id}`));
          return current;
        },
      }),
      'run-project': tool({
        description: '运行当前项目的 index.js，检查是否成功。',
        inputSchema: z.object({ includeLogs: z.boolean().optional() }),
        execute: async ({ includeLogs }) => {
          const runResult = await runProject({ projectId, includeLogs });
          toolEvents.push(summarizeToolEvent('run-project', runResult.ok ? `运行成功，${runResult.slideCount} 页` : '运行失败', runResult.ok));
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
          const files = listProjectFiles(projectId);
          toolEvents.push(summarizeToolEvent('list-file', `列出 ${files.length} 个文件`));
          return files;
        },
      }),
      'create-file': tool({
        description: '创建或覆盖当前项目中的文本文件。',
        inputSchema: z.object({ fileName: z.string(), content: z.string() }),
        execute: async ({ fileName, content }) => {
          const filePath = resolveProjectFile(projectId, fileName);
          mkdirSync(path.dirname(filePath), { recursive: true });
          writeFileSync(filePath, content, 'utf8');
          toolEvents.push(summarizeToolEvent('create-file', `写入 ${fileName}`));
          return { fileName, size: Buffer.byteLength(content, 'utf8') };
        },
      }),
      'rename-file': tool({
        description: '重命名当前项目中的文件。',
        inputSchema: z.object({ oldName: z.string(), newName: z.string() }),
        execute: async ({ oldName, newName }) => {
          if (oldName === 'index.js') throw new Error('不能重命名 index.js');
          const sourcePath = resolveProjectFile(projectId, oldName);
          const targetPath = resolveProjectFile(projectId, newName);
          renameSync(sourcePath, targetPath);
          toolEvents.push(summarizeToolEvent('rename-file', `${oldName} → ${newName}`));
          return { oldName, newName };
        },
      }),
      'delete-file': tool({
        description: '删除当前项目中的文件，但不能删除 index.js。',
        inputSchema: z.object({ fileName: z.string() }),
        execute: async ({ fileName }) => {
          if (fileName === 'index.js') throw new Error('不能删除 index.js');
          rmSync(resolveProjectFile(projectId, fileName), { recursive: true, force: true });
          toolEvents.push(summarizeToolEvent('delete-file', `删除 ${fileName}`));
          return { deleted: fileName };
        },
      }),
      grep: tool({
        description: '在当前项目的文本文件中查找内容。',
        inputSchema: z.object({ pattern: z.string() }),
        execute: async ({ pattern }) => {
          const matches = grepProjectFiles(projectId, pattern);
          toolEvents.push(summarizeToolEvent('grep', `匹配 ${matches.length} 个文件`));
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
          if (input) {
            const summary = applyProjectPatch(getProjectDir(projectId), input);
            const details = summary.changedFiles.length > 0
              ? `修改 ${summary.changedFiles.join(', ')}`
              : '补丁未产生文件变更';
            toolEvents.push(summarizeToolEvent('apply-patch', details));
            return { changed: summary.changedFiles, created: summary.createdFiles, deleted: summary.deletedFiles, moved: summary.movedFiles, fuzz: summary.fuzz };
          }

          const targetPath = resolveProjectFile(projectId, fileName!);
          const original = readFileSync(targetPath, 'utf8');
          const updated = applyLegacySearchReplace(original, search!, replace!, replaceAll);
          writeFileSync(targetPath, updated, 'utf8');
          toolEvents.push(summarizeToolEvent('apply-patch', `修改 ${fileName}`));
          return { changed: [fileName], legacy: true };
        },
      }),
    },
    stopWhen: stepCountIs(8),
  });

  const newHistory: ProjectChatEntry[] = [
    { role: 'user', content, createdAt: new Date().toISOString() },
    { role: 'assistant', content: result.text.trim(), createdAt: new Date().toISOString(), toolEvents },
  ];

  const updated = appendProjectChat(projectId, newHistory);
  if (!updated) throw new Error('保存对话失败');
  return { history: updated.chatHistory, toolEvents };
}
