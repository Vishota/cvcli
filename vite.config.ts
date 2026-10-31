import { fileURLToPath, URL as NodeURL } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Relative base: the built site works both as a GitHub Pages project site
// (user.github.io/repo/) and on a bare custom domain, without reconfiguring.
// Two HTML entries: the EN root page and the RU /ru/ page — Vite emits
// dist/index.html and dist/ru/index.html, each with correct relative assets.
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(fileURLToPath(new NodeURL('.', import.meta.url)), 'index.html'),
        ru: resolve(fileURLToPath(new NodeURL('.', import.meta.url)), 'ru/index.html'),
      },
    },
  },
})
