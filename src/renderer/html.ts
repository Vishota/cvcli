import type { CellAction, CellStyle, Color } from '../sys/grid.ts'
import type { Screen } from '../sys/display.ts'
import type { ThemeStore } from '../sys/theme.ts'

export interface Renderer {
  mount(element: HTMLElement): void
  destroy(): void
  /** Cell-size multiplier (the SCALE ladder); the grid re-fits to it. */
  setScale(factor: number): void
}

const STEPS = [0, 95, 135, 175, 215, 255]

/** The HTML/CSS adapter. The only class that touches the DOM. */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Escape a URL for an HTML attribute value. */
function escAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function styleKey(style: CellStyle, action: CellAction | undefined, cursor: boolean): string {
  return JSON.stringify([style.fg, style.bg, style.bold, style.underline, action?.command, action?.open, action?.copy, cursor])
}

/**
 * Paint one run of same-styled cells. The cursor is a real block: it swaps the
 * cell's foreground and background so the glyph underneath stays readable. A
 * filter would invert the page background too, which on a dark screen makes
 * the cursor vanish. An open action becomes a real anchor, so the browser
 * handles the click natively: new tab, middle click, long-press menu.
 */
function renderRun(fg: string | undefined, bg: string | undefined, dFg: string, dBg: string, style: CellStyle, action: CellAction | undefined, openUrl: string | undefined, text: string, cursor: boolean): string {
  const parts: string[] = []
  if (cursor) {
    parts.push(`color:${bg ?? dBg}`, `background:${fg ?? dFg}`)
    if (style.bold) parts.push('font-weight:700')
    if (style.underline) parts.push('text-decoration:underline')
    return `<span class="cur" style="${parts.join(';')}">${esc(text)}</span>`
  }
  if (fg || bg) parts.push(`color:${fg ?? dFg};background:${bg ?? 'transparent'}`)
  if (style.bold) parts.push('font-weight:700')
  if (style.underline) parts.push('text-decoration:underline')
  const attrs = parts.length ? ` style="${parts.join(';')}"` : ''
  if (openUrl) {
    return `<a class="act"${attrs} href="${escAttr(openUrl)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`
  }
  const cls = action ? ' class="act"' : ''
  return `<span${cls}${attrs}>${esc(text)}</span>`
}

/** The HTML/CSS adapter. The only class that touches the DOM. */
export function createHtmlRenderer(screen: Screen, themes?: ThemeStore): Renderer {
  let container: HTMLElement | null = null
  let probe: HTMLElement | null = null
  let rows: HTMLElement[] = []
  let rowCache: string[] = []
  let observer: ResizeObserver | null = null
  let offChange: (() => void) | null = null
  let offTheme: (() => void) | null = null
  let frame = 0
  let cellWidth = 8
  let cellHeight = 16
  let scale = 1

  const defaultFg = (): string => themes?.current.fg ?? '#d6d6db'
  const defaultBg = (): string => themes?.current.bg ?? '#0b0b0d'

  /** Resolve a cell color to CSS. The base 16 come from the active theme. */
  function cssColor(color: Color | undefined): string | undefined {
    if (!color) return undefined
    if (color.type === 'rgb') return `rgb(${color.r},${color.g},${color.b})`
    if (color.type === 'default') return undefined
    if (color.value < 16) return themes ? themes.current.colors[color.value] : undefined
    if (color.value < 232) {
      const i = color.value - 16
      return `rgb(${STEPS[Math.floor(i / 36) % 6]},${STEPS[Math.floor(i / 6) % 6]},${STEPS[i % 6]})`
    }
    const gray = 8 + (color.value - 232) * 10
    return `rgb(${gray},${gray},${gray})`
  }

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
    let openUrl: string | undefined
    let cursorCell = false
    let open = false

    const flush = (): void => {
      const fg = cssColor(style.fg)
      const bg = cssColor(style.bg)
      html += renderRun(fg, bg, defaultFg(), defaultBg(), style, action, openUrl, buf, cursorCell)
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
        openUrl = cell.action?.open
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
    const cell = screen.grid.get(x, y)
    // An open cell is a real anchor: the browser already handled the click
    // (left click, middle click, long press) — nothing left to do here.
    if (cell.action?.open) return
    // A copy cell hands its payload to the clipboard instead of the shell.
    if (cell.action?.copy) {
      void copyText(cell.action.copy)
      return
    }
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

  const applyTheme = (): void => {
    if (container && themes) {
      container.style.background = themes.current.bg
      container.style.color = themes.current.fg
    }
  }

  /**
   * The SCALE controls: one CSS variable multiplies the base font size, and
   * every metric below it is in em — so the probe re-measures the new cell
   * size and the grid re-fits exactly.
   */
  const applyScale = (): void => {
    if (!container) return
    const style = container.style as CSSStyleDeclaration & { setProperty?: (name: string, value: string) => void }
    if (typeof style.setProperty === 'function') style.setProperty('--cv-scale', String(scale))
    fit()
  }

  /** The screen as plain text, for copy / selection. */
  const selectionText = (): string => {
    const grid = screen.grid
    const rows: string[] = []
    for (let y = 0; y < grid.height; y++) {
      let line = ''
      for (let x = 0; x < grid.width; x++) line += grid.get(x, y).char
      rows.push(line.replace(/\s+$/, ''))
    }
    return rows.join('\n')
  }

  const copyText = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* clipboard may be unavailable; the user can still select-and-copy */
    }
  }

  // Right-click behaves like most consoles: a selection is copied, otherwise
  // whatever is on the clipboard is pasted into the focused pane. A real
  // link keeps the browser's own menu (open in new tab, copy link address).
  const onContextMenu = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null
    if (target && typeof target.closest === 'function' && target.closest('a')) return
    event.preventDefault()
    const selected = window.getSelection?.()?.toString() ?? ''
    if (selected) {
      void copyText(selected)
      return
    }
    navigator.clipboard
      ?.readText()
      .then((text) => {
        if (text) screen.key(text.replace(/\r/g, '').replace(/\n/g, '\r').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ''))
      })
      .catch(() => {
        void copyText(selectionText())
      })
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
      applyTheme()
      applyScale()

      offChange = screen.subscribe(schedule)
      offTheme = themes?.subscribe(() => {
        applyTheme()
        // Repaint: the cached per-row HTML embeds the old palette.
        rowCache = []
        schedule()
      }) ?? null
      observer = new ResizeObserver(() => fit())
      observer.observe(element)
      container.addEventListener('click', onClick)
      container.addEventListener('contextmenu', onContextMenu)
      window.addEventListener('keydown', onKey)
      window.addEventListener('paste', onPaste)
      if (document.fonts) void document.fonts.ready.then(() => fit())
      fit()
    },
    setScale(factor: number): void {
      scale = factor
      applyScale()
    },
    destroy(): void {
      if (frame) cancelAnimationFrame(frame)
      offChange?.()
      offTheme?.()
      observer?.disconnect()
      container?.removeEventListener('click', onClick)
      container?.removeEventListener('contextmenu', onContextMenu)
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

