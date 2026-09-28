import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The API has no CORS config; in dev the browser talks to it same-origin through this proxy. API_TARGET lets a
  // second checkout (a worktree) run beside the main one.
  server: {
    proxy: { '/api': { target: process.env.API_TARGET ?? 'http://localhost:3000', rewrite: (path) => path.replace(/^\/api/, '') } },
  },
})
