import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The API has no CORS config; in dev the browser talks to it same-origin through this proxy.
  server: {
    proxy: { '/api': { target: 'http://localhost:3000', rewrite: (path) => path.replace(/^\/api/, '') } },
  },
})
