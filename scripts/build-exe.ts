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
const embeddedCompressionThreshold = 1024 * 1024;
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
  compressed: boolean;
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

function toImportSpecifier(fromDir: string, targetPath: string) {
  const relativePath = pathModule.relative(fromDir, targetPath).replace(/\\/g, '/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
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

function buildEmbeddedResourceEntries(tempDir: string) {
  const compressedDir = pathModule.join(tempDir, 'compressed');
  mkdirSync(compressedDir, { recursive: true });

  const entries: EmbeddedResourceEntry[] = [];

  for (const filePath of collectFiles(frontendDistDir).sort()) {
    const relativePath = pathModule.relative(frontendDistDir, filePath).replace(/\\/g, '/');
    const stats = statSync(filePath);
    let importPath = filePath;
    let compressed = false;
    let embeddedSize = stats.size;

    if (stats.size >= embeddedCompressionThreshold) {
      const compressedPath = pathModule.join(compressedDir, `${entries.length}-${pathModule.basename(filePath)}.gz`);
      const compressedBytes = gzipSync(readFileSync(filePath), { level: 9 });
      writeFileSync(compressedPath, compressedBytes);
      importPath = compressedPath;
      compressed = true;
      embeddedSize = compressedBytes.length;
      console.log(`🗜️  压缩前端资源: ${relativePath} ${formatSize(stats.size)} -> ${formatSize(embeddedSize)}`);
    }

    entries.push({
      logicalPath: `frontend/${relativePath}`,
      importPath,
      compressed,
      originalSize: stats.size,
      embeddedSize,
    });
  }

  for (const fileName of libreofficeWasmFiles) {
    const filePath = pathModule.join(libreofficeWasmDir, fileName);
    const stats = statSync(filePath);
    let importPath = filePath;
    let compressed = false;
    let embeddedSize = stats.size;

    if (stats.size >= embeddedCompressionThreshold) {
      const compressedPath = pathModule.join(compressedDir, `${entries.length}-${fileName}.gz`);
      const compressedBytes = gzipSync(readFileSync(filePath), { level: 9 });
      writeFileSync(compressedPath, compressedBytes);
      importPath = compressedPath;
      compressed = true;
      embeddedSize = compressedBytes.length;
      console.log(`🗜️  压缩 LibreOffice 资源: wasm/${fileName} ${formatSize(stats.size)} -> ${formatSize(embeddedSize)}`);
    }

    entries.push({
      logicalPath: `libreoffice/wasm/${fileName}`,
      importPath,
      compressed,
      originalSize: stats.size,
      embeddedSize,
    });
  }

  return entries;
}

function writeCompileEntry(tempDir: string, resources: EmbeddedResourceEntry[]) {
  const entryPath = pathModule.join(tempDir, 'compiled-entry.ts');
  const registerModulePath = pathModule.join(backendDir, 'src', 'compiled-embedded-files.ts');
  const backendEntryPath = pathModule.join(backendDir, 'src', 'index.ts');
  const importLines = [
    `import { registerCompiledEmbeddedFiles } from ${JSON.stringify(toImportSpecifier(tempDir, registerModulePath))};`,
  ];
  const mappingLines: string[] = [];

  resources.forEach((resource, index) => {
    const variableName = `embeddedFile${index}`;
    importLines.push(
      `import ${variableName} from ${JSON.stringify(toImportSpecifier(tempDir, resource.importPath))} with { type: "file" };`,
    );
    mappingLines.push(
      `  ${JSON.stringify(resource.logicalPath)}: { embeddedName: ${variableName}, compressed: ${resource.compressed} },`,
    );
  });

  const source = `${importLines.join('\n')}

registerCompiledEmbeddedFiles({
${mappingLines.join('\n')}
});

await import(${JSON.stringify(toImportSpecifier(tempDir, backendEntryPath))});
`;

  writeFileSync(entryPath, source);
  return entryPath;
}

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

ensureLibreOfficeSubmoduleReady();

console.log('📦 Preparing embedded resources...');
const tempDir = mkdtempSync(pathModule.join(tmpdir(), 'last-version-ppt-build-'));
const embeddedResources = buildEmbeddedResourceEntries(tempDir);
const frontendResourceCount = embeddedResources.filter(entry => entry.logicalPath.startsWith('frontend/')).length;
const libreofficeResourceCount = embeddedResources.length - frontendResourceCount;
const totalOriginalSize = embeddedResources.reduce((sum, entry) => sum + entry.originalSize, 0);
const totalEmbeddedSize = embeddedResources.reduce((sum, entry) => sum + entry.embeddedSize, 0);
console.log(`✅ 准备完成：前端 ${frontendResourceCount} 个文件，LibreOffice ${libreofficeResourceCount} 个文件`);
console.log(`   嵌入前 ${formatSize(totalOriginalSize)}，处理后 ${formatSize(totalEmbeddedSize)}`);

const compileEntryPath = writeCompileEntry(tempDir, embeddedResources);

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
    `--target=${compileTarget}`,
    '--outfile',
    exePath,
    compileEntryPath,
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
