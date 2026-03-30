import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'fs';
import { buildRenamedProjectId, buildUniqueProjectId, createProjectFiles, DEFAULT_INDEX_JS, DEFAULT_PAGE_FILES, DEFAULT_RESOURCE_FILES, getProjectDir, resolveProjectFile } from './storage.ts';
import { doesTextFitSingleLine, recommendSingleLineChars } from './ppt-text-layout.ts';

test('buildRenamedProjectId keeps date prefix', () => {
  assert.equal(buildRenamedProjectId('20260311_old-name', '新的名字'), '20260311_新的名字');
});

test('buildRenamedProjectId keeps version suffix', () => {
  assert.equal(buildRenamedProjectId('20260311_old-name_v02', '品牌介绍'), '20260311_品牌介绍_v02');
});

test('buildUniqueProjectId adds a numeric suffix when the base id is already occupied', () => {
  const occupiedIds = new Set(['20260317_品牌介绍', '20260317_品牌介绍-02']);
  assert.equal(
    buildUniqueProjectId('品牌介绍', projectId => !occupiedIds.has(projectId), new Date('2026-03-17T00:00:00Z')),
    '20260317_品牌介绍-03',
  );
});

test('createProjectFiles 会创建入口脚本、默认分页脚本和模板资源文件', () => {
  const projectId = `storage-project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  createProjectFiles(projectId);
  try {
    assert.equal(readFileSync(resolveProjectFile(projectId, 'index.js'), 'utf8'), DEFAULT_INDEX_JS);
    for (const fileName of Object.keys(DEFAULT_PAGE_FILES)) {
      assert.ok(existsSync(resolveProjectFile(projectId, fileName)), `${fileName} should exist`);
      assert.equal(readFileSync(resolveProjectFile(projectId, fileName), 'utf8'), DEFAULT_PAGE_FILES[fileName]);
    }
    for (const fileName of Object.keys(DEFAULT_RESOURCE_FILES)) {
      assert.ok(existsSync(resolveProjectFile(projectId, fileName)), `${fileName} should exist`);
      assert.equal(readFileSync(resolveProjectFile(projectId, fileName), 'utf8'), DEFAULT_RESOURCE_FILES[fileName]);
    }
  } finally {
    rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});

test('DEFAULT_INDEX_JS uses the verified four-page default template', () => {
  assert.match(DEFAULT_INDEX_JS, /measureText/);
  assert.match(DEFAULT_INDEX_JS, /await addPage\('page01\.js'\)/);
  assert.match(DEFAULT_INDEX_JS, /await addPage\('page04\.js'\)/);
  assert.match(DEFAULT_INDEX_JS, /store\.addMeasuredText/);
  assert.match(DEFAULT_INDEX_JS, /assert/);
  assert.match(DEFAULT_INDEX_JS, /const fontFace = 'Microsoft YaHei'/);
  assert.match(DEFAULT_INDEX_JS, /fontFace, margin: 0/);
  assert.match(DEFAULT_PAGE_FILES['page01.js'], /fontSize: 88/);
  assert.match(DEFAULT_PAGE_FILES['page02.js'], /fontSize: 72/);
  assert.match(DEFAULT_PAGE_FILES['page02.js'], /fontSize: 56/);
  assert.match(DEFAULT_PAGE_FILES['page03.js'], /fontSize: 48/);
  assert.match(DEFAULT_PAGE_FILES['page04.js'], /感谢聆听/);
  assert.match(DEFAULT_INDEX_JS, /margin: 0/);
  assert.match(DEFAULT_PAGE_FILES['page01.js'], /封面/);
  assert.match(DEFAULT_PAGE_FILES['page02.js'], /目录/);
  assert.match(DEFAULT_PAGE_FILES['page03.js'], /正文/);
  assert.match(DEFAULT_PAGE_FILES['page04.js'], /致谢/);
  assert.match(DEFAULT_PAGE_FILES['page01.js'], /cover-background\.svg/);
  assert.match(DEFAULT_PAGE_FILES['page02.js'], /agenda-background\.svg/);
  assert.match(DEFAULT_PAGE_FILES['page04.js'], /thanks-background\.svg/);
  assert.match(DEFAULT_PAGE_FILES['page02.js'], /讲清主题重点/);
  assert.match(DEFAULT_PAGE_FILES['page02.js'], /列出章节顺序/);
  assert.match(DEFAULT_PAGE_FILES['page02.js'], /展开重点动作/);
  assert.match(DEFAULT_PAGE_FILES['page02.js'], /收好结尾语气/);
  assert.match(DEFAULT_PAGE_FILES['page03.js'], /写清时间安排/);
  assert.match(DEFAULT_INDEX_JS, /发生了非预期换行/);
  assert.match(DEFAULT_INDEX_JS, /发生重叠/);
  assert.match(DEFAULT_INDEX_JS, /默认包含封面、目录、正文和致谢 4 页结构/);
  assert.match(DEFAULT_RESOURCE_FILES['背景图片来源.txt'], /Public Domain/);
});

test('DEFAULT_INDEX_JS keeps single-line sample text within the safe character budget', () => {
  const agendaSafeChars = recommendSingleLineChars(6.98, 48);
  const bodySideSafeChars = recommendSingleLineChars(5.16, 48);

  for (const text of [
    '讲清主题重点。',
    '列出章节顺序。',
    '展开重点动作。',
  ]) {
    assert.ok(text.length <= agendaSafeChars, `${text} should fit into the agenda description box`);
  }

  for (const text of [
    '先放关键结果。',
    '写清时间安排。',
  ]) {
    assert.ok(text.length <= bodySideSafeChars, `${text} should fit into the body side text box`);
    assert.ok(doesTextFitSingleLine(text, 5.16, 48), `${text} should pass the stricter single-line width check`);
  }
});
