import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { APPLY_PATCH_AGENT_INSTRUCTIONS, APPLY_PATCH_TOOL_DESCRIPTION, applyProjectPatch, parseApplyPatch, recordApplyPatchFailureCase } from './apply-patch.ts';

function withTempProject(run: (projectRoot: string) => void): void {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'last-version-ppt-apply-patch-'));
  try {
    run(projectRoot);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

test('parseApplyPatch reads add, update, and delete operations', () => {
  const patch = [
    '*** Begin Patch',
    '*** Add File: /tmp/example/new.txt',
    '+hello',
    '*** Update File: /tmp/example/index.js',
    '@@',
    '-old',
    '+new',
    '*** Delete File: /tmp/example/old.txt',
    '*** End Patch',
  ].join('\n');

  const parsed = parseApplyPatch(patch);
  assert.ok(parsed);
  assert.equal(parsed?.length, 3);
  assert.deepEqual(parsed?.map(item => item.type), ['create', 'update', 'delete']);
});

test('applyProjectPatch supports add, update, delete, and move in one patch', () => {
  withTempProject(projectRoot => {
    const docsDir = path.join(projectRoot, 'docs');
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(path.join(projectRoot, 'index.js'), 'module.exports = 1;\n', 'utf8');
    writeFileSync(path.join(projectRoot, 'old-name.txt'), 'old value\n', 'utf8');
    writeFileSync(path.join(projectRoot, 'obsolete.txt'), 'remove me\n', 'utf8');

    const patch = [
      '*** Begin Patch',
      `*** Add File: ${path.join(projectRoot, 'docs', 'readme.txt')}`,
      '+hello world',
      `*** Update File: ${path.join(projectRoot, 'index.js')}`,
      '@@',
      '-module.exports = 1;',
      '+module.exports = 2;',
      `*** Update File: ${path.join(projectRoot, 'old-name.txt')}`,
      `*** Move to: ${path.join(projectRoot, 'new-name.txt')}`,
      '@@',
      '-old value',
      '+new value',
      `*** Delete File: ${path.join(projectRoot, 'obsolete.txt')}`,
      '*** End Patch',
    ].join('\n');

    const summary = applyProjectPatch(projectRoot, patch);

    assert.deepEqual(summary.createdFiles, ['docs/readme.txt']);
    assert.deepEqual(summary.deletedFiles, ['obsolete.txt']);
    assert.deepEqual(summary.updatedFiles, ['index.js', 'new-name.txt']);
    assert.deepEqual(summary.movedFiles, [{ from: 'old-name.txt', to: 'new-name.txt' }]);
    assert.equal(readFileSync(path.join(projectRoot, 'docs', 'readme.txt'), 'utf8'), 'hello world');
    assert.equal(readFileSync(path.join(projectRoot, 'index.js'), 'utf8'), 'module.exports = 2;\n');
    assert.equal(readFileSync(path.join(projectRoot, 'new-name.txt'), 'utf8'), 'new value\n');
  });
});

test('applyProjectPatch tolerates missing leading context markers and whitespace fuzz', () => {
  withTempProject(projectRoot => {
    writeFileSync(path.join(projectRoot, 'index.js'), [
      'function demo() {',
      '  const value = 1;   ',
      '  return value;',
      '}',
    ].join('\n'), 'utf8');

    const patch = [
      '*** Begin Patch',
      `*** Update File: ${path.join(projectRoot, 'index.js')}`,
      '@@ function demo() {',
      'const value = 1;',
      '-  return value;',
      '+return value + 1;',
      '}',
      '*** End Patch',
    ].join('\n');

    const summary = applyProjectPatch(projectRoot, patch);
    assert.ok(summary.fuzz > 0);
    assert.equal(readFileSync(path.join(projectRoot, 'index.js'), 'utf8'), [
      'function demo() {',
      '  const value = 1;   ',
      '  return value + 1;',
      '}',
    ].join('\n'));
  });
});

test('applyProjectPatch refuses to delete index.js', () => {
  withTempProject(projectRoot => {
    writeFileSync(path.join(projectRoot, 'index.js'), 'module.exports = 1;\n', 'utf8');

    const patch = [
      '*** Begin Patch',
      `*** Delete File: ${path.join(projectRoot, 'index.js')}`,
      '*** End Patch',
    ].join('\n');

    assert.throws(() => applyProjectPatch(projectRoot, patch), /index\.js/);
  });
});

test('applyProjectPatch treats leading-slash paths as project-relative paths', () => {
  withTempProject(projectRoot => {
    mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
    writeFileSync(path.join(projectRoot, 'index.js'), 'module.exports = 1;\n', 'utf8');

    const patch = [
      '*** Begin Patch',
      '*** Add File: /docs/guide.txt',
      '+第一行',
      '+第二行',
      '*** Update File: /index.js',
      '@@',
      '-module.exports = 1;',
      '+module.exports = 2;',
      '*** End Patch',
    ].join('\n');

    const summary = applyProjectPatch(projectRoot, patch);

    assert.deepEqual(summary.createdFiles, ['docs/guide.txt']);
    assert.deepEqual(summary.updatedFiles, ['index.js']);
    assert.equal(readFileSync(path.join(projectRoot, 'docs', 'guide.txt'), 'utf8'), '第一行\n第二行');
    assert.equal(readFileSync(path.join(projectRoot, 'index.js'), 'utf8'), 'module.exports = 2;\n');
  });
});

test('apply-patch prompt strings expose the complete patch format', () => {
  assert.match(APPLY_PATCH_TOOL_DESCRIPTION, /\*\*\* Begin Patch/);
  assert.match(APPLY_PATCH_TOOL_DESCRIPTION, /Patch := Begin \{ FileOp \} End/);
  assert.match(APPLY_PATCH_TOOL_DESCRIPTION, /\/index\.js/);
  assert.match(APPLY_PATCH_AGENT_INSTRUCTIONS, /apply-patch/);
  assert.match(APPLY_PATCH_AGENT_INSTRUCTIONS, /prefer `apply-patch` over `create-file`/);
  assert.match(APPLY_PATCH_AGENT_INSTRUCTIONS, /leading `\/` still means “inside the current project”/);
  assert.match(APPLY_PATCH_AGENT_INSTRUCTIONS, /input/);
});

test('recordApplyPatchFailureCase stores failure files in a dedicated folder', () => {
  const failDir = path.resolve(process.cwd(), 'apply-patch-fail-case');
  rmSync(failDir, { recursive: true, force: true });
  recordApplyPatchFailureCase({
    projectId: 'case-project',
    input: '*** Begin Patch\n*** End Patch',
    error: new Error('boom'),
  });
  const cases = readdirSync(failDir, { withFileTypes: true }).filter(entry => entry.isDirectory());
  assert.equal(cases.length, 1);
  const caseDir = path.join(failDir, cases[0].name);
  assert.equal(readFileSync(path.join(caseDir, 'patch.diff'), 'utf8'), '*** Begin Patch\n*** End Patch');
  assert.equal(readFileSync(path.join(caseDir, 'source.js'), 'utf8'), '');
  assert.match(readFileSync(path.join(caseDir, 'error.log'), 'utf8'), /projectId: case-project/);
  assert.match(readFileSync(path.join(caseDir, 'error.log'), 'utf8'), /errorMessage: boom/);
  rmSync(failDir, { recursive: true, force: true });
});
