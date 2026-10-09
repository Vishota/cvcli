import './style.css'
import { applications } from './apps/index.ts'
import { createHtmlRenderer } from './renderer/html.ts'
import { KernelImpl, type KernelHost } from './sys/kernel.ts'

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
renderer.mount(root)
kernel.boot('neofetch')
