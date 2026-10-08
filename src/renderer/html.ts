import type { CellAction, CellStyle, Color } from '../sys/grid.ts'
import type { Screen } from '../sys/display.ts'

export interface Renderer {
  mount(element: HTMLElement): void
  destroy(): void
}

const ANSI16 = [
  '#1c1c1e', '#d75f5f', '#87c96b', '#d8b456', '#5f87d7', '#c17ac9', '#5fb7b7', '#c8c8cc',
  '#6b6b70', '#ff8585', '#a8e38a', '#f0d181', '#82aef0', '#d9a1dd', '#8ad9d9', '#f2f2f5',
]
const STEPS = [0, 95, 135, 175, 215, 255]

function cssColor(color: Color | undefined): string | undefined {
  if (!color) return undefined
  if (color.type === 'rgb') return `rgb(${color.r},${color.g},${color.b})`
  if (color.type === 'default') return undefined
  if (color.value < 16) return ANSI16[color.value]
  if (color.value < 232) {
    const i = color.value - 16
    return `rgb(${STEPS[Math.floor(i / 36) % 6]},${STEPS[Math.floor(i / 6) % 6]},${STEPS[i % 6]})`
  }
  const gray = 8 + (color.value - 232) * 10
  return `rgb(${gray},${gray},${gray})`
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function styleKey(style: CellStyle, action: CellAction | undefined, cursor: boolean): string {
  return JSON.stringify([style.fg, style.bg, style.bold, style.underline, action?.command, cursor])
}

function renderRun(style: CellStyle, action: CellAction | undefined, text: string, cursor: boolean): string {
  const parts: string[] = []
  const fg = cssColor(style.fg)
  const bg = cssColor(style.bg)
  if (fg || bg) parts.push(`color:${fg ?? '#d6d6db'};background:${bg ?? 'transparent'}`)
  if (style.bold) parts.push('font-weight:700')
  if (style.underline) parts.push('text-decoration:underline')
  // The cursor is a real block: swap the cell's foreground and background so
  // the glyph underneath stays readable. A filter would invert the page
  // background too, which on a dark screen makes the cursor vanish.
  if (cursor) {
    parts.length = 0
    parts.push(`color:${bg ?? '#0b0b0d'}`, `background:${fg ?? '#d6d6db'}`)
    if (style.bold) parts.push('font-weight:700')
    if (style.underline) parts.push('text-decoration:underline')
    return `<span class="cur" style="${parts.join(';')}">${esc(text)}</span>`
  }
  const attrs = parts.length ? ` style="${parts.join(';')}"` : ''
  const cls = action ? ' class="act"' : ''
  return `<span${cls}${attrs}>${esc(text)}</span>`
}

/** The HTML/CSS adapter. The only class that touches the DOM. */
export function createHtmlRenderer(screen: Screen): Renderer {
  let container: HTMLElement | null = null
  let probe: HTMLElement | null = null
  let rows: HTMLElement[] = []
  let rowCache: string[] = []
  let observer: ResizeObserver | null = null
  let offChange: (() => void) | null = null
  let frame = 0
  let cellWidth = 8
  let cellHeight = 16

  const fit = (): void => {
    if (!container || !probe) return
    const probeRect = probe.getBoundingClientRect()
    const probeChars = probe.textContent?.length || 10
    if (probeRect.width > 0) cellWidth = probeRect.width / probeChars
    if (probeRect.height > 0) cellHeight = probeRect.height
    const cols = Math.max(1, Math.floor(container.clientWidth / cellWidth))
    const rowCount = Math.max(1, Math.floor(container.clientHeight / cellHeight))
    screen.resize(cols, rowCount)
    schedule()
  }

  const schedule = (): void => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      render()
    })
  }

  const rowHtml = (y: number): string => {
    const grid = screen.grid
    const cursor = screen.cursor
    let html = ''
    let buf = ''
    let key = ''
    let style: CellStyle = {}
    let action: CellAction | undefined
    let cursorCell = false
    let open = false

    const flush = (): void => {
      html += renderRun(style, action, buf, cursorCell)
      buf = ''
      open = false
    }

    for (let x = 0; x < grid.width; x++) {
      const cell = grid.get(x, y)
      const isCursor = !!cursor && cursor.visible && cursor.x === x && cursor.y === y
      const nextKey = styleKey(cell, cell.action, isCursor)
      if (open && nextKey !== key) flush()
      if (!open) {
        style = { fg: cell.fg, bg: cell.bg, bold: cell.bold, underline: cell.underline }
        action = cell.action
        cursorCell = isCursor
        key = nextKey
        open = true
      }
      buf += cell.char
    }
    if (open) flush()
    return html || '&nbsp;'
  }

  const render = (): void => {
    if (!container) return
    const grid = screen.grid
    while (rows.length < grid.height) {
      const div = document.createElement('div')
      div.className = 'row'
      container.appendChild(div)
      rows.push(div)
      rowCache.push('')
    }
    while (rows.length > grid.height) {
      rows.pop()?.remove()
      rowCache.pop()
    }
    for (let y = 0; y < grid.height; y++) {
      const html = rowHtml(y)
      if (rowCache[y] !== html) {
        rowCache[y] = html
        rows[y].innerHTML = html
      }
    }
  }
  const onClick = (event: MouseEvent): void => {
    if (!container) return
    const rect = container.getBoundingClientRect()
    const x = Math.floor((event.clientX - rect.left) / cellWidth)
    const y = Math.floor((event.clientY - rect.top) / cellHeight)
    if (x < 0 || y < 0) return
    screen.click(x, y)
  }

  const onKey = (event: KeyboardEvent): void => {
    const data = keyData(event)
    if (data === null) return
    event.preventDefault()
    screen.key(data)
  }

  const onPaste = (event: ClipboardEvent): void => {
    const text = event.clipboardData?.getData('text')
    if (!text) return
    event.preventDefault()
    screen.key(text.replace(/\r/g, '').replace(/\n/g, '\r').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ''))
  }

  return {
    mount(element: HTMLElement): void {
      container = document.createElement('div')
      container.className = 'screen'
      probe = document.createElement('span')
      probe.className = 'probe'
      probe.textContent = 'MMMMMMMMMM'
      container.appendChild(probe)
      element.appendChild(container)

      offChange = screen.subscribe(schedule)
      observer = new ResizeObserver(() => fit())
      observer.observe(element)
      container.addEventListener('click', onClick)
      window.addEventListener('keydown', onKey)
      window.addEventListener('paste', onPaste)
      if (document.fonts) void document.fonts.ready.then(() => fit())
      fit()
    },
    destroy(): void {
      if (frame) cancelAnimationFrame(frame)
      offChange?.()
      observer?.disconnect()
      container?.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
      container?.remove()
      container = null
      probe = null
      rows = []
      rowCache = []
    },
  }
}

// Only keys the browser must keep: everything else ctrl-combos belong to the
// shell (including Ctrl-C, which the shell turns into SIGINT).
const CTRL_KEYS = new Set(['v'])

function keyData(event: KeyboardEvent): string | null {
  if (event.metaKey || event.altKey) return null
  if (event.ctrlKey) {
    const key = event.key.toLowerCase()
    if (key.length === 1 && key >= 'a' && key <= 'z') {
      if (CTRL_KEYS.has(key)) return null
      return String.fromCharCode(key.charCodeAt(0) - 96)
    }
    return null
  }

  switch (event.key) {
    case 'Enter':
      return '\r'
    case 'Backspace':
      return '\x7f'
    case 'Tab':
      return '\t'
    case 'Escape':
      return '\x1b'
    case 'ArrowUp':
      return '\x1b[A'
    case 'ArrowDown':
      return '\x1b[B'
    case 'ArrowRight':
      return '\x1b[C'
    case 'ArrowLeft':
      return '\x1b[D'
    case 'Delete':
      return '\x1b[3~'
    case 'Home':
      return '\x1b[H'
    case 'End':
      return '\x1b[F'
    default:
      if (event.key.length === 1) return event.key
      return null
  }
}

