import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3010,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api/platform': {
        target: 'http://localhost:8006',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:8010',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 3010,
  },
})
