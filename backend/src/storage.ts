import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import defaultIndexJs from './default-project/index.js.txt';
import defaultPage01Js from './default-project/page01.js.txt';
import defaultPage02Js from './default-project/page02.js.txt';
import defaultPage03Js from './default-project/page03.js.txt';
import defaultPage04Js from './default-project/page04.js.txt';
import defaultAgendaBackgroundSvg from './default-project/agenda-background.svg.txt';
import defaultCoverBackgroundSvg from './default-project/cover-background.svg.txt';
import defaultThanksBackgroundSvg from './default-project/thanks-background.svg.txt';

export const APP_FOLDER_NAME = 'last-version-ppt';
const MAX_PROJECT_ID_SUFFIX = 10_000;
export const DEFAULT_INDEX_JS = defaultIndexJs;

export const DEFAULT_PAGE_FILES: Record<string, string> = {
  'page01.js': defaultPage01Js,
  'page02.js': defaultPage02Js,
  'page03.js': defaultPage03Js,
  'page04.js': defaultPage04Js,
};

export const DEFAULT_RESOURCE_FILES: Record<string, string> = {
  'agenda-background.svg': defaultAgendaBackgroundSvg,
  'cover-background.svg': defaultCoverBackgroundSvg,
  'thanks-background.svg': defaultThanksBackgroundSvg,
};

function resolveStorageRoot(): string {
  if (process.env.APPDATA) return path.join(process.env.APPDATA, APP_FOLDER_NAME);
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support', APP_FOLDER_NAME);
  return path.join(homedir(), '.local', 'share', APP_FOLDER_NAME);
}

export const storageRoot = resolveStorageRoot();
export const projectsRoot = path.join(storageRoot, 'projects');
export const databasePath = path.join(storageRoot, 'last-version-ppt.db');

export function ensureStorageLayout(): void {
  mkdirSync(projectsRoot, { recursive: true });
}

export function formatDateYYYYMMDD(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}${month}${day}`;
}

export function sanitizeProjectName(input: string): string {
  const cleaned = input
    .normalize('NFKC')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  return cleaned || 'project';
}

export function buildProjectId(name: string, date = new Date()): string {
  return `${formatDateYYYYMMDD(date)}_${sanitizeProjectName(name)}`;
}

export function buildUniqueProjectId(
  name: string,
  isAvailable: (projectId: string) => boolean,
  date = new Date(),
): string {
  const baseProjectId = buildProjectId(name, date);
  if (isAvailable(baseProjectId)) {
    return baseProjectId;
  }

  for (let suffix = 2; suffix < MAX_PROJECT_ID_SUFFIX; suffix += 1) {
    const candidateProjectId = `${baseProjectId}-${`${suffix}`.padStart(2, '0')}`;
    if (isAvailable(candidateProjectId)) {
      return candidateProjectId;
    }
  }

  throw new Error('项目编号生成失败，请稍后重试');
}

export function buildRenamedProjectId(projectId: string, name: string): string {
  const safeName = sanitizeProjectName(name);
  const datePrefix = projectId.match(/^\d{8}_/)?.[0] ?? '';
  const versionSuffix = projectId.match(/_v\d{2}$/i)?.[0] ?? '';
  return `${datePrefix}${safeName}${versionSuffix}`;
}

export function stripVersionSuffix(projectId: string): string {
  return projectId.replace(/_v\d{2}$/i, '');
}

export function getProjectDir(projectId: string): string {
  return path.join(projectsRoot, projectId);
}

export function ensureProjectDir(projectId: string): string {
  const dir = getProjectDir(projectId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function createProjectFiles(projectId: string): string {
  const projectDir = ensureProjectDir(projectId);
  const indexPath = path.join(projectDir, 'index.js');
  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, DEFAULT_INDEX_JS, 'utf8');
  }
  for (const [fileName, content] of Object.entries(DEFAULT_PAGE_FILES)) {
    const filePath = path.join(projectDir, fileName);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content, 'utf8');
    }
  }
  for (const [fileName, content] of Object.entries(DEFAULT_RESOURCE_FILES)) {
    const filePath = path.join(projectDir, fileName);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content, 'utf8');
    }
  }
  return projectDir;
}

export function copyProjectDirectory(sourceProjectId: string, targetProjectId: string): void {
  const sourceDir = getProjectDir(sourceProjectId);
  const targetDir = getProjectDir(targetProjectId);
  cpSync(sourceDir, targetDir, { recursive: true, force: true });
}

export function renameProjectDirectory(sourceProjectId: string, targetProjectId: string): void {
  renameSync(getProjectDir(sourceProjectId), getProjectDir(targetProjectId));
}

export function deleteProjectDirectory(projectId: string): void {
  rmSync(getProjectDir(projectId), { recursive: true, force: true });
}

export function listProjectDirectories(): string[] {
  ensureStorageLayout();
  return readdirSync(projectsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => b.localeCompare(a));
}

export function nextVersionProjectId(projectId: string): string {
  const baseId = stripVersionSuffix(projectId);
  const siblings = listProjectDirectories().filter(id => id === baseId || id.startsWith(`${baseId}_v`));
  const maxVersion = siblings.reduce((max, id) => {
    const match = id.match(/_v(\d{2})$/i);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${baseId}_v${`${maxVersion + 1}`.padStart(2, '0')}`;
}

export function resolveProjectFile(projectId: string, fileName: string): string {
  const safeName = fileName.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = safeName.split('/');
  if (!safeName || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('非法文件路径');
  }
  const fullPath = path.resolve(getProjectDir(projectId), safeName);
  const projectDir = path.resolve(getProjectDir(projectId));
  if (!fullPath.startsWith(projectDir + path.sep) && fullPath !== projectDir) {
    throw new Error('非法文件路径');
  }
  return fullPath;
}

export function getFileStatSafe(filePath: string): { size: number; updatedAt: string } {
  const stat = statSync(filePath);
  return { size: stat.size, updatedAt: stat.mtime.toISOString() };
}
