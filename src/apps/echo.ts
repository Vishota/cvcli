import type { Application } from '../app.ts'
import type { CellStyle, Color } from '../sys/grid.ts'
import { encodeAction, encodeStyle, RESET, sanitizeText } from '../sys/protocol.ts'

const NAMED: Record<string, Color> = {
  black: { type: 'ansi', value: 0 },
  red: { type: 'ansi', value: 1 },
  green: { type: 'ansi', value: 2 },
  yellow: { type: 'ansi', value: 3 },
  blue: { type: 'ansi', value: 4 },
  magenta: { type: 'ansi', value: 5 },
  cyan: { type: 'ansi', value: 6 },
  white: { type: 'ansi', value: 7 },
  gray: { type: 'ansi', value: 8 },
  grey: { type: 'ansi', value: 8 },
  brightred: { type: 'ansi', value: 9 },
  brightgreen: { type: 'ansi', value: 10 },
  brightyellow: { type: 'ansi', value: 11 },
  brightblue: { type: 'ansi', value: 12 },
  brightmagenta: { type: 'ansi', value: 13 },
  brightcyan: { type: 'ansi', value: 14 },
  brightwhite: { type: 'ansi', value: 15 },
}

function parseColor(value: string): Color {
  const named = NAMED[value.toLowerCase()]
  if (named) return named
  if (/^#?[0-9a-fA-F]{6}$/.test(value)) {
    const hex = value.replace('#', '')
    return {
      type: 'rgb',
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    }
  }
  if (/^\d+$/.test(value)) {
    const index = Number(value)
    if (index >= 0 && index <= 255) return { type: 'ansi', value: index }
  }
  throw new Error(`unknown color "${value}"`)
}

/** Applies one [tag] body to a style. Unknown attributes are rejected. */
function applyTag(body: string, style: CellStyle): { action?: string } {
  let rest = body
  let action: string | undefined
  const run = rest.match(/(^|\s)run=([\s\S]*)$/)
  if (run) {
    rest = rest.slice(0, run.index ?? 0).trim()
    action = sanitizeText(run[2].trim())
    if (!action) throw new Error('run= requires a command')
  }

  while (rest.length > 0) {
    const match = rest.match(/^\S+/)
    if (!match) break
    const token = match[0]
    rest = rest.slice(token.length).trimStart()
    const eq = token.indexOf('=')
    const name = (eq < 0 ? token : token.slice(0, eq)).toLowerCase()
    const value = eq < 0 ? '' : token.slice(eq + 1)
    switch (name) {
      case 'fg':
      case 'color':
        style.fg = parseColor(value)
        break
      case 'bg':
        style.bg = parseColor(value)
        break
      case 'bold':
        style.bold = true
        break
      case 'underline':
        style.underline = true
        break
      case 'run':
        throw new Error('run= must be the last attribute in a tag')
      default:
        throw new Error(`unknown tag "${name}"`)
    }
  }
  return { action }
}
type Frame = { name: string; style: CellStyle; action?: string }

/**
 * Parses bracket tags and emits terminal output. Application text is
 * sanitized, so nothing can break out of the produced command/state.
 */
export function formatEcho(text: string): string {
  let out = ''
  let buf = ''
  let style: CellStyle = {}
  let action: string | undefined
  const stack: Frame[] = []

  const flush = (): void => {
    const body = sanitizeText(buf, true)
    buf = ''
    if (!body) return
    out += encodeStyle(style) + (action ? encodeAction(action) : '') + body + RESET
  }

  const restore = (): void => {
    const top = stack[stack.length - 1]
    style = top ? { ...top.style } : {}
    action = top?.action
  }

  let i = 0
  while (i < text.length) {
    if (text.startsWith('[[', i)) {
      buf += '['
      i += 2
      continue
    }
    if (text[i] !== '[') {
      buf += text[i]
      i++
      continue
    }
    const end = text.indexOf(']', i + 1)
    if (end < 0) throw new Error('unclosed tag: "]" expected')
    const body = text.slice(i + 1, end)
    i = end + 1
    flush()

    if (body.startsWith('/')) {
      const name = body.slice(1).trim()
      if (stack.length === 0) throw new Error(name ? `tag "${name}" is not open` : 'nothing to close')
      if (!name) {
        stack.pop()
      } else {
        let popped = false
        while (stack.length > 0 && !popped) popped = stack.pop()?.name === name
        if (!popped) throw new Error(`tag "${name}" is not open`)
      }
      restore()
      continue
    }

    const frame: Frame = { name: '', style: { ...style }, action }
    const extra = applyTag(body, frame.style)
    if (extra.action) frame.action = extra.action
    const named = body.match(/^\s*([a-zA-Z]+)\s*$/)
    if (named) frame.name = named[1].toLowerCase()
    stack.push(frame)
    style = { ...frame.style }
    action = frame.action
  }
  if (stack.length > 0) throw new Error('unclosed tag')
  flush()
  return out
}

export const echo: Application = {
  name: 'echo',
  summary: 'print a line of text with optional tags',
  synopsis: 'echo [-n] [-E] <text>',
  description: [
    'Prints text. Brackets start a tag, everything else is literal.',
    '  fg=NAME|HEX|0-255  text color      bg=...     background color',
    '  bold, underline    attributes      /          close the last tag',
    '  run=COMMAND        command run when the text is clicked',
    '  [[                 literal "[",    run= must be the last attribute',
    'Colors: black red green yellow blue magenta white gray + bright* names.',
    'Flags: -n no trailing newline, -E print without interpreting tags.',
    'Text is sanitized: no escape sequence can leave this command.',
  ],
  async run(context) {
    const args = [...context.args]
    let newline = true
    let raw = false
    while (args.length > 0 && args[0].startsWith('-') && args[0] !== '-') {
      const flag = args.shift() ?? ''
      if (flag === '--') break
      if (flag === '-n') newline = false
      else if (flag === '-E') raw = true
      else {
        context.stdout.write(`echo: unknown option "${flag}"\n`)
        return 1
      }
    }
    const text = args.join(' ')
    try {
      const output = raw ? sanitizeText(text) : formatEcho(text)
      context.stdout.write(output + (newline ? '\n' : ''))
      return 0
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      context.stdout.write(`echo: ${sanitizeText(message)}\n`)
      return 1
    }
  },
}

