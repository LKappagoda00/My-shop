import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(process.cwd(), 'src/renderer'),
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4317'
    }
  },
  build: {
    outDir: resolve(process.cwd(), 'out/web'),
    emptyOutDir: true
  }
})
