import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

export const APP_FOLDER_NAME = 'last-version-ppt';
export const DEFAULT_INDEX_JS = `module.exports = async function buildPresentation({ pptx, getResourceUrl, log }) {
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'last-version-ppt';
  pptx.subject = '自动生成演示文稿';
  pptx.title = '新的演示文稿';

  const slide = pptx.addSlide();
  slide.background = { color: 'F8FAFC' };
  slide.addText('新的演示文稿', {
    x: 0.8,
    y: 0.8,
    w: 11,
    h: 0.8,
    fontSize: 24,
    bold: true,
    color: '0F172A'
  });
  slide.addText('请在右侧告诉智能助手，你想做什么样的演示稿。', {
    x: 0.8,
    y: 1.8,
    w: 11,
    h: 0.6,
    fontSize: 16,
    color: '334155'
  });
  slide.addText('如果需要插图，请先上传资源，再通过 getResourceUrl(文件名) 引用。', {
    x: 0.8,
    y: 2.5,
    w: 11,
    h: 0.8,
    fontSize: 14,
    color: '475569'
  });
  log('模板已创建，等待继续完善这份 PPT');
};
`;

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
