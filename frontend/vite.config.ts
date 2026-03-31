import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import path from 'path'

const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
} as const

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    codeInspectorPlugin({ bundler: 'vite' }),
  ],
  server: {
    headers: CROSS_ORIGIN_ISOLATION_HEADERS,
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
        pptTextWidthTest: path.resolve(__dirname, 'ppt-text-width-test.html'),
      },
    },
  },
})
