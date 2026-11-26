import path from 'node:path'
import { aui } from '@assistant-ui/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In dev, `npm run dev` serves the UI on :5173 and forwards /api to the FastAPI server.
// In production, FastAPI serves the built files from dist/ on the same port.
export default defineConfig({
  // aui() compiles "use generative" files such as src/toolkit.tsx.
  plugins: [aui(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    allowedHosts: ['superordinary-unvended-lean.ngrok-free.dev'],
    proxy: {
      '/api': 'http://localhost:8001',
    },
  },
})
