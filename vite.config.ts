import { defineConfig } from 'vite'

// Relative base: the built site works both as a GitHub Pages project site
// (user.github.io/repo/) and on a bare custom domain, without reconfiguring.
export default defineConfig({
  base: './',
})
