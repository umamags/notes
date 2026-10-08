import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Builds straight into ./public (the web root). PHP lives in ./server and ./public/api.
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: false,
  build: { outDir: 'public', emptyOutDir: false, chunkSizeWarningLimit: 1500, sourcemap: false },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8080' } },
})
