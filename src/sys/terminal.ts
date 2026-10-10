import { ArrayCharGrid, blankCell, type Cell, type CellAction, type CharGrid, type CellStyle, type Color } from './grid.ts'
import { createPipe, type Pipe } from './stream.ts'
import { encodeResize } from './protocol.ts'

export interface TerminalCursor {
  x: number
  y: number
  visible: boolean
}

export interface TerminalSize {
  cols: number
  rows: number
}

/**
 * One terminal endpoint. Knows nothing about HTML, processes or the renderer.
 * It is a terminal emulator: bytes in -> screen state out.
 */
export interface Terminal {
  readonly id: number
  readonly grid: CharGrid
  readonly cursor: TerminalCursor
  /** Feed terminal output. */
  write(data: string): void
  /** Terminal input: keyboard, clicks, resize notifications. */
  readonly stdin: Pipe
  readonly stdout: Pipe
  resize(cols: number, rows: number): void
  size(): TerminalSize
  onChange(listener: () => void): () => void
}

type ParserState = 'text' | 'esc' | 'csi' | 'osc'

const BLANK = blankCell()

export class TerminalImpl implements Terminal {
  readonly id: number
  readonly grid: CharGrid
  readonly stdin: Pipe
  readonly stdout: Pipe

  cursor: TerminalCursor = { x: 0, y: 0, visible: true }

  private state: ParserState = 'text'
  private buf = ''
  private cols: number
  private rows: number
  private style: CellStyle = {}
  private action: CellAction | undefined
  private reverse = false
  private wrapPending = false
  /** wrapped[y] = row y continues into row y+1 (soft wrap, not a newline). */
  private wrapped: boolean[]
  private readonly listeners = new Set<() => void>()

  constructor(id: number, cols: number, rows: number) {
    this.id = id
    this.cols = Math.max(1, cols)
    this.rows = Math.max(1, rows)
    this.grid = new ArrayCharGrid(this.cols, this.rows)
    this.wrapped = Array.from({ length: this.rows }, () => false)
    this.stdin = createPipe()
    this.stdout = createPipe()
  }

  write(data: string): void {
    for (const ch of data) this.feed(ch)
    this.notify()
  }

  resize(cols: number, rows: number): void {
    const c = Math.max(1, cols)
    const r = Math.max(1, rows)
    if (c === this.cols && r === this.rows) return

    if (c !== this.cols) this.reflow(c, r)
    else this.reflowHeight(r)

    this.cols = c
    this.rows = r
    this.stdin.write(encodeResize(c, r))
    this.notify()
  }

  size(): TerminalSize {
    return { cols: this.cols, rows: this.rows }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  private feed(ch: string): void {
    switch (this.state) {
      case 'text':
        this.feedText(ch)
        return
      case 'esc':
        if (ch === '[') {
          this.state = 'csi'
          this.buf = ''
        } else if (ch === ']') {
          this.state = 'osc'
          this.buf = ''
        } else {
          this.state = 'text'
        }
        return
      case 'csi':
        if (/[\x40-\x7e]/.test(ch)) {
          this.state = 'text'
          this.csi(ch)
        } else {
          this.buf += ch
          if (this.buf.length > 64) {
            this.state = 'text'
            this.buf = ''
          }
        }
        return
      case 'osc':
        if (ch === '\x07') {
          this.state = 'text'
          this.osc(this.buf)
          this.buf = ''
        } else if (ch === '\x1b') {
          this.state = 'esc'
          this.osc(this.buf)
          this.buf = ''
        } else {
          this.buf += ch
          if (this.buf.length > 1024) {
            this.state = 'text'
            this.buf = ''
          }
        }
    }
  }

  private feedText(ch: string): void {
    switch (ch) {
      case '\x1b':
        this.state = 'esc'
        return
      case '\n':
      case '\x0b':
      case '\x0c':
        // Cooked tty mode: LF also implies CR (ONLCR).
        this.cursor.x = 0
        this.lineFeed()
        return
      case '\r':
        this.cursor.x = 0
        this.wrapPending = false
        return
      case '\b':
        this.cursor.x = Math.max(0, this.cursor.x - 1)
        this.wrapPending = false
        return
      case '\t': {
        this.cursor.x = Math.min(this.cols - 1, Math.floor(this.cursor.x / 8) * 8 + 8)
        return
      }
      default: {
        const code = ch.codePointAt(0) ?? 0
        if (code < 0x20 || code === 0x7f) return
        this.put(ch)
      }
    }
  }

  private put(ch: string): void {
    if (this.wrapPending && this.cursor.x >= this.cols) {
      // Soft wrap: this row logically continues into the next one.
      this.wrapped[this.cursor.y] = true
      this.cursor.x = 0
      this.lineFeed(true)
    }
    const cell: Cell = { ...this.style, char: ch }
    if (this.action) cell.action = this.action
    this.grid.set(this.cursor.x, this.cursor.y, this.reverse ? withBg(cell) : cell)
    this.cursor.x++
    this.wrapPending = this.cursor.x >= this.cols
    if (this.cursor.x >= this.cols) this.cursor.x = this.cols
  }

  private lineFeed(soft = false): void {
    this.wrapPending = false
    if (!soft) this.wrapped[this.cursor.y] = false
    if (this.cursor.y >= this.rows - 1) {
      this.grid.scroll()
      this.wrapped.shift()
      this.wrapped.push(false)
    } else {
      this.cursor.y++
    }
  }

  /**
   * Width changed: rebuild logical lines from wrapped rows and flow them into
   * the new width, so no characters are lost. Oldest lines scroll off the top.
   */
  private reflow(newCols: number, newRows: number): void {
    const oldCols = this.cols
    const lines: Cell[][] = []
    let current: Cell[] = []
    let base = 0
    let cursorLine = 0
    let cursorOffset = 0

    for (let y = 0; y < this.rows; y++) {
      const row: Cell[] = []
      for (let x = 0; x < oldCols; x++) row.push(this.grid.get(x, y))
      // Trailing blanks are padding, not content: drop them so empty rows
      // do not double the layout when the screen gets narrower.
      let len = row.length
      if (!this.wrapped[y]) {
        while (len > 0) {
          const cell = row[len - 1]
          if (cell.char === ' ' && !cell.bg && !cell.action) len--
          else break
        }
      }
      if (y === this.cursor.y) {
        cursorLine = lines.length
        cursorOffset = base + Math.min(this.cursor.x, len)
      }
      current.push(...row.slice(0, len))
      if (this.wrapped[y]) {
        base += oldCols
      } else {
        lines.push(current)
        current = []
        base = 0
      }
    }
    if (current.length > 0) lines.push(current)

    const rowsOf = (line: Cell[]): number => Math.max(1, Math.ceil(line.length / newCols))

    let start = 0
    let total = lines.reduce((sum, line) => sum + rowsOf(line), 0)
    // Wrapping inflates the layout; blank lines go first — spacing disappears
    // before content does. The cursor's own line never counts as blank.
    while (total > newRows && lines.length > 1) {
      let blank = -1
      let bestDist = -1
      for (let i = 0; i < lines.length; i++) {
        if (i === cursorLine || !isBlankLine(lines[i])) continue
        const dist = Math.abs(i - cursorLine)
        if (dist > bestDist) {
          bestDist = dist
          blank = i
        }
      }
      if (blank < 0) break
      total -= 1
      lines.splice(blank, 1)
      if (blank < cursorLine) cursorLine--
    }
    while (total > newRows && start < lines.length - 1) {
      total -= rowsOf(lines[start])
      if (cursorLine <= start) {
        cursorLine = start + 1
        cursorOffset = 0
      }
      start++
    }
    if (total > newRows && lines.length > start) {
      // A single logical line taller than the screen: keep its tail.
      const keep = newRows * newCols
      const line = lines[start]
      if (line.length > keep) {
        const dropped = line.length - keep
        lines[start] = line.slice(dropped)
        if (cursorLine === start) cursorOffset = Math.max(0, cursorOffset - dropped)
        if (cursorLine < start) {
          cursorLine = start
          cursorOffset = 0
        }
      }
    }

    this.grid.resize(newCols, newRows)
    this.grid.clear()
    this.wrapped = Array.from({ length: newRows }, () => false)

    const lineStart: number[] = []
    let y = 0
    for (let i = start; i < lines.length; i++) {
      const line = lines[i]
      lineStart[i] = y
      if (line.length === 0) {
        y += 1
        continue
      }
      for (let offset = 0; offset < line.length && y < newRows; offset += newCols) {
        const chunk = line.slice(offset, offset + newCols)
        for (let x = 0; x < chunk.length; x++) this.grid.set(x, y, chunk[x])
        if (offset + newCols < line.length) this.wrapped[y] = true
        y++
      }
    }

    const startRow = lineStart[cursorLine] ?? 0
    let cy = startRow + Math.floor(cursorOffset / newCols)
    const cx = cursorOffset % newCols
    if (cy >= newRows) {
      cy = Math.max(0, newRows - 1)
      this.cursor.x = Math.min(cx, newCols - 1)
    } else {
      this.cursor.x = cx
    }
    this.cursor.y = cy
    this.wrapPending = false
  }

  /**
   * Height-only change. Blank rows go first — shrinking eats invisible
   * padding before it eats content — then the oldest rows (the prompt lives
   * at the bottom).
   */
  private reflowHeight(newRows: number): void {
    const oldRows = this.rows
    if (newRows < oldRows) {
      const drop = oldRows - newRows
      // The last row that must survive: one with content, or the cursor's own.
      let last = -1
      for (let y = 0; y < oldRows; y++) {
        if (y === this.cursor.y || this.rowHasContent(y)) last = y
      }
      const blanksBelow = Math.max(0, oldRows - 1 - last)
      const fromBottom = Math.min(drop, blanksBelow)
      const fromTop = drop - fromBottom
      const end = oldRows - fromBottom
      const kept: Cell[][] = []
      for (let y = fromTop; y < end; y++) {
        const row: Cell[] = []
        for (let x = 0; x < this.cols; x++) row.push(this.grid.get(x, y))
        kept.push(row)
      }
      const keptFlags = this.wrapped.slice(fromTop, end)
      this.grid.resize(this.cols, newRows)
      for (let i = 0; i < kept.length; i++) {
        for (let x = 0; x < kept[i].length; x++) this.grid.set(x, i, kept[i][x])
      }
      this.wrapped = keptFlags
      this.cursor.y -= fromTop
      if (this.cursor.y < 0) this.cursor.y = 0
      if (this.cursor.y > newRows - 1) this.cursor.y = newRows - 1
    } else if (newRows > oldRows) {
      this.grid.resize(this.cols, newRows)
      while (this.wrapped.length < newRows) this.wrapped.push(false)
    }
  }

  private rowHasContent(y: number): boolean {
    for (let x = 0; x < this.cols; x++) {
      const cell = this.grid.get(x, y)
      if (cell.char !== ' ' || cell.bg || cell.action) return true
    }
    return false
  }
  private csi(final: string): void {
    const body = this.buf
    const priv = body.startsWith('?')
    const raw = priv ? body.slice(1) : body
    const parts = raw.split(';')
    const n = (i: number, def = 1): number => {
      const v = Number(parts[i])
      return Number.isFinite(v) && v > 0 ? Math.trunc(v) : def
    }

    if (priv) {
      if ((final === 'h' || final === 'l') && parts[0] === '25') this.cursor.visible = final === 'h'
      return
    }

    switch (final) {
      case 'm':
        this.sgr(raw)
        return
      case 'H':
      case 'f':
        this.cursor.y = Math.min(this.rows - 1, n(0) - 1)
        this.cursor.x = Math.min(this.cols - 1, n(1) - 1)
        this.wrapPending = false
        return
      case 'A':
        this.cursor.y = Math.max(0, this.cursor.y - n(0))
        this.wrapPending = false
        return
      case 'B':
        this.cursor.y = Math.min(this.rows - 1, this.cursor.y + n(0))
        this.wrapPending = false
        return
      case 'C':
        this.cursor.x = Math.min(this.cols - 1, this.cursor.x + n(0))
        this.wrapPending = false
        return
      case 'D':
        this.cursor.x = Math.max(0, this.cursor.x - n(0))
        this.wrapPending = false
        return
      case 'G':
        this.cursor.x = Math.min(this.cols - 1, Math.max(0, n(0) - 1))
        this.wrapPending = false
        return
      case 'd':
        this.cursor.y = Math.min(this.rows - 1, Math.max(0, n(0) - 1))
        this.wrapPending = false
        return
      case 'J': {
        const mode = parts[0] === '' ? 0 : n(0, 0)
        if (mode >= 2) {
          this.grid.clear()
          this.wrapped.fill(false)
        } else if (mode === 0) {
          this.eraseFrom(this.cursor.x + this.cursor.y * this.cols, this.cols * this.rows)
        } else if (mode === 1) {
          this.eraseFrom(0, this.cursor.x + this.cursor.y * this.cols + 1)
        }
        return
      }
      case 'K': {
        const mode = parts[0] === '' ? 0 : n(0, 0)
        const base = this.cursor.y * this.cols
        if (mode === 0) this.eraseFrom(base + this.cursor.x, base + this.cols)
        else if (mode === 1) this.eraseFrom(base, base + this.cursor.x + 1)
        else this.eraseFrom(base, base + this.cols)
        return
      }
      default:
        return
    }
  }

  private eraseFrom(from: number, to: number): void {
    const start = Math.max(0, from)
    const end = Math.min(this.cols * this.rows, to)
    const bg = this.style.bg
    for (let i = start; i < end; i++) {
      const x = i % this.cols
      const y = Math.floor(i / this.cols)
      this.grid.set(x, y, bg ? { char: ' ', bg } : { ...BLANK })
    }
  }

  private sgr(raw: string): void {
    const list = raw === '' ? ['0'] : raw.split(';')
    for (let i = 0; i < list.length; i++) {
      const code = Number(list[i] || '0')
      switch (code) {
        case 0:
          this.style = {}
          this.action = undefined
          this.reverse = false
          break
        case 1:
          this.style = { ...this.style, bold: true }
          break
        case 4:
          this.style = { ...this.style, underline: true }
          break
        case 7:
          this.reverse = true
          break
        case 22:
          this.style = { ...this.style, bold: undefined }
          break
        case 24:
          this.style = { ...this.style, underline: undefined }
          break
        case 27:
          this.reverse = false
          break
        case 39:
          this.style = { ...this.style, fg: undefined }
          break
        case 49:
          this.style = { ...this.style, bg: undefined }
          break
        default: {
          const color = readColor(code, list, i)
          if (color.slot) {
            i += color.consumed
            if (color.slot === 'fg') this.style = { ...this.style, fg: color.value }
            else this.style = { ...this.style, bg: color.value }
          }
        }
      }
    }
  }

  private osc(data: string): void {
    const sep = data.indexOf(';')
    if (sep < 0) return
    if (data.slice(0, sep) !== '777') return
    const payload = data.slice(sep + 1)
    const kind = payload.indexOf(';')
    const kindName = kind < 0 ? payload : payload.slice(0, kind)
    const command = kind < 0 ? '' : payload.slice(kind + 1)
    if (kindName === 'copy') {
      if (command) this.action = { command: '', copy: command }
      return
    }
    if (kindName === 'open') {
      if (command) this.action = { command: '', open: command }
      return
    }
    if (kindName !== 'run') return
    if (command) this.action = { command }
  }
}

function readColor(code: number, list: string[], index: number): { slot: 'fg' | 'bg' | null; value: Color; consumed: number } {
  const none = { slot: null, value: { type: 'default' } as Color, consumed: 0 }
  if (code >= 30 && code <= 37) return { slot: 'fg', value: { type: 'ansi', value: code - 30 }, consumed: 0 }
  if (code >= 40 && code <= 47) return { slot: 'bg', value: { type: 'ansi', value: code - 40 }, consumed: 0 }
  if (code >= 90 && code <= 97) return { slot: 'fg', value: { type: 'ansi', value: code - 90 + 8 }, consumed: 0 }
  if (code >= 100 && code <= 107) return { slot: 'bg', value: { type: 'ansi', value: code - 100 + 8 }, consumed: 0 }
  if (code !== 38 && code !== 48) return none
  const slot = code === 38 ? 'fg' : 'bg'
  const mode = Number(list[index + 1])
  if (mode === 5) {
    const v = Number(list[index + 2])
    if (!Number.isFinite(v)) return none
    return { slot, value: { type: 'ansi', value: Math.max(0, Math.min(255, Math.trunc(v))) }, consumed: 2 }
  }
  if (mode === 2) {
    const r = Number(list[index + 2])
    const g = Number(list[index + 3])
    const b = Number(list[index + 4])
    if (![r, g, b].every(Number.isFinite)) return none
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.trunc(v)))
    return { slot, value: { type: 'rgb', r: clamp(r), g: clamp(g), b: clamp(b) }, consumed: 4 }
  }
  return none
}

function withBg(cell: Cell): Cell {
  if (cell.bg) return cell
  return { ...cell, bg: cell.fg ?? { type: 'ansi', value: 7 } }
}

/** A line of nothing but default-background spaces: padding, not content. */
function isBlankLine(line: Cell[]): boolean {
  return line.length === 0 || line.every((cell) => cell.char === ' ' && !cell.bg && !cell.action)
}

