#!/usr/bin/env node
/**
 * Standalone Node.js script for converting PPTX to PNG images using LibreOffice WASM.
 * Invoked as a subprocess by the Bun backend.
 *
 * Input (stdin): JSON { pptxBase64: string, slideCount: number, previewDir: string }
 * Output (stdout): JSON { ok: true, files: string[] } or { ok: false, error: string }
 */

'use strict';

const fs = require('fs');
const path = require('path');

async function main() {
  let inputJson = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    inputJson += chunk;
  }

  const { pptxBase64, slideCount, previewDir } = JSON.parse(inputJson);

  const pptxBuffer = Buffer.from(pptxBase64, 'base64');
  const pages = Array.from({ length: slideCount }, (_, i) => i);

  const pkgDir = path.dirname(require.resolve('@matbee/libreoffice-converter/package.json'));
  const wasmPath = path.join(pkgDir, 'wasm');
  const wasmLoader = require(path.join(pkgDir, 'wasm', 'loader.cjs'));

  const { exportAsImage } = require('@matbee/libreoffice-converter');
  const results = await exportAsImage(pptxBuffer, pages, 'png', {}, { wasmPath, wasmLoader });

  fs.mkdirSync(previewDir, { recursive: true });

  const files = [];
  for (let i = 0; i < results.length; i++) {
    const fileName = `slide-${i + 1}.png`;
    fs.writeFileSync(path.join(previewDir, fileName), Buffer.from(results[i].data));
    files.push(`preview/${fileName}`);
  }

  process.stdout.write(JSON.stringify({ ok: true, files }));
  process.exit(0);
}

main().catch(err => {
  process.stdout.write(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
