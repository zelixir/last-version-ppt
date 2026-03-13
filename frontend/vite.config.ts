import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import path from 'path'

const LIBREOFFICE_PACKAGE_DIR = path.resolve(__dirname, 'node_modules', '@matbee', 'libreoffice-converter')
const LIBREOFFICE_ASSETS = [
  { source: path.join(LIBREOFFICE_PACKAGE_DIR, 'dist', 'browser.worker.global.js'), target: '/libreoffice/browser.worker.global.js' },
  { source: path.join(LIBREOFFICE_PACKAGE_DIR, 'wasm', 'soffice.js'), target: '/wasm/soffice.js' },
  { source: path.join(LIBREOFFICE_PACKAGE_DIR, 'wasm', 'soffice.wasm'), target: '/wasm/soffice.wasm' },
  { source: path.join(LIBREOFFICE_PACKAGE_DIR, 'wasm', 'soffice.data'), target: '/wasm/soffice.data' },
  { source: path.join(LIBREOFFICE_PACKAGE_DIR, 'wasm', 'soffice.worker.js'), target: '/wasm/soffice.worker.js' },
]

const LIBREOFFICE_MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
}

function getLibreOfficeAssetMimeType(filePath: string) {
  return LIBREOFFICE_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function copyLibreOfficeAssets(outputDir: string) {
  for (const asset of LIBREOFFICE_ASSETS) {
    if (!existsSync(asset.source)) continue
    const targetPath = path.join(outputDir, asset.target.replace(/^\/+/, ''))
    mkdirSync(path.dirname(targetPath), { recursive: true })
    copyFileSync(asset.source, targetPath)
  }
}

function libreOfficeAssetsPlugin(): Plugin {
  return {
    name: 'libreoffice-assets',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const requestPath = (req.url || '').split('?')[0]
        const asset = LIBREOFFICE_ASSETS.find(item => item.target === requestPath)
        if (!asset || !existsSync(asset.source)) return next()
        res.statusCode = 200
        res.setHeader('Content-Type', getLibreOfficeAssetMimeType(asset.source))
        res.setHeader('Cache-Control', 'no-cache')
        res.end(readFileSync(asset.source))
      })
    },
    writeBundle(options: { dir?: string }) {
      copyLibreOfficeAssets(options.dir ?? path.resolve(__dirname, 'dist'))
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    codeInspectorPlugin({ bundler: 'vite' }),
    libreOfficeAssetsPlugin(),
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      '/api': 'http://localhost:3101',
      '/ws': {
        target: 'ws://localhost:3101',
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        previewImageTest: path.resolve(__dirname, 'preview-image-test.html'),
      },
    },
  },
})
