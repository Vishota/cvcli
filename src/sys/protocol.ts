import type { CellStyle, Color } from './grid.ts'

const CSI = '\x1b['
const ESC_G = '\x07'

/**
 * Strips control characters from application text. Nothing an application
 * prints can introduce an escape sequence of its own.
 */
export function sanitizeText(text: string, keepNewlines = false): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '\t') {
      out += ch
      continue
    }
    if (ch === '\n' && keepNewlines) {
      out += ch
      continue
    }
    if (code < 0x20 || code === 0x7f) continue
    if (code >= 0x80 && code <= 0x9f) continue
    out += ch
  }
  return out
}

function colorParams(color: Color | undefined, base: number): number[] {
  if (!color || color.type === 'default') return [base + 9]
  if (color.type === 'ansi') {
    if (color.value < 8) return [base + color.value]
    if (color.value < 16) return [base + 60 + (color.value - 8)]
    return [base + 8, 5, color.value]
  }
  return [base + 8, 2, color.r, color.g, color.b]
}

/** SGR sequence for a cell style. */
export function encodeStyle(style: CellStyle): string {
  const params: number[] = [0]
  if (style.bold) params.push(1)
  if (style.underline) params.push(4)
  if (style.fg) params.push(...colorParams(style.fg, 30))
  if (style.bg) params.push(...colorParams(style.bg, 40))
  if (params.length === 1) return ''
  return CSI + params.join(';') + 'm'
}

export const RESET = CSI + '0m'

/** OSC 777 — action executed when a cell is clicked. */
export function encodeAction(command: string): string {
  return `\x1b]777;run;${sanitizeText(command)}${ESC_G}`
}

/** Sanitized, style-wrapped text. The only safe way to print user data. */
export function styled(text: string, style: CellStyle = {}, action?: string): string {
  const body = sanitizeText(text, true)
  if (!body) return ''
  return encodeStyle(style) + (action ? encodeAction(action) : '') + body + RESET
}

export const CLEAR_SCREEN = CSI + '2J' + CSI + 'H'
export const CURSOR_HOME = CSI + 'H'
export function moveCursor(x: number, y: number): string {
  return `${CSI}${y + 1};${x + 1}H`
}
export function hideCursor(): string {
  return CSI + '?25l'
}
export function showCursor(): string {
  return CSI + '?25h'
}
export function eraseLine(): string {
  return CSI + 'K'
}

/** Resize notification sent through stdin, xterm style. */
export function encodeResize(cols: number, rows: number): string {
  return `${CSI}8;${rows};${cols}t`
}
