import './style.css'
import { applications } from './apps/index.ts'
import { cvStore, SCALE_STEPS } from './apps/cvstore.ts'
import { createHtmlRenderer } from './renderer/html.ts'
import { KernelImpl, type KernelHost } from './sys/kernel.ts'
import fontRegularUrl from './assets/fonts/DejaVuSansMono.ttf?url'

function browserName(): string {
  const ua = navigator.userAgent
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Edg\//.test(ua)) return 'Edge'
  if (/Chrome\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return 'unknown'
}

const host: KernelHost = {
  reboot: () => location.reload(),
  shutdown: () => {
    try {
      window.close()
    } catch {
      /* browsers refuse to close script-opened tabs */
    }
  },
  describe: () => ({
    hostname: location.hostname || 'localhost',
    browser: browserName(),
    language: navigator.language,
    platform: navigator.platform,
  }),
}

const kernel = new KernelImpl({ applications, host })
const root = document.getElementById('app')
if (!root) throw new Error('missing #app element')

const renderer = createHtmlRenderer(kernel.screen, kernel.themes)
// Warm the terminal font before the grid paints: the preload reuses the same
// hashed asset the CSS @font-face resolves to, so there is no FOUT reflow.
const fontPreload = document.createElement('link')
fontPreload.rel = 'preload'
fontPreload.as = 'font'
fontPreload.href = fontRegularUrl
fontPreload.crossOrigin = 'anonymous'
document.head.appendChild(fontPreload)
renderer.mount(root)
// The SCALE buttons drive the whole page: the cell size follows the ladder.
renderer.setScale(SCALE_STEPS[cvStore.get().scale])
cvStore.subscribe(() => renderer.setScale(SCALE_STEPS[cvStore.get().scale]))
// Autostart: the intro animation plays first, then it runs whatever follows
// its name as a command — the CV split (cvui on top, shell/neofetch below).
kernel.boot('intro split h2:1 --title "VISHOTA CV" cvui neofetch')
