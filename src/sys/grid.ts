export type Color =
  | { type: 'default' }
  | { type: 'ansi'; value: number }
  | { type: 'rgb'; r: number; g: number; b: number }

/** All cell attributes are optional: defaults live with the consumer, not here. */
export type CellStyle = {
  fg?: Color
  bg?: Color
  bold?: boolean
  underline?: boolean
}

/** Semantic interaction attached to a cell. The renderer never interprets it. */
export type CellAction = {
  command: string
  /** Text placed on the clipboard instead of running a command, when present. */
  copy?: string
  /** URL opened in a new tab instead of running a command, when present. */
  open?: string
}

export type Cell = CellStyle & {
  char: string
  action?: CellAction
}

export interface ReadonlyCharGrid {
  readonly width: number
  readonly height: number
  get(x: number, y: number): Cell
}

export interface CharGrid extends ReadonlyCharGrid {
  set(x: number, y: number, cell: Cell): void
  resize(width: number, height: number): void
  clear(): void
  /** Shift every row up by one and blank the last row. */
  scroll(): void
}

export function blankCell(): Cell {
  return { char: ' ' }
}

export function sameStyle(a: CellStyle, b: CellStyle): boolean {
  return (
    sameColor(a.fg, b.fg) &&
    sameColor(a.bg, b.bg) &&
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.underline) === Boolean(b.underline)
  )
}

export function sameColor(a: Color | undefined, b: Color | undefined): boolean {
  if (a === b || (a === undefined && b === undefined)) return true
  if (!a || !b) return false
  if (a.type !== b.type) return false
  if (a.type === 'default') return true
  if (a.type === 'ansi') return a.value === (b as { type: 'ansi'; value: number }).value
  const rb = b as { r: number; g: number; b: number }
  return a.r === rb.r && a.g === rb.g && a.b === rb.b
}

export class ArrayCharGrid implements CharGrid {
  width: number
  height: number
  private rows: Cell[][]

  constructor(width: number, height: number) {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.rows = Array.from({ length: this.height }, () => this.makeRow(this.width))
  }

  get(x: number, y: number): Cell {
    return this.rows[y]?.[x] ?? blankCell()
  }

  set(x: number, y: number, cell: Cell): void {
    const row = this.rows[y]
    if (row && x >= 0 && x < this.width) row[x] = cell
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width)
    const h = Math.max(1, height)
    if (w === this.width && h === this.height) return

    const rows: Cell[][] = Array.from({ length: h }, () => this.makeRow(w))
    for (let y = 0; y < Math.min(h, this.rows.length); y++) {
      const source = this.rows[y]
      for (let x = 0; x < Math.min(w, source.length); x++) rows[y][x] = source[x]
    }
    this.width = w
    this.height = h
    this.rows = rows
  }

  clear(): void {
    this.rows = Array.from({ length: this.height }, () => this.makeRow(this.width))
  }

  scroll(): void {
    if (this.rows.length <= 1) {
      this.rows = Array.from({ length: this.height }, () => this.makeRow(this.width))
      return
    }
    this.rows.shift()
    this.rows.push(this.makeRow(this.width))
  }

  private makeRow(width: number): Cell[] {
    return Array.from({ length: width }, blankCell)
  }
}
