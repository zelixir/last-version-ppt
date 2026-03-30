import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

export const APP_FOLDER_NAME = 'last-version-ppt';
const MAX_PROJECT_ID_SUFFIX = 10_000;
export const DEFAULT_INDEX_JS = `module.exports = async function buildPresentation({ pptx, measureText, log, assert, addPage, store }) {
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'last-version-ppt';
  pptx.subject = '自动生成演示文稿';
  pptx.title = '新的演示文稿';

  const slideBounds = { x: 0, y: 0, w: 13.333, h: 7.5 };
  const page = {
    left: 0.72,
    width: 11.56,
    titleTop: 0.52,
    coverTop: 0.76,
    contentGap: 0.38,
  };
  const fontFace = 'Microsoft YaHei';
  const textOptions = { fontFace, margin: 0, breakLine: false };
  const BOX_TOLERANCE = 0.01;
  const MIN_TEXT_BOX_WIDTH = 0.6;
  const SAFE_WIDTH_RATIO = 0.96;
  const round = value => Math.ceil(value * 100) / 100;
  const addSlack = (widthInches, slack = 0.18) => round(widthInches + slack);
  const overlaps = (first, second) => (
    first.x < second.x + second.w - BOX_TOLERANCE
    && first.x + first.w > second.x + BOX_TOLERANCE
    && first.y < second.y + second.h - BOX_TOLERANCE
    && first.y + first.h > second.y + BOX_TOLERANCE
  );
  const createTextLayout = (slideName, defaultBounds = slideBounds) => {
    const placedBoxes = [];
    return {
      check(name, rect, metrics, options = {}) {
        const bounds = options.bounds ?? defaultBounds;
        const expectedLines = options.expectedLines ?? 1;
        assert(rect.x >= bounds.x - BOX_TOLERANCE && rect.y >= bounds.y - BOX_TOLERANCE, slideName + '：' + name + ' 超出了起始边界');
        assert(rect.x + rect.w <= bounds.x + bounds.w + BOX_TOLERANCE, slideName + '：' + name + ' 超出了右侧边界');
        assert(rect.y + rect.h <= bounds.y + bounds.h + BOX_TOLERANCE, slideName + '：' + name + ' 超出了底部边界');
        assert(metrics.lines === expectedLines, slideName + '：' + name + ' 发生了非预期换行，当前 ' + metrics.lines + ' 行，预期 ' + expectedLines + ' 行');
        for (const previous of placedBoxes) {
          assert(!overlaps(previous.rect, rect), slideName + '：' + previous.name + ' 和 ' + name + ' 发生重叠');
        }
        placedBoxes.push({ name, rect });
      }
    };
  };
  const addMeasuredText = async (slide, layout, text, options) => {
    const {
      name,
      x,
      y,
      maxWidth,
      bounds,
      expectedLines = Math.max(1, String(text).split(/\r?\n/u).length),
      widthSlack = 0.18,
      ...textStyle
    } = options;
    const naturalMetrics = await measureText(text, { fontSize: textStyle.fontSize, fontFace });
    const requiredWidth = naturalMetrics.widthInches / SAFE_WIDTH_RATIO;
    const width = Math.min(maxWidth, Math.max(MIN_TEXT_BOX_WIDTH, addSlack(requiredWidth, widthSlack)));
    const metrics = await measureText(text, { fontSize: textStyle.fontSize, fontFace, width });
    slide.addText(text, { ...textOptions, ...textStyle, x, y, w: width, h: metrics.safeHeight });
    const rect = { x, y, w: width, h: metrics.safeHeight };
    layout.check(name, rect, metrics, { bounds, expectedLines });
    return { ...metrics, ...rect, bottom: y + metrics.safeHeight };
  };

  store.page = page;
  store.slideBounds = slideBounds;
  store.fontFace = fontFace;
  store.textOptions = textOptions;
  store.round = round;
  store.createTextLayout = createTextLayout;
  store.addMeasuredText = addMeasuredText;

  await addPage('page01.js');
  await addPage('page02.js');
  await addPage('page03.js');

  log('模板已创建，默认包含封面、目录和正文 3 页结构');
};
`;

export const DEFAULT_PAGE_FILES: Record<string, string> = {
  'page01.js': `module.exports = async function buildPage({ slide, store }) {
  slide.background = { color: '0F172A' };
  const coverLayout = store.createTextLayout('封面');
  let coverCursorY = store.page.coverTop;
  const coverTitle = await store.addMeasuredText(slide, coverLayout, '新的演示文稿', {
    name: '封面标题',
    x: store.page.left,
    y: coverCursorY,
    maxWidth: store.page.width,
    fontSize: 88,
    bold: true,
    color: 'FFFFFF',
    widthSlack: 0.28,
  });
  coverCursorY = coverTitle.bottom + 0.44;
  const coverSubtitle = await store.addMeasuredText(slide, coverLayout, '先说清主题。', {
    name: '封面副标题',
    x: store.page.left,
    y: coverCursorY,
    maxWidth: store.page.width,
    fontSize: 56,
    color: 'CBD5E1',
    widthSlack: 0.24,
  });
  coverCursorY = coverSubtitle.bottom + 0.28;
  await store.addMeasuredText(slide, coverLayout, '有资料就上传。', {
    name: '封面说明',
    x: store.page.left,
    y: coverCursorY,
    maxWidth: store.page.width,
    fontSize: 48,
    color: 'E2E8F0',
    widthSlack: 0.24,
  });
};
`,
  'page02.js': `module.exports = async function buildPage({ slide, store, measureText }) {
  slide.background = { color: 'F8FAFC' };
  const agendaLayout = store.createTextLayout('目录');
  const agendaTitle = await store.addMeasuredText(slide, agendaLayout, '演示稿结构', {
    name: '目录标题',
    x: store.page.left,
    y: store.page.titleTop,
    maxWidth: store.page.width,
    fontSize: 72,
    bold: true,
    color: '0F172A',
    widthSlack: 0.32,
  });
  let agendaCursorY = agendaTitle.bottom + 0.28;
  for (const item of [
    { no: '01', title: '封面', desc: '讲清主题重点。' },
    { no: '02', title: '目录', desc: '列出章节顺序。' },
    { no: '03', title: '正文', desc: '展开重点动作。' },
  ]) {
    const rowTop = agendaCursorY;
    const noMetrics = await store.addMeasuredText(slide, agendaLayout, item.no, {
      name: '目录编号 ' + item.no,
      x: store.page.left,
      y: rowTop,
      maxWidth: 1.2,
      fontSize: 56,
      bold: true,
      color: '2563EB',
      widthSlack: 0.1,
    });
    const titlePreview = await measureText(item.title, { fontSize: 48, fontFace: store.fontFace });
    const titleY = rowTop + Math.max(0, store.round((noMetrics.safeHeight - titlePreview.safeHeight) / 2));
    const titleMetrics = await store.addMeasuredText(slide, agendaLayout, item.title, {
      name: '目录标题 ' + item.no,
      x: 2.08,
      y: titleY,
      maxWidth: 2.6,
      fontSize: 48,
      bold: true,
      color: '0F172A',
      widthSlack: 0.16,
    });
    const descPreview = await measureText(item.desc, { fontSize: 48, fontFace: store.fontFace });
    const descY = rowTop + Math.max(0, store.round((noMetrics.safeHeight - descPreview.safeHeight) / 2));
    const descMetrics = await store.addMeasuredText(slide, agendaLayout, item.desc, {
      name: '目录说明 ' + item.no,
      x: 5.02,
      y: descY,
      maxWidth: 6.98,
      fontSize: 48,
      color: '475569',
      widthSlack: 0.2,
    });
    agendaCursorY = Math.max(noMetrics.bottom, titleMetrics.bottom, descMetrics.bottom) + 0.3;
  }
};
`,
  'page03.js': `module.exports = async function buildPage({ slide, store, pptx }) {
  slide.background = { color: 'FFFFFF' };
  const bodyLayout = store.createTextLayout('正文');
  const bodyTitle = await store.addMeasuredText(slide, bodyLayout, '正文这样写', {
    name: '正文标题',
    x: store.page.left,
    y: store.page.titleTop,
    maxWidth: store.page.width,
    fontSize: 72,
    bold: true,
    color: '0F172A',
    widthSlack: 0.28,
  });
  const leftCard = {
    x: store.page.left,
    y: bodyTitle.bottom + 0.32,
    w: 5.4,
    h: 4.4,
  };
  const rightPanel = {
    x: 6.32,
    y: leftCard.y,
    w: 6.1,
    h: 4.4,
  };
  slide.addShape(pptx.ShapeType.roundRect, {
    x: leftCard.x,
    y: leftCard.y,
    w: leftCard.w,
    h: leftCard.h,
    rectRadius: 0.08,
    fill: { color: 'F8FAFC' },
    line: { color: 'E2E8F0', pt: 1 }
  });
  const leftContentBounds = {
    x: leftCard.x,
    y: leftCard.y + 0.22,
    w: leftCard.w - 0.16,
    h: leftCard.h - 0.3,
  };
  const leftTitle = await store.addMeasuredText(slide, bodyLayout, '核心信息', {
    name: '左侧标题',
    x: leftCard.x,
    y: leftCard.y + 0.22,
    maxWidth: 3.4,
    bounds: leftContentBounds,
    fontSize: 56,
    bold: true,
    color: '0F172A',
    widthSlack: 0.18,
  });
  await store.addMeasuredText(slide, bodyLayout, '• 先写结论\n• 再补原因\n• 最后写动作', {
    name: '左侧要点',
    x: leftCard.x,
    y: leftTitle.bottom + 0.28,
    maxWidth: 5.24,
    bounds: leftContentBounds,
    expectedLines: 3,
    fontSize: 48,
    color: '334155',
    widthSlack: 0.22,
  });
  const bodyKeyNumber = await store.addMeasuredText(slide, bodyLayout, '关键数字', {
    name: '右侧标题',
    x: rightPanel.x,
    y: rightPanel.y,
    maxWidth: 3.6,
    bounds: rightPanel,
    fontSize: 56,
    bold: true,
    color: '1D4ED8',
    widthSlack: 0.18,
  });
  const keyResult = await store.addMeasuredText(slide, bodyLayout, '先放关键结果。', {
    name: '右侧结果',
    x: rightPanel.x,
    y: bodyKeyNumber.bottom + 0.12,
    maxWidth: 5.2,
    bounds: rightPanel,
    fontSize: 48,
    color: '1E3A8A',
    widthSlack: 0.2,
  });
  const nextAction = await store.addMeasuredText(slide, bodyLayout, '下一步动作', {
    name: '右侧动作标题',
    x: rightPanel.x,
    y: keyResult.bottom + 0.52,
    maxWidth: 4.2,
    bounds: rightPanel,
    fontSize: 56,
    bold: true,
    color: '0F172A',
    widthSlack: 0.18,
  });
  await store.addMeasuredText(slide, bodyLayout, '写清时间安排。', {
    name: '右侧动作说明',
    x: rightPanel.x,
    y: nextAction.bottom + 0.12,
    maxWidth: 5.16,
    bounds: rightPanel,
    fontSize: 48,
    color: '475569',
    widthSlack: 0.2,
  });
};
`,
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
