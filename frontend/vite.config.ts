import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    codeInspectorPlugin({ bundler: 'vite' }),
  ],
  server: {
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
