import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5177,
    /* The gateway is served from this origin in development.

       Same-origin on purpose, not convenience. The session lives in an HttpOnly
       SameSite=Lax cookie, and a cross-origin dev setup would need CORS with
       credentials, an explicit allow-list, and SameSite=None — which is to say
       development would be running a materially weaker cookie policy than
       production, and the difference would only show up in production.

       It also keeps the browser honest about §8.1: there is one origin it can
       reach, and everything behind it is the gateway's business. */
    proxy: {
      '/api': {
        target: process.env.VITE_GATEWAY_ORIGIN ?? 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        /* Split the animation engine out so the shell can paint sooner. */
        manualChunks: (id) =>
          id.includes('node_modules/gsap') || id.includes('@gsap/react')
            ? 'gsap'
            : undefined,
      },
    },
  },
})
