import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

export const APP_FOLDER_NAME = 'last-version-ppt';
export const DEFAULT_INDEX_JS = `module.exports = async function buildPresentation({ pptx, measureText, log }) {
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'last-version-ppt';
  pptx.subject = '自动生成演示文稿';
  pptx.title = '新的演示文稿';

  const page = {
    left: 0.72,
    width: 11.56,
    titleTop: 0.52,
    sectionTop: 1.42,
  };
  const textOptions = { margin: 0, breakLine: false };
  const addMeasuredText = (slide, text, options) => {
    const metrics = measureText(text, { fontSize: options.fontSize, width: options.w });
    slide.addText(text, { ...textOptions, ...options, h: metrics.safeHeight });
    return metrics;
  };

  const cover = pptx.addSlide();
  cover.background = { color: '0F172A' };
  let coverCursorY = 0.76;
  const coverTitle = addMeasuredText(cover, '新的演示文稿', {
    x: page.left,
    y: coverCursorY,
    w: page.width,
    fontSize: 88,
    bold: true,
    color: 'FFFFFF'
  });
  coverCursorY += coverTitle.safeHeight + 0.44;
  const coverSubtitle = addMeasuredText(cover, '请告诉智能助手，这份演示稿要讲什么。', {
    x: page.left,
    y: coverCursorY,
    w: page.width,
    fontSize: 56,
    color: 'CBD5E1'
  });
  coverCursorY += coverSubtitle.safeHeight + 0.28;
  addMeasuredText(cover, '有图片、表格或资料时，也可以先上传再说明。', {
    x: page.left,
    y: coverCursorY,
    w: page.width,
    fontSize: 48,
    color: 'E2E8F0'
  });

  const agenda = pptx.addSlide();
  agenda.background = { color: 'F8FAFC' };
  addMeasuredText(agenda, '这份演示稿会按下面的结构继续补全', {
    x: page.left,
    y: page.titleTop,
    w: page.width,
    fontSize: 72,
    bold: true,
    color: '0F172A'
  });
  [
    { no: '01', title: '封面', desc: '先讲清主题和要解决的问题。' },
    { no: '02', title: '目录', desc: '把章节顺序列出来方便理解。' },
    { no: '03', title: '正文', desc: '按重点展开并写动作。' },
  ].forEach((item, index) => {
    const y = page.sectionTop + index * 1.62;
    const noMetrics = addMeasuredText(agenda, item.no, {
      x: page.left,
      y,
      w: 0.9,
      fontSize: 56,
      bold: true,
      color: '2563EB'
    });
    addMeasuredText(agenda, item.title, {
      x: 1.9,
      y: y + Math.max(0, (noMetrics.safeHeight - measureText(item.title, { fontSize: 48, width: 2.6 }).safeHeight) / 2),
      w: 2.6,
      fontSize: 48,
      bold: true,
      color: '0F172A'
    });
    addMeasuredText(agenda, item.desc, {
      x: 4.94,
      y: y + Math.max(0, (noMetrics.safeHeight - measureText(item.desc, { fontSize: 48, width: 6.98 }).safeHeight) / 2),
      w: 6.98,
      fontSize: 48,
      color: '475569'
    });
  });

  const body = pptx.addSlide();
  body.background = { color: 'FFFFFF' };
  addMeasuredText(body, '你可以继续这样完善正文', {
    x: page.left,
    y: page.titleTop,
    w: page.width,
    fontSize: 72,
    bold: true,
    color: '0F172A'
  });
  body.addShape(pptx.ShapeType.roundRect, {
    x: page.left,
    y: 1.56,
    w: 5.4,
    h: 3.82,
    rectRadius: 0.08,
    fill: { color: 'F8FAFC' },
    line: { color: 'E2E8F0', pt: 1 }
  });
  addMeasuredText(body, '核心信息', {
    x: page.left,
    y: 1.56,
    w: 3.4,
    fontSize: 56,
    bold: true,
    color: '0F172A'
  });
  addMeasuredText(body, '• 这一页写结论\\n• 下一行补原因\\n• 最后一行写动作', {
    x: page.left,
    y: 2.52,
    w: 5.24,
    fontSize: 48,
    color: '334155'
  });
  const bodyKeyNumber = addMeasuredText(body, '关键数字', {
    x: 6.32,
    y: 1.56,
    w: 2.7,
    fontSize: 56,
    bold: true,
    color: '1D4ED8'
  });
  const keyResultY = 1.56 + bodyKeyNumber.safeHeight + 0.12;
  const keyResult = addMeasuredText(body, '先放最关键结果。', {
    x: 6.32,
    y: keyResultY,
    w: 5.2,
    fontSize: 48,
    color: '1E3A8A'
  });
  const nextActionY = keyResultY + keyResult.safeHeight + 0.78;
  const nextAction = addMeasuredText(body, '下一步动作', {
    x: 6.32,
    y: nextActionY,
    w: 3.2,
    fontSize: 56,
    bold: true,
    color: '0F172A'
  });
  addMeasuredText(body, '写清时间和负责人。', {
    x: 6.32,
    y: nextActionY + nextAction.safeHeight + 0.12,
    w: 5.16,
    fontSize: 48,
    color: '475569'
  });

  log('模板已创建，默认包含封面、目录和正文 3 页结构');
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
