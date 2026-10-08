import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this project from /countries/, not the domain root,
// so the production build needs that as its base. Keep the dev server at "/"
// so `npm run dev` still opens cleanly at http://localhost:5173/.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/notes/' : '/',
  plugins: [react()],
}))
