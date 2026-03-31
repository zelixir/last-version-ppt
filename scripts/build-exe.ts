#!/usr/bin/env bun
/**
 * Build script: packages last-version-ppt as a single Bun executable.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import pathModule from 'path';
import { gzipSync } from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = pathModule.dirname(fileURLToPath(import.meta.url));
const rootDir = pathModule.join(__dirname, '..');
const frontendDir = pathModule.join(rootDir, 'frontend');
const backendDir = pathModule.join(rootDir, 'backend');
const frontendDistDir = pathModule.join(frontendDir, 'dist');
const outputDir = pathModule.join(rootDir, 'dist');
const compileTarget = process.env.BUN_COMPILE_TARGET || 'bun-windows-x64';
const outputFileName = compileTarget.includes('windows') ? 'last-version-ppt.exe' : 'last-version-ppt';
const embeddedCompressionLogThreshold = 1024 * 1024;
const alwaysCompressExtensions = new Set(['.cjs', '.css', '.html', '.js', '.json', '.mjs']);
const libreofficeWasmDir = pathModule.join(backendDir, 'libreoffice-document-converter', 'wasm');
const libreofficeWasmFiles = [
  'loader.cjs',
  'soffice.cjs',
  'soffice.js',
  'soffice.data',
  'soffice.wasm',
  'soffice.worker.cjs',
  'soffice.worker.js',
  'soffice-bun-worker.cjs',
] as const;

interface EmbeddedResourceEntry {
  logicalPath: string;
  importPath: string;
  originalSize: number;
  embeddedSize: number;
}

function collectFiles(dir: string, results: string[] = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absPath = pathModule.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(absPath, results);
    } else {
      results.push(absPath);
    }
  }
  return results;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function ensureLibreOfficeSubmoduleReady() {
  if (!existsSync(pathModule.join(libreofficeWasmDir, 'loader.cjs'))) {
    console.error('缺少 backend/libreoffice-document-converter/wasm/loader.cjs');
    console.error('请先执行：git submodule update --init --recursive');
    process.exit(1);
  }
}

function assertUniqueEmbeddedFileNames(resources: EmbeddedResourceEntry[]) {
  const fileNameToLogicalPath = new Map<string, string>();

  for (const resource of resources) {
    const embeddedFileName = pathModule.basename(resource.importPath);
    const existingLogicalPath = fileNameToLogicalPath.get(embeddedFileName);
    if (existingLogicalPath) {
      console.error(`嵌入资源文件名重复：${embeddedFileName}`);
      console.error(`  - ${existingLogicalPath}`);
      console.error(`  - ${resource.logicalPath}`);
      console.error('请避免不同资源在嵌入后出现同名文件，否则运行时无法正确定位。');
      process.exit(1);
    }
    fileNameToLogicalPath.set(embeddedFileName, resource.logicalPath);
  }
}

function createCompressedResourcePath(
  compressedDir: string,
  sourceFileName: string,
  logicalPath: string,
  usedCompressedFileNames: Set<string>,
) {
  const compressedFileName = `${sourceFileName}.gz`;
  if (usedCompressedFileNames.has(compressedFileName)) {
    console.error(`压缩后的嵌入资源文件名重复：${compressedFileName}`);
    console.error(`  - ${logicalPath}`);
    console.error('请调整资源命名，避免多个文件在压缩后写入同一个临时文件。');
    process.exit(1);
  }
  usedCompressedFileNames.add(compressedFileName);
  return pathModule.join(compressedDir, compressedFileName);
}

function shouldCompressEmbeddedResource(filePath: string, fileSize: number) {
  return fileSize >= embeddedCompressionLogThreshold || alwaysCompressExtensions.has(pathModule.extname(filePath));
}

function buildEmbeddedResourceEntries(tempDir: string) {
  const compressedDir = pathModule.join(tempDir, 'compressed');
  mkdirSync(compressedDir, { recursive: true });

  const entries: EmbeddedResourceEntry[] = [];
  const usedCompressedFileNames = new Set<string>();

  for (const filePath of collectFiles(frontendDistDir).sort()) {
    const relativePath = pathModule.relative(frontendDistDir, filePath).replace(/\\/g, '/');
    const stats = statSync(filePath);
    let importPath = filePath;
    let embeddedSize = stats.size;
    if (shouldCompressEmbeddedResource(filePath, stats.size)) {
      const compressedPath = createCompressedResourcePath(
        compressedDir,
        pathModule.basename(filePath),
        `frontend/${relativePath}`,
        usedCompressedFileNames,
      );
      const compressedBytes = gzipSync(readFileSync(filePath), { level: 9 });
      writeFileSync(compressedPath, compressedBytes);
      importPath = compressedPath;
      embeddedSize = compressedBytes.length;
      if (stats.size >= embeddedCompressionLogThreshold) {
        console.log(`🗜️  压缩前端资源: ${relativePath} ${formatSize(stats.size)} -> ${formatSize(embeddedSize)}`);
      }
    }

    entries.push({
      logicalPath: `frontend/${relativePath}`,
      importPath,
      originalSize: stats.size,
      embeddedSize,
    });
  }

  for (const fileName of libreofficeWasmFiles) {
    const filePath = pathModule.join(libreofficeWasmDir, fileName);
    const stats = statSync(filePath);
    let importPath = filePath;
    let embeddedSize = stats.size;
    if (shouldCompressEmbeddedResource(filePath, stats.size)) {
      const compressedPath = createCompressedResourcePath(
        compressedDir,
        fileName,
        `libreoffice/wasm/${fileName}`,
        usedCompressedFileNames,
      );
      const compressedBytes = gzipSync(readFileSync(filePath), { level: 9 });
      writeFileSync(compressedPath, compressedBytes);
      importPath = compressedPath;
      embeddedSize = compressedBytes.length;
      if (stats.size >= embeddedCompressionLogThreshold) {
        console.log(`🗜️  压缩 LibreOffice 资源: wasm/${fileName} ${formatSize(stats.size)} -> ${formatSize(embeddedSize)}`);
      }
    }

    entries.push({
      logicalPath: `libreoffice/wasm/${fileName}`,
      importPath,
      originalSize: stats.size,
      embeddedSize,
    });
  }

  return entries;
}

ensureLibreOfficeSubmoduleReady();

console.log('📦 Building frontend...');
const frontendBuild = spawnSync('bun', ['run', 'build'], { cwd: frontendDir, stdio: 'inherit' });
if (frontendBuild.status !== 0) {
  process.exit(frontendBuild.status ?? 1);
}
if (!existsSync(frontendDistDir)) {
  console.error('Frontend build failed: dist directory not found');
  process.exit(1);
}
console.log('✅ Frontend built');

console.log('📦 Preparing embedded resources...');
const tempDir = mkdtempSync(pathModule.join(tmpdir(), 'last-version-ppt-build-'));
const embeddedResources = buildEmbeddedResourceEntries(tempDir);
assertUniqueEmbeddedFileNames(embeddedResources);
const frontendResourceCount = embeddedResources.filter(entry => entry.logicalPath.startsWith('frontend/')).length;
const libreofficeResourceCount = embeddedResources.length - frontendResourceCount;
const totalOriginalSize = embeddedResources.reduce((sum, entry) => sum + entry.originalSize, 0);
const totalEmbeddedSize = embeddedResources.reduce((sum, entry) => sum + entry.embeddedSize, 0);
console.log(`✅ 准备完成：前端 ${frontendResourceCount} 个文件，LibreOffice ${libreofficeResourceCount} 个文件`);
console.log(`   嵌入前 ${formatSize(totalOriginalSize)}，处理后 ${formatSize(totalEmbeddedSize)}`);
const backendEntryPath = pathModule.join(backendDir, 'src', 'index.ts');
const compiledInputPaths = [backendEntryPath, ...embeddedResources.map(resource => resource.importPath)];

if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
const exePath = pathModule.join(outputDir, outputFileName);

console.log(`🔨 Compiling executable (target: ${compileTarget})...`);
console.log(`   Output: ${exePath}`);
const backendBuild = spawnSync(
  'bun',
  [
    'build',
    '--compile',
    '--minify',
    '--define',
    '__LAST_VERSION_PPT_COMPILED__=true',
    `--target=${compileTarget}`,
    '--outfile',
    exePath,
    ...compiledInputPaths,
  ],
  { cwd: rootDir, stdio: 'inherit' }
);
if (backendBuild.status !== 0) {
  process.exit(backendBuild.status ?? 1);
}

console.log('');
console.log('🎉 Build complete!');
console.log(`   Executable: ${exePath}`);
console.log('');
console.log('📋 Distribution notes:');
console.log(`   • Run ${outputFileName} — no additional files required`);
console.log('   • On first run, providers and models are auto-seeded from built-in examples');
console.log('   • The SQLite database is auto-created in the same directory');
