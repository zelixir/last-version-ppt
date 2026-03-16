import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { calculateSafeTextBoxHeight } from './ppt-text-layout.ts';

const COVER_TITLE_HEIGHT = calculateSafeTextBoxHeight(88);
const PAGE_TITLE_HEIGHT = calculateSafeTextBoxHeight(72);
const SECTION_TITLE_HEIGHT = calculateSafeTextBoxHeight(56);
const BODY_TEXT_HEIGHT = calculateSafeTextBoxHeight(48);
const THREE_LINE_BODY_HEIGHT = calculateSafeTextBoxHeight(48, 3);

export const APP_FOLDER_NAME = 'last-version-ppt';
export const DEFAULT_INDEX_JS = `module.exports = async function buildPresentation({ pptx, log }) {
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

  const cover = pptx.addSlide();
  cover.background = { color: '0F172A' };
  cover.addText('新的演示文稿', {
    ...textOptions,
    x: page.left,
    y: 0.76,
    w: page.width,
    h: ${COVER_TITLE_HEIGHT},
    fontSize: 88,
    bold: true,
    color: 'FFFFFF'
  });
  cover.addText('请告诉智能助手，这份演示稿要讲什么。', {
    ...textOptions,
    x: page.left,
    y: 2.18,
    w: page.width,
    h: ${SECTION_TITLE_HEIGHT},
    fontSize: 56,
    color: 'CBD5E1'
  });
  cover.addText('有图片、表格或资料时，也可以先上传再说明。', {
    ...textOptions,
    x: page.left,
    y: 3.42,
    w: page.width,
    h: ${BODY_TEXT_HEIGHT},
    fontSize: 48,
    color: 'E2E8F0'
  });

  const agenda = pptx.addSlide();
  agenda.background = { color: 'F8FAFC' };
  agenda.addText('这份演示稿会按下面的结构继续补全', {
    ...textOptions,
    x: page.left,
    y: page.titleTop,
    w: page.width,
    h: ${PAGE_TITLE_HEIGHT},
    fontSize: 72,
    bold: true,
    color: '0F172A'
  });
  [
    { no: '01', title: '封面', desc: '先讲清主题、对象和这次要解决的问题。' },
    { no: '02', title: '目录', desc: '把章节顺序列出来，方便快速理解整份内容。' },
    { no: '03', title: '正文', desc: '按重点内容展开说明，再补数据、方案和下一步。' },
  ].forEach((item, index) => {
    const y = page.sectionTop + index * 1.62;
    agenda.addText(item.no, {
      ...textOptions,
      x: page.left,
      y,
      w: 0.9,
      h: ${SECTION_TITLE_HEIGHT},
      fontSize: 56,
      bold: true,
      color: '2563EB'
    });
    agenda.addText(item.title, {
      ...textOptions,
      x: 1.9,
      y: y + 0.04,
      w: 2.6,
      h: ${BODY_TEXT_HEIGHT},
      fontSize: 48,
      bold: true,
      color: '0F172A'
    });
    agenda.addText(item.desc, {
      ...textOptions,
      x: 4.94,
      y: y + 0.04,
      w: 6.98,
      h: ${BODY_TEXT_HEIGHT},
      fontSize: 48,
      color: '475569'
    });
  });

  const body = pptx.addSlide();
  body.background = { color: 'FFFFFF' };
  body.addText('你可以继续这样完善正文', {
    ...textOptions,
    x: page.left,
    y: page.titleTop,
    w: page.width,
    h: ${PAGE_TITLE_HEIGHT},
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
  body.addText('核心信息', {
    ...textOptions,
    x: page.left,
    y: 1.56,
    w: 3.4,
    h: ${SECTION_TITLE_HEIGHT},
    fontSize: 56,
    bold: true,
    color: '0F172A'
  });
  body.addText('• 这一页写结论\\n• 下一行补原因\\n• 最后一行写动作', {
    ...textOptions,
    x: page.left,
    y: 2.52,
    w: 5.24,
    h: ${THREE_LINE_BODY_HEIGHT},
    fontSize: 48,
    color: '334155'
  });
  body.addText('关键数字', {
    ...textOptions,
    x: 6.32,
    y: 1.56,
    w: 2.7,
    h: ${SECTION_TITLE_HEIGHT},
    fontSize: 56,
    bold: true,
    color: '1D4ED8'
  });
  body.addText('把最重要的结果放在这里。', {
    ...textOptions,
    x: 6.32,
    y: 2.52,
    w: 5.2,
    h: ${BODY_TEXT_HEIGHT},
    fontSize: 48,
    color: '1E3A8A'
  });
  body.addText('下一步动作', {
    ...textOptions,
    x: 6.32,
    y: 4.14,
    w: 3.2,
    h: ${SECTION_TITLE_HEIGHT},
    fontSize: 56,
    bold: true,
    color: '0F172A'
  });
  body.addText('写清负责人、时间和结果。', {
    ...textOptions,
    x: 6.32,
    y: 5.1,
    w: 5.16,
    h: ${BODY_TEXT_HEIGHT},
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
