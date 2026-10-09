import type { Application, ApplicationContext } from '../app.ts'
import { CLEAR_SCREEN, sanitizeText, styled } from '../sys/protocol.ts'
import { COLORS, error } from './ui.ts'

/** Removes ESC sequences (resize notices, stray keys) from raw input. */
export function stripSequences(data: string): string {
  let out = ''
  let i = 0
  while (i < data.length) {
    const ch = data[i]
    if (ch === '\x1b') {
      const next = data[i + 1]
      if (next === '[') {
        i += 2
        while (i < data.length && !/[\x40-\x7e]/.test(data[i])) i++
        i++
      } else if (next === ']') {
        i += 2
        while (i < data.length && data[i] !== '\x07' && data[i] !== '\x1b') i++
        i++
      } else {
        i += 2
      }
      continue
    }
    out += ch
    i++
  }
  return out
}

type Event = { kind: 'text'; text: string } | { kind: 'key'; seq: string } | { kind: 'ctrl'; code: number }

/** Splits raw stdin into plain text, control keys and escape sequences. */
export function readEvents(data: string): Event[] {
  const events: Event[] = []
  let text = ''
  const flush = (): void => {
    if (text) {
      events.push({ kind: 'text', text })
      text = ''
    }
  }
  let i = 0
  while (i < data.length) {
    const ch = data[i]
    if (ch === '\x1b') {
      const next = data[i + 1]
      if (next === '[') {
        flush()
        let seq = '\x1b['
        i += 2
        while (i < data.length && !/[\x40-\x7e]/.test(data[i])) seq += data[i++]
        if (i < data.length) seq += data[i++]
        events.push({ kind: 'key', seq })
        continue
      }
      i += 2
      continue
    }
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) {
      flush()
      events.push({ kind: 'ctrl', code })
      i++
      continue
    }
    text += ch
    i++
  }
  flush()
  return events
}

/** Serializes an event back into raw stdin bytes (used to requeue input). */
function raw(item: Event): string {
  if (item.kind === 'text') return item.text
  if (item.kind === 'key') return item.seq
  return String.fromCharCode(item.code)
}

const KEY_EVENTS = new Map<string, string>([
  ['\x1b[A', 'up'],
  ['\x1b[B', 'down'],
  ['\x1b[C', 'right'],
  ['\x1b[D', 'left'],
  ['\x1b[H', 'home'],
  ['\x1b[F', 'end'],
  ['\x1b[1~', 'home'],
  ['\x1b[4~', 'end'],
  ['\x1b[3~', 'delete'],
])

/** Unix-like tokenizing: quotes, escapes, no shell expansions. */
export function tokenize(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let started = false
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (ch === ' ' || ch === '\t') {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
      i++
      continue
    }
    if (ch === "'") {
      const end = line.indexOf("'", i + 1)
      if (end < 0) throw new Error('unterminated single quote')
      current += line.slice(i + 1, end)
      started = true
      i = end + 1
      continue
    }
    if (ch === '"') {
      started = true
      i++
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) current += line[i + 1]
        else current += line[i]
        i++
      }
      if (i >= line.length) throw new Error('unterminated double quote')
      i++
      continue
    }
    if (ch === '\\' && i + 1 < line.length) {
      current += line[i + 1]
      started = true
      i += 2
      continue
    }
    current += ch
    started = true
    i++
  }
  if (started) tokens.push(current)
  return tokens
}
function longestCommonPrefix(items: string[]): string {
  if (items.length === 0) return ''
  let prefix = items[0]
  for (const item of items.slice(1)) {
    let i = 0
    while (i < prefix.length && i < item.length && prefix[i] === item[i]) i++
    prefix = prefix.slice(0, i)
  }
  return prefix
}

async function executeLine(context: ApplicationContext, line: string, out: (text: string) => void): Promise<number | 'exit'> {
  const trimmed = line.trim()
  if (!trimmed) return 0
  let tokens: string[]
  try {
    tokens = tokenize(trimmed)
  } catch (error_) {
    const message = error_ instanceof Error ? error_.message : String(error_)
    out(error(`sh: ${message}\n`))
    return 1
  }
  const command = tokens[0]
  if (command === 'exit') return 'exit'
  // A nested shell is a normal child: it takes the frame's stdin while it runs
  // and hands the prompt back on exit, exactly like bash inside bash.
  const code = await context.sys.exec(command, tokens.slice(1))
  if (code === 127) out(error(`sh: ${sanitizeText(command)}: command not found\n`))
  return code
}

/** Length of a string as painted on screen (control sequences are invisible). */
function visibleLength(text: string): number {
  return text.replace(/\x1b\[[0-9;:?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, '').length
}

async function interactive(context: ApplicationContext): Promise<number> {
  const hostname = sanitizeText(context.sys.info().host.hostname || 'localhost')
  /** Printable length of the current prompt render; anchor for redraws. */
  let renderLen = 0
  const out = (text: string): void => {
    context.stdout.write(text)
    renderLen = 0
  }
  const chars: string[] = []
  let pos = 0
  const history: string[] = []
  let histIdx = 0
  let savedLine = ''
  let busy = false
  let pending = ''
  let stopped = false
  let resolveExit: (code: number) => void = () => {}
  const done = new Promise<number>((resolve) => {
    resolveExit = resolve
  })
  context.signal.addEventListener('abort', () => resolveExit(130), { once: true })

  const prompt = (): string =>
    '[' +
    styled('guest', { fg: COLORS.green, bold: true }) +
    '@' +
    styled(hostname, { fg: COLORS.cyan, bold: true }) +
    ' ' +
    styled('~', { fg: COLORS.blue, bold: true }) +
    ']$ '

  /**
   * Rewrites the input line. Moves up exactly the rows the previous render
   * occupies, erases downwards, paints the whole line (not just the part left
   * of the cursor) and then walks the cursor back to `pos`.
   */
  const redraw = (): void => {
    if (stopped) return
    const width = Math.max(1, context.terminal.size().cols)
    const rowsUp = Math.floor(renderLen / width)
    const full = prompt() + chars.join('')
    const tail = Math.max(0, visibleLength(full) - visibleLength(prompt()) - pos)
    const back = tail > 0 ? `\x1b[${tail}D` : ''
    context.stdout.write((rowsUp > 0 ? `\x1b[${rowsUp}A` : '') + '\r\x1b[0J' + full + back)
    renderLen = visibleLength(full)
  }

  const setLine = (value: string): void => {
    chars.length = 0
    chars.push(...[...value])
    pos = chars.length
    redraw()
  }

  const finish = async (line: string): Promise<void> => {
    busy = true
    out('\n')
    chars.length = 0
    pos = 0
    const trimmed = line.trim()
    if (trimmed && history[history.length - 1] !== trimmed) history.push(trimmed)
    histIdx = history.length
    savedLine = ''
    const result = await executeLine(context, line, out)
    busy = false
    if (result === 'exit' || stopped) {
      stopped = true
      resolveExit(0)
      return
    }
    if (pending) {
      const data = pending
      pending = ''
      handle(data)
      if (busy) return
    }
    redraw()
  }

  const complete = (): void => {
    const partial = chars.slice(0, pos).join('')
    const match = partial.match(/(\S*)$/)
    const prefix = match?.[1] ?? ''
    if (match && match.index && match.index > 0 && partial[match.index - 1] !== ' ') return
    const names = [...new Set(context.sys.applications().flatMap((app) => [app.name, ...(app.aliases ?? [])])), 'exit'].sort()
    const matches = names.filter((name) => name.startsWith(prefix))
    if (matches.length === 0) return
    const replacement = matches.length === 1 ? matches[0] : longestCommonPrefix(matches)
    if (replacement.length > prefix.length) {
      const start = pos - prefix.length
      chars.splice(start, prefix.length, ...[...replacement])
      pos = start + replacement.length
      redraw()
      return
    }
    if (matches.length > 1) out('\n' + matches.join('  ') + '\n')
    redraw()
  }
  const text = (value: string): void => {
    chars.splice(pos, 0, ...[...value])
    pos += [...value].length
    redraw()
  }

  const event = (name: string): void => {
    switch (name) {
      case 'up':
        if (histIdx > 0) {
          if (histIdx === history.length) savedLine = chars.join('')
          histIdx--
          setLine(history[histIdx])
        }
        return
      case 'down':
        if (histIdx < history.length) {
          histIdx++
          setLine(histIdx === history.length ? savedLine : history[histIdx])
        }
        return
      case 'left':
        pos = Math.max(0, pos - 1)
        redraw()
        return
      case 'right':
        pos = Math.min(chars.length, pos + 1)
        redraw()
        return
      case 'home':
        pos = 0
        redraw()
        return
      case 'end':
        pos = chars.length
        redraw()
        return
      case 'delete':
        if (pos < chars.length) {
          chars.splice(pos, 1)
          redraw()
        }
        return
      default:
        return
    }
  }

  const ctrl = (code: number): void => {
    switch (code) {
      case 13:
      case 10:
        if (!busy) void finish(chars.join(''))
        return
      case 3:
        out('^C\n')
        if (!busy) {
          chars.length = 0
          pos = 0
          histIdx = history.length
          redraw()
        }
        return
      case 12:
        out(CLEAR_SCREEN)
        redraw()
        return
      case 1:
        pos = 0
        redraw()
        return
      case 5:
        pos = chars.length
        redraw()
        return
      case 21:
        chars.splice(0, pos)
        pos = 0
        redraw()
        return
      case 11:
        chars.splice(pos)
        redraw()
        return
      case 23: {
        let end = pos
        while (end > 0 && chars[end - 1] === ' ') end--
        while (end > 0 && chars[end - 1] !== ' ') end--
        chars.splice(end, pos - end)
        pos = end
        redraw()
        return
      }
      case 127:
      case 8:
        if (pos > 0) {
          chars.splice(pos - 1, 1)
          pos--
          redraw()
        }
        return
      case 9:
        if (!busy) complete()
        return
      case 4:
        if (chars.length === 0) {
          stopped = true
          resolveExit(0)
        } else if (pos < chars.length) {
          chars.splice(pos, 1)
          redraw()
        }
        return
      default:
        return
    }
  }

  function handle(data: string): void {
    if (stopped) return
    if (busy) {
      pending += data
      return
    }
    const items = readEvents(data)
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (stopped) return
      if (item.kind === 'text') text(item.text)
      else if (item.kind === 'ctrl') ctrl(item.code)
      else if (/^\x1b\[8;\d+;\d+t$/.test(item.seq)) redraw()
      else event(KEY_EVENTS.get(item.seq) ?? '')
      if (busy) {
        pending += items.slice(i + 1).map(raw).join('')
        return
      }
    }
  }

  const off = context.stdin.subscribe(handle)
  if (!stopped) redraw()
  const code = await done
  off()
  return code
}

export const shell: Application = {
  name: 'shell',
  aliases: ['sh'],
  summary: 'interactive command shell',
  synopsis: 'shell [-c <command>]',
  description: [
    'Interactive shell. Every pane of a split starts one.',
    'Keys: Enter run, Tab complete, Up/Down history, Ctrl-C cancel,',
    'Ctrl-L clear, Ctrl-A/E line start/end, Ctrl-U/K delete, Ctrl-D exit.',
    'Run a single command and exit: shell -c "echo hi"',
  ],
  async run(context) {
    const out = (text: string): void => context.stdout.write(text)
    if (context.args[0] === '-c') {
      const result = await executeLine(context, context.args.slice(1).join(' '), out)
      return result === 'exit' ? 0 : result
    }
    return interactive(context)
  },
}


