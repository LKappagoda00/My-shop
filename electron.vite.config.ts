import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(process.cwd(), 'electron/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(process.cwd(), 'electron/preload/index.ts')
      }
    }
  },
  renderer: {
    root: resolve(process.cwd(), 'src/renderer'),
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: resolve(process.cwd(), 'src/renderer/index.html')
      }
    }
  }
})
