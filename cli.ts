import { applications } from './src/apps/index.ts'
import type { Screen } from './src/sys/display.ts'
import { KernelImpl } from './src/sys/kernel.ts'
import { encodeStyle } from './src/sys/protocol.ts'
import { hostname as osHostname } from 'node:os'

/**
 * Access to the VISHOTA terminal from a real terminal.
 *
 *   pnpm tty                  interactive session (Ctrl+] exits)
 *   pnpm tty "help"           run one command line, print the screen, exit
 *   echo ps | node cli.ts     feed stdin lines as commands, print the screen
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const kernel = new KernelImpl({
  applications,
  host: {
    reboot: () => process.exit(0),
    shutdown: () => process.exit(0),
    describe: () => ({ hostname: osHostname() || 'localhost', runtime: `node ${process.version}` }),
  },
})
const screen: Screen = kernel.screen

function frameAnsi(): string {
  const grid = screen.grid
  let out = '\x1b[?25l\x1b[H\x1b[2J'
  let lastKey = ''
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const cell = grid.get(x, y)
      const key = JSON.stringify([cell.fg, cell.bg, cell.bold, cell.underline])
      if (key !== lastKey) {
        lastKey = key
        out += encodeStyle(cell) || '\x1b[0m'
      }
      out += cell.char
    }
    lastKey = ''
    out += '\x1b[0m'
    if (y < grid.height - 1) out += '\r\n'
  }
  const cursor = screen.cursor
  out += cursor ? `\x1b[${cursor.y + 1};${cursor.x + 1}H` : '\x1b[H'
  return out
}

function frameText(): string {
  const grid = screen.grid
  const rows: string[] = []
  for (let y = 0; y < grid.height; y++) {
    let line = ''
    for (let x = 0; x < grid.width; x++) line += grid.get(x, y).char
    rows.push(line.replace(/\s+$/, ''))
  }
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop()
  return rows.join('\n')
}

function fit(): void {
  screen.resize(process.stdout.columns || 80, process.stdout.rows || 24)
}

async function runLines(lines: string[]): Promise<void> {
  fit()
  kernel.boot()
  await sleep(30)
  for (const line of lines) {
    if (!line.trim()) continue
    screen.key(line)
    screen.key('\r')
    await sleep(60)
  }
  await sleep(120)
  process.stdout.write(frameText() + '\n')
  process.exit(0)
}

function interactive(): void {
  fit()
  // Autostart, same as the web build: the CV screen on top, a shell below.
  kernel.boot('split h2:1 --title "VISHOTA CV" cvui')
  process.stdout.write(frameAnsi())
  screen.subscribe(() => process.stdout.write(frameAnsi()))
  process.stdout.on('resize', () => {
    fit()
  })

  const restore = (): void => {
    process.stdout.write('\x1b[?25h\x1b[0m\n')
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(false)
    }
  }
  process.on('exit', restore)

  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true)
  }
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (data: string) => {
    let buffer = ''
    for (const ch of data) {
      if (ch === '\x1d') {
        // Ctrl+] — leave the harness.
        process.exit(0)
      }
      buffer += ch
    }
    if (buffer) screen.key(buffer)
  })
}

const argvCommand = process.argv.slice(2).join(' ').trim()
if (argvCommand) {
  void runLines([argvCommand])
} else if (process.stdin.isTTY) {
  interactive()
} else {
  let stdinText = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    stdinText += chunk
  })
  process.stdin.on('end', () => {
    void runLines(stdinText.split(/\r?\n/))
  })
}
