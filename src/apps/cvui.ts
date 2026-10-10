import type { Application, Syscalls } from '../app.ts'
import { CLEAR_SCREEN, RESET, hideCursor, moveCursor, sanitizeText, showCursor, styled } from '../sys/protocol.ts'
import { applyCvCommand } from './cv.ts'
import { CV_PDF_URL, INTRO, PAGES } from './cvcontent.ts'
import { CV_LANGS, CV_PAGES, SCALE_STEPS, cvStore, type CvState } from './cvstore.ts'
import { gradientLine } from './fetch.ts'
import { readEvents, tokenize } from './shell.ts'
import { COLORS, dim, openLink } from './ui.ts'

// The VISHOTA wordmark, five rows.
const LOGO = [
  ' ',
  '      _/_/_/ _/      _/',
  '   _/       _/      _/',
  '  _/       _/      _/',
  ' _/         _/  _/',
  '  _/_/_/     _/',
]
const LOGO_STEPS = 10
const LOGO_FROM = '#ff2e6b'
const LOGO_TO = '#25f4ee'

// Wide (desktop) layout: a control sidebar on the left, the page on the right.
const SIDEBAR_W = 26
const DIVIDER_X = SIDEBAR_W
const CONTENT_X = SIDEBAR_W + 2
const MIN_WIDE_W = 58
const MIN_WIDE_H = 14

// The four themes the quick buttons stand for.
const FAVORITES: readonly (readonly [string, string])[] = [
  ['D', 'default'],
  ['L', 'light'],
  ['N', 'neon'],
  ['M', 'matrix'],
]

/** Length of a string as painted on screen (escape sequences are invisible). */
function visibleLen(text: string): number {
  return text.replace(/\x1b\[[0-9;:?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, '').length
}

function centerIn(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - visibleLen(text)) / 2))
  return ' '.repeat(pad) + text
}

/** Plain-text word wrap; overlong words break hard. */
function wrapText(text: string, width: number): string[] {
  if (width < 1) return []
  const lines: string[] = []
  let line = ''
  const push = (): void => {
    lines.push(line)
    line = ''
  }
  const place = (word: string): void => {
    while (word.length > width) {
      if (line) push()
      line = word.slice(0, width)
      word = word.slice(width)
      push()
    }
    if (line === '') line = word
    else if (line.length + 1 + word.length <= width) line += ' ' + word
    else {
      push()
      line = word
    }
  }
  for (const paragraph of text.split('\n')) {
    line = ''
    const words = paragraph.split(' ')
    if (words.length === 1 && words[0] === '') {
      push()
      continue
    }
    for (const word of words) place(word)
    push()
  }
  return lines
}

/** Keep the first `max` visible columns of a styled string, styles included. */
function clipVisible(text: string, max: number): string {
  if (max < 1) return ''
  let out = ''
  let len = 0
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\x1b') {
      const next = text[i + 1]
      let j: number
      if (next === '[') {
        j = i + 2
        while (j < text.length && !/[\x40-\x7e]/.test(text[j])) j++
        j++
      } else if (next === ']') {
        j = i + 2
        while (j < text.length && text[j] !== '\x07') j++
        j++
      } else {
        j = i + 1
      }
      out += text.slice(i, j)
      i = j
      continue
    }
    if (len >= max) break
    out += ch
    len++
    i++
  }
  return out === text ? text : out + RESET
}

type Seg = { x: number; text: string }

/** A character-addressed drawing surface; render() turns it into CSI moves. */
class Pane {
  readonly width: number
  readonly height: number
  private readonly rows: Seg[][] = []
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    for (let y = 0; y < height; y++) this.rows.push([])
  }
  put(x: number, y: number, text: string): void {
    if (y < 0 || y >= this.height || x >= this.width || !text) return
    this.rows[y].push({ x, text: clipVisible(text, this.width - x) })
  }
  render(): string {
    let out = ''
    for (let y = 0; y < this.height; y++) {
      const segs = this.rows[y]
      if (segs.length === 0) continue
      segs.sort((a, b) => a.x - b.x)
      for (const seg of segs) out += moveCursor(seg.x, y) + seg.text
    }
    return out
  }
}

/** A sidebar button: [ label ], highlighted while it is the active choice. */
function button(label: string, active: boolean, action: string): string {
  const text = `[ ${label} ]`
  return active
    ? styled(text, { fg: COLORS.brightWhite, bg: COLORS.cyan, bold: true }, action)
    : styled(text, {}, action)
}

/** The theme cycler: < name > steps through every known theme. */
function cycler(name: string): string {
  return styled(`< ${name} >`, { fg: COLORS.cyan, bold: true }, 'cv theme next')
}

/** The [L] [D] [N] [B] quick-theme buttons (the favorites). */
function quickThemes(current: string): string[] {
  return FAVORITES.map(([key, name]) =>
    current === name
      ? styled(`[${key}]`, { fg: COLORS.brightWhite, bg: COLORS.cyan, bold: true }, `cv theme ${name}`)
      : styled(`[${key}]`, {}, `cv theme ${name}`),
  )
}

/** A `** NAME **` sidebar section header. */
function header(label: string): string {
  const stars = Math.max(2, Math.floor((SIDEBAR_W - label.length - 2) / 2))
  const star = '*'.repeat(stars)
  return dim(star) + ' ' + styled(label, { bold: true }) + ' ' + dim(star)
}

type PaintFn = (pane: Pane, y: number) => void
type RowSpec = { prio: 0 | 1 | 2; paint: PaintFn }

/**
 * Fits the sidebar into `height`. Spacing goes first (a lost blank row is
 * invisible), then the wordmark block as a whole, and buttons only as the
 * very last resort.
 */
function fitRows(specs: RowSpec[], height: number): RowSpec[] {
  if (specs.length <= height) return specs
  let kept = specs
  while (kept.length > height) {
    const blank = kept.findIndex((spec) => spec.prio === 1)
    if (blank < 0) break
    kept = kept.filter((_, i) => i !== blank)
  }
  if (kept.length > height) kept = kept.filter((spec) => spec.prio !== 2)
  if (kept.length > height) kept = kept.slice(kept.length - height)
  return kept
}

type BodyLine = { text: string; kind: 'head' | 'bullet' | 'cont' | 'plain' | 'blank' }

/** Page body paragraphs -> wrapped display lines (see cvcontent.ts). */
function pageLines(paragraphs: string[], width: number): BodyLine[] {
  const out: BodyLine[] = []
  for (const raw of paragraphs) {
    const text = sanitizeText(raw)
    if (!text.trim()) {
      out.push({ text: '', kind: 'blank' })
      continue
    }
    if (text.startsWith('# ')) {
      for (const line of wrapText(text.slice(2).trim(), width)) out.push({ text: line, kind: 'head' })
    } else if (text.startsWith('- ')) {
      const wrapped = wrapText(text.slice(2).trim(), Math.max(1, width - 2))
      wrapped.forEach((line, i) => out.push({ text: line, kind: i === 0 ? 'bullet' : 'cont' }))
    } else {
      for (const line of wrapText(text.trim(), width)) out.push({ text: line, kind: 'plain' })
    }
  }
  return out
}

function renderBodyLine(line: BodyLine): string {
  switch (line.kind) {
    case 'head':
      return styled(line.text, { bold: true, underline: true })
    case 'bullet':
      return styled('• ', { fg: COLORS.cyan, bold: true }) + line.text
    case 'cont':
      return '  ' + line.text
    case 'blank':
      return ''
    default:
      return line.text
  }
}


/** The control sidebar: logo, language, theme, scale and menu sections. */
function sidebarSpecs(sys: Syscalls, st: CvState): RowSpec[] {
  const specs: RowSpec[] = []
  const blank = (): RowSpec => ({ prio: 1, paint: () => { } })
  const put = (text: string, prio: 0 | 1 | 2 = 0): RowSpec => ({
    prio,
    paint: (pane, y) => pane.put(0, y, centerIn(text, SIDEBAR_W)),
  })

  // The wordmark, gradient left to right like the neofetch logo.
  const ramp = sys.themeGradient(LOGO_FROM, LOGO_TO, LOGO_STEPS) ?? []
  for (const line of LOGO) {
    specs.push({ prio: 2, paint: (pane, y) => pane.put(1, y, ramp.length ? gradientLine(line, ramp, true) : dim(line)) })
  }
  specs.push(blank())
  specs.push(put(dim('-'.repeat(SIDEBAR_W)), 2))

  // LANGUAGE
  specs.push(blank())
  specs.push(put(header('LANGUAGE')))
  specs.push(blank())
  specs.push(put(CV_LANGS.map((lang) => button(lang.toUpperCase(), st.lang === lang, `cv lang ${lang}`)).join('  ')))

  // THEME: a cycler plus the four favorites.
  const current = sys.themeCurrent()
  specs.push(blank())
  specs.push(put(header('THEME')))
  specs.push(blank())
  specs.push(put(cycler(current)))
  specs.push(put(quickThemes(current).join('  ')))

  // SCALE
  specs.push(blank())
  specs.push(put(header('SCALE')))
  specs.push(blank())
  {
    const percent = `${Math.round(SCALE_STEPS[st.scale] * 100)}%`
    specs.push(put(button('-', false, 'cv scale sub') + '  ' + dim(percent) + '  ' + button('+', false, 'cv scale add')))
  }

  // MENU
  specs.push(blank())
  specs.push(put(header('MENU')))
  for (const page of CV_PAGES) {
    specs.push(blank())
    specs.push(put(button(page, st.page === page, `cv page ${page}`)))
  }
  specs.push(blank())
  specs.push(put(openLink('[ PDF version ]', CV_PDF_URL)))
  return specs
}

/** The wide layout: sidebar on the left, a vertical wall, the page on the right. */
function drawWide(pane: Pane, sys: Syscalls): void {
  const st = cvStore.get()
  for (let y = 0; y < pane.height; y++) pane.put(DIVIDER_X, y, dim('│'))
  const specs = fitRows(sidebarSpecs(sys, st), pane.height)
  specs.forEach((spec, y) => spec.paint(pane, y))
  drawContent(pane, st, CONTENT_X, 0, pane.width - CONTENT_X)
}

/** Intro block, then the active page under its title. */
function drawContent(pane: Pane, st: CvState, x0: number, top: number, width: number): void {
  const innerW = Math.max(1, width - 2)
  let y = top + 1
  const intro = INTRO[st.lang]
  for (const line of intro.text) {
    for (const wrapped of wrapText(sanitizeText(line), innerW)) pane.put(x0, y++, wrapped)
  }
  // The PDF note with a click-to-open link appended to its last line.
  const link = openLink('[ PDF version ]', CV_PDF_URL)
  const noteLines = wrapText(sanitizeText(intro.pdf), Math.max(1, innerW - visibleLen(link) - 1))
  const last = noteLines[noteLines.length - 1] ?? ''
  if (noteLines.length > 0 && visibleLen(last) + 1 + visibleLen(link) <= innerW) {
    for (const line of noteLines) pane.put(x0, y++, line)
    pane.put(x0 + visibleLen(last) + 1, y - 1, link)
  } else {
    for (const line of noteLines) pane.put(x0, y++, line)
    pane.put(x0, y++, link)
  }
  y++ // a blank row, then the page title with its rule
  const title = sanitizeText(PAGES[st.page].title[st.lang]).toUpperCase()
  pane.put(x0, y, styled(title, { bold: true }) + dim(' ' + '─'.repeat(Math.max(0, width - title.length - 1))))
  drawViewport(pane, st, x0, y + 1, width)
}

/** The scrollable page body with a scrollbar and ▲▼ arrows on its right edge. */
function drawViewport(pane: Pane, st: CvState, x0: number, top: number, width: number): void {
  const top2 = Math.min(Math.max(0, top), Math.max(0, pane.height - 1))
  const viewH = Math.max(1, pane.height - top2)
  const barX = x0 + width - 1
  const innerW = Math.max(1, width - 2)
  const lines = pageLines(PAGES[st.page].body[st.lang], innerW)
  const maxScroll = Math.max(0, lines.length - viewH)
  const offset = Math.min(Math.max(0, st.scroll), maxScroll)
  if (st.scroll !== offset) queueMicrotask(() => cvStore.set({ scroll: offset }))
  for (let i = 0; i < viewH; i++) {
    const y = top2 + i
    const line = lines[offset + i]
    if (line) pane.put(x0, y, renderBodyLine(line))
    const thumb = maxScroll > 0 ? Math.round((offset / maxScroll) * (viewH - 1)) : -1
    pane.put(barX, y, i === thumb ? styled('█', { fg: COLORS.cyan }) : dim('│'))
  }
  pane.put(barX, top2, styled('▲', { fg: COLORS.brightCyan, bold: true }, 'cv scroll up'))
  pane.put(barX, top2 + viewH - 1, styled('▼', { fg: COLORS.brightCyan, bold: true }, 'cv scroll down'))
}


/** Pack styled segments into rows of at most `width` visible columns. */
function packRows(items: string[], width: number): string[] {
  const rows: string[] = []
  let current = ''
  for (const item of items) {
    const candidate = current ? current + ' ' + item : item
    if (visibleLen(candidate) <= width) current = candidate
    else {
      if (current) rows.push(current)
      current = item
    }
  }
  if (current) rows.push(current)
  return rows.length > 0 ? rows : ['']
}

/**
 * The compact (narrow) layout: every control folds into packed rows and the
 * page takes whatever height is left — the shape that fits a phone screen.
 */
function drawCompact(pane: Pane, sys: Syscalls): void {
  const st = cvStore.get()
  const current = sys.themeCurrent()
  const percent = `${Math.round(SCALE_STEPS[st.scale] * 100)}%`
  const langs = CV_LANGS.map((lang) => button(lang.toUpperCase(), st.lang === lang, `cv lang ${lang}`))
  const scaleSeg = button('-', false, 'cv scale sub') + ' ' + dim(percent) + ' ' + button('+', false, 'cv scale add')
  const themeSeg = cycler(current) + '  ' + quickThemes(current).join(' ')
  let y = 0
  for (const row of packRows([...langs, scaleSeg], pane.width)) pane.put(0, y++, row)
  for (const row of packRows([themeSeg], pane.width)) pane.put(0, y++, row)
  // The menu: packed buttons, but never at the cost of the page itself.
  const menu = [
    ...CV_PAGES.map((page) => button(page, st.page === page, `cv page ${page}`)),
    openLink('[ PDF ]', CV_PDF_URL),
  ]
  const menuBudget = Math.max(0, pane.height - y - 3)
  for (const row of packRows(menu, pane.width).slice(0, menuBudget)) pane.put(0, y++, row)
  const title = sanitizeText(PAGES[st.page].title[st.lang]).toUpperCase()
  pane.put(0, y, styled(title, { bold: true }) + dim(' ' + '─'.repeat(Math.max(0, pane.width - title.length - 1))))
  drawViewport(pane, st, 0, y + 1, pane.width)
}

const KEY_SCROLL: Record<string, number> = {
  '\x1b[A': -1, // Up
  '\x1b[B': 1, // Down
  '\x1b[5~': -10, // PageUp
  '\x1b[6~': 10, // PageDown
  '\x1b[H': -Number.MAX_SAFE_INTEGER, // Home
  '\x1b[F': Number.MAX_SAFE_INTEGER, // End
}
const RESIZE_RE = /^\x1b\[8;\d+;\d+t$/

export const cvui: Application = {
  name: 'cvui',
  summary: 'the CV screen: pages, language, theme, scale and scroll controls',
  synopsis: 'cvui',
  description: [
    'Draws the interactive CV pane: a control sidebar and a scrollable page.',
    'Up/Down scroll the page; a click on any [ button ] runs its cv command.',
    'Typed cv commands are accepted too — the same grammar as the cv app.',
    'Ctrl-C leaves the screen; a fresh shell then takes the pane over.',
  ],
  async run(context) {
    const sys = context.sys
    let stopped = false
    let resolveExit: (code: number) => void = () => { }
    const done = new Promise<number>((resolve) => {
      resolveExit = resolve
    })
    const finish = (): void => {
      if (stopped) return
      stopped = true
      resolveExit(0)
    }
    context.signal.addEventListener('abort', finish, { once: true })

    const draw = (): void => {
      if (stopped) return
      const size = context.terminal.size()
      const pane = new Pane(Math.max(1, size.cols), Math.max(1, size.rows))
      if (pane.width >= MIN_WIDE_W && pane.height >= MIN_WIDE_H) drawWide(pane, sys)
      else drawCompact(pane, sys)
      context.stdout.write(CLEAR_SCREEN + hideCursor() + pane.render())
    }

    let buffer = ''
    const runLine = (line: string): void => {
      let tokens: string[]
      try {
        tokens = tokenize(line)
      } catch {
        return
      }
      if (tokens[0] === 'cv') applyCvCommand(sys, tokens.slice(1))
    }
    const handle = (data: string): void => {
      if (stopped) return
      for (const item of readEvents(data)) {
        if (item.kind === 'key') {
          if (RESIZE_RE.test(item.seq)) {
            draw()
            continue
          }
          const delta = KEY_SCROLL[item.seq]
          if (delta !== undefined) {
            const state = cvStore.get()
            cvStore.set({ scroll: Math.max(0, state.scroll + delta) })
          }
          continue
        }
        if (item.kind === 'ctrl') {
          if (item.code === 13 || item.code === 10) {
            const line = buffer.trim()
            buffer = ''
            if (line) runLine(line)
          } else if (item.code === 21) {
            buffer = '' // Ctrl-U clears the pending line
          }
          continue
        }
        buffer += item.text
        if (buffer.length > 256) buffer = ''
      }
    }

    const offChange = cvStore.subscribe(draw)
    const offInput = context.stdin.subscribe(handle)
    draw()
    const code = await done
    offChange()
    offInput()
    context.stdout.write(showCursor())
    return code
  },
}

