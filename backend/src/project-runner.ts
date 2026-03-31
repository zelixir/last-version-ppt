import { existsSync, readFileSync } from 'fs';
import { createContext, Script } from 'node:vm';
import path from 'path';
import PptxGenJS from 'pptxgenjs';
import { measureText } from './ppt-text-layout.ts';
import { createScriptAssert } from './script-assert.ts';
import { getProjectDir, resolveProjectFile } from './storage.ts';

export interface RunProjectOptions {
  projectId: string;
  includeLogs?: boolean;
}

export interface RunProjectResult {
  ok: boolean;
  logs: string[];
  warnings: string[];
  slideCount: number;
  pptx?: PptxGenJS;
  error?: string;
}

type BuildPresentationFunction = (context: any) => Promise<unknown> | unknown;

function extractBuildFunction(moduleExports: any): BuildPresentationFunction | null {
  if (typeof moduleExports === 'function') return moduleExports;
  if (moduleExports && typeof moduleExports.default === 'function') return moduleExports.default;
  if (moduleExports && typeof moduleExports.buildPresentation === 'function') return moduleExports.buildPresentation;
  return null;
}

function stringifyLogArg(arg: unknown): string {
  return typeof arg === 'string' ? arg : JSON.stringify(arg);
}

function loadProjectBuildFunction(projectId: string, fileName: string, logs: string[]): BuildPresentationFunction {
  const filePath = resolveProjectFile(projectId, fileName);
  if (!existsSync(filePath)) {
    throw new Error(`找不到脚本文件：${fileName}`);
  }

  const code = readFileSync(filePath, 'utf8');
  const module = { exports: {} as any };
  const requireProject = (request: string): never => {
    throw new Error(`${fileName} 不允许 require/import 外部模块：${request}`);
  };

  const sandbox = createContext({
    module,
    exports: module.exports,
    require: requireProject,
    console: {
      log: (...args: unknown[]) => logs.push(args.map(stringifyLogArg).join(' ')),
    },
  });
  const script = new Script(code, { filename: `${projectId}/${fileName}` });
  script.runInContext(sandbox, { timeout: 1000 });

  const buildPresentation = extractBuildFunction(module.exports);
  if (!buildPresentation) {
    throw new Error(`${fileName} 必须导出一个函数，例如 module.exports = async function ({ pptx }) { ... }`);
  }

  return buildPresentation;
}

export async function runProject({ projectId }: RunProjectOptions): Promise<RunProjectResult> {
  const logs: string[] = [];
  const warnings: string[] = [];
  const projectDir = getProjectDir(projectId);

  try {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    const assert = createScriptAssert(message => warnings.push(message));
    const store: Record<string, unknown> = {};

    const runProjectScript = async (fileName: string, extraContext: Record<string, unknown> = {}) => {
      const buildPresentation = loadProjectBuildFunction(projectId, fileName, logs);
      return await buildPresentation({
        pptx,
        pptxgenjs: PptxGenJS,
        getResourceUrl: (resourceFileName: string) => `http://localhost:3101/${projectId}/${encodeURIComponent(resourceFileName)}`,
        getResourcePath: (resourceFileName: string) => resolveProjectFile(projectId, resourceFileName),
        log: (...args: unknown[]) => logs.push(args.map(stringifyLogArg).join(' ')),
        assert,
        measureText,
        projectId,
        projectDir,
        path,
        store,
        addPage,
        addSlide,
        ...extraContext,
      });
    };

    const addPage = async (fileName: string) => {
      const slide = pptx.addSlide();
      await runProjectScript(fileName, { slide });
      return slide;
    };
    const addSlide = addPage;

    const output = await runProjectScript('index.js');
    const finalPptx = output instanceof PptxGenJS ? output : pptx;
    if (warnings.length) console.warn(`[PPT 脚本提醒] 项目 ${projectId}:\n${warnings.join('\n')}`);
    return { ok: true, logs, warnings, slideCount: (finalPptx as any)._slides?.length ?? 0, pptx: finalPptx };
  } catch (error) {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[PPT 脚本异常] 项目 ${projectId}: ${detail}`);
    if (logs.length) console.error(`[PPT 脚本日志] 项目 ${projectId}:\n${logs.join('\n')}`);
    if (warnings.length) console.warn(`[PPT 脚本提醒] 项目 ${projectId}:\n${warnings.join('\n')}`);
    return {
      ok: false,
      logs,
      warnings,
      slideCount: 0,
      error: error instanceof Error ? error.stack || error.message : String(error),
    };
  }
}
