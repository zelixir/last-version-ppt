#!/usr/bin/env bun
/**
 * Build script: packages last-version-ppt as a single Windows exe.
 */

import { existsSync, readdirSync, mkdirSync } from 'fs';
import pathModule from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = pathModule.dirname(fileURLToPath(import.meta.url));
const rootDir = pathModule.join(__dirname, '..');
const frontendDir = pathModule.join(rootDir, 'frontend');
const backendDir = pathModule.join(rootDir, 'backend');
const frontendDistDir = pathModule.join(frontendDir, 'dist');
const outputDir = pathModule.join(rootDir, 'dist');

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

console.log('🗜️  Collecting frontend assets for Bun compile...');
const files = collectFiles(frontendDistDir).sort();
console.log(`✅ Collected ${files.length} frontend files`);

if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
const exePath = pathModule.join(outputDir, 'last-version-ppt.exe');

console.log('🔨 Compiling Windows exe (target: bun-windows-x64)...');
console.log(`   Output: ${exePath}`);
const backendBuild = spawnSync(
  'bun',
  [
    'build',
    '--compile',
    '--minify',
    '--target=bun-windows-x64',
    '--loader',
    '.html=file',
    '--loader',
    '.css=file',
    '--define',
    `COMPILED_FRONTEND_DIST_ROOT=${JSON.stringify(frontendDistDir)}`,
    '--outfile',
    exePath,
    pathModule.join(backendDir, 'src', 'index.ts'),
    ...files,
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
console.log('   • Run last-version-ppt.exe — no additional files required');
console.log('   • On first run, providers and models are auto-seeded from built-in examples');
console.log('   • The SQLite database is auto-created in the same directory');
