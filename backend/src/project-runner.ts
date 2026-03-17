import { readFileSync } from 'fs';
import { createContext, Script } from 'node:vm';
import path from 'path';
import PptxGenJS from 'pptxgenjs';
import { measureText } from './ppt-text-layout.ts';
import { getProjectDir, resolveProjectFile } from './storage.ts';

export interface RunProjectOptions {
  projectId: string;
  includeLogs?: boolean;
}

export interface RunProjectResult {
  ok: boolean;
  logs: string[];
  slideCount: number;
  pptx?: PptxGenJS;
  error?: string;
}

function extractBuildFunction(moduleExports: any): ((context: any) => Promise<unknown> | unknown) | null {
  if (typeof moduleExports === 'function') return moduleExports;
  if (moduleExports && typeof moduleExports.default === 'function') return moduleExports.default;
  if (moduleExports && typeof moduleExports.buildPresentation === 'function') return moduleExports.buildPresentation;
  return null;
}

export async function runProject({ projectId }: RunProjectOptions): Promise<RunProjectResult> {
  const code = readFileSync(resolveProjectFile(projectId, 'index.js'), 'utf8');
  const logs: string[] = [];
  const module = { exports: {} as any };
  const projectDir = getProjectDir(projectId);

  const requireProject = (request: string): never => {
    throw new Error(`index.js 不允许 require/import 外部模块：${request}`);
  };

  try {
    const sandbox = createContext({
      module,
      exports: module.exports,
      require: requireProject,
      console: {
        log: (...args: unknown[]) => logs.push(args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')),
      },
    });
    const script = new Script(code, { filename: `${projectId}/index.js` });
    script.runInContext(sandbox, { timeout: 1000 });
    const buildPresentation = extractBuildFunction(module.exports);
    if (!buildPresentation) {
      throw new Error('index.js 必须导出一个函数，例如 module.exports = async function ({ pptx }) { ... }');
    }

    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';

    const context = {
      pptx,
      pptxgenjs: PptxGenJS,
      getResourceUrl: (fileName: string) => `http://localhost:3101/${projectId}/${encodeURIComponent(fileName)}`,
      getResourcePath: (fileName: string) => resolveProjectFile(projectId, fileName),
      log: (...args: unknown[]) => logs.push(args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')),
      measureText,
      projectId,
      projectDir,
      path,
    };

    const output = await buildPresentation(context);
    const finalPptx = output instanceof PptxGenJS ? output : pptx;
    return { ok: true, logs, slideCount: (finalPptx as any)._slides?.length ?? 0, pptx: finalPptx };
  } catch (error) {
    return {
      ok: false,
      logs,
      slideCount: 0,
      error: error instanceof Error ? error.stack || error.message : String(error),
    };
  }
}
