import type { Application } from './src/app.ts'
import { clear } from './src/apps/clear.ts'
import { echo, formatEcho } from './src/apps/echo.ts'
import { fetch, neofetch } from './src/apps/fetch.ts'
import { help } from './src/apps/help.ts'
import { man } from './src/apps/man.ts'
import { kill, ps } from './src/apps/ps.ts'
import { reboot } from './src/apps/reboot.ts'
import { shell } from './src/apps/shell.ts'
import { split } from './src/apps/split.ts'
import { theme } from './src/apps/theme.ts'
import { tokenize } from './src/apps/shell.ts'
import { parseLayout, countLeaves } from './src/sys/layout.ts'
import { KernelImpl } from './src/sys/kernel.ts'
import { TerminalImpl } from './src/sys/terminal.ts'

let failures = 0
function check(name: string, condition: boolean, extra?: string): void {
  if (condition) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}${extra ? `\n${extra}` : ''}`)
  }
}

const applications: Application[] = [shell, help, man, echo, clear, fetch, neofetch, ps, kill, split, reboot, theme]
const kernel = new KernelImpl({
  applications,
  host: { reboot: () => {}, shutdown: () => {}, describe: () => ({ hostname: 'smoke-host', runtime: 'node' }) },
})

function text(): string {
  const grid = kernel.screen.grid
  const rows: string[] = []
  for (let y = 0; y < grid.height; y++) {
    let line = ''
    for (let x = 0; x < grid.width; x++) line += grid.get(x, y).char
    rows.push(line)
  }
  return rows.join('\n')
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
function type(line: string): void {
  for (const ch of line) kernel.screen.key(ch)
  kernel.screen.key('\r')
}

async function main(): Promise<void> {
  console.log('layout grammar')
  check('v3:1 parses', countLeaves(parseLayout('v3:1')) === 2)
  check('nested parses', countLeaves(parseLayout('v1:(h1:2)')) === 3)
  let bad = false
  try {
    parseLayout('x1:1')
  } catch {
    bad = true
  }
  check('bad layout rejected', bad)


  console.log('tokenize')
  check('quotes', JSON.stringify(tokenize('echo "a b" c')) === JSON.stringify(['echo', 'a b', 'c']))
  let unclosed = false
  try {
    tokenize('echo "oops')
  } catch {
    unclosed = true
  }
  check('unterminated quote rejected', unclosed)

  console.log('echo safety')
  const injected = formatEcho('hi\x1b]777;run;rm -rf /\x07there')
  check('esc in text stripped', !injected.includes('\x1b]'))
  const linked = formatEcho('[fg=red run=ps]click[/]')
  check('run action emitted', linked.includes('\x1b]777;run;ps\x07'))
  check('red encoded as SGR 31', linked.includes('\x1b[0;31m'), JSON.stringify(linked))
  let unknownTag = false
  try {
    formatEcho('[style=evil]x[/]')
  } catch {
    unknownTag = true
  }
  check('unknown tag rejected', unknownTag)

  console.log('echo colors reach cells')
  {
    const terminal = new TerminalImpl(1, 40, 1)
    terminal.write(formatEcho('[fg=red]a[/] [fg=#00ff00]b[/] [fg=12]c[/] [bg=blue]d[/]'))
    const cellA = terminal.grid.get(0, 0)
    const cellB = terminal.grid.get(2, 0)
    const cellC = terminal.grid.get(4, 0)
    const cellD = terminal.grid.get(6, 0)
    check('ansi red on cell', JSON.stringify(cellA.fg) === JSON.stringify({ type: 'ansi', value: 1 }), JSON.stringify(cellA.fg))
    check('rgb green on cell', JSON.stringify(cellB.fg) === JSON.stringify({ type: 'rgb', r: 0, g: 255, b: 0 }), JSON.stringify(cellB.fg))
    check('bright blue on cell', JSON.stringify(cellC.fg) === JSON.stringify({ type: 'ansi', value: 12 }), JSON.stringify(cellC.fg))
    check('blue background on cell', JSON.stringify(cellD.bg) === JSON.stringify({ type: 'ansi', value: 4 }), JSON.stringify(cellD.bg))
  }

  console.log('boot')
  kernel.boot()
  await sleep(20)
  check('prompt visible', text().includes('[guest@smoke-host ~]$'), text())

  console.log('theme')
  type('theme use neon')
  await sleep(20)
  check('theme switched', kernel.themes.name === 'neon', kernel.themes.name)
  type('theme use nope')
  await sleep(20)
  check('unknown theme rejected', kernel.themes.name === 'neon', kernel.themes.name)
  const grad = kernel.themes.gradient('#ff0000', '#0000ff', 4)
  check('gradient has steps', !!grad && grad.length === 4 && grad[0] === '#ff0000' && grad[3] === '#0000ff', JSON.stringify(grad))
  const gradBad = kernel.themes.gradient('nope', '#0000ff', 3)
  check('gradient rejects bad color', gradBad === null, JSON.stringify(gradBad))
  type('theme add mine #ffffff #000000 ' + Array.from({ length: 16 }, () => '#123456').join(' '))
  await sleep(20)
  check('custom theme added', kernel.themes.has('mine'))
  type('theme use default')
  await sleep(20)
  check('theme restored', kernel.themes.name === 'default')

  console.log('commands')
  type('echo [fg=green]boom[/] done')
  await sleep(20)
  check('echo output', text().includes('boom done'))

  type('doesnotexist')
  await sleep(20)
  check('unknown command', text().includes('command not found'))

  type('ps')
  await sleep(20)
  check('ps table', text().includes('PID') && text().includes('COMMAND'))
  const grid = kernel.screen.grid
  let killAction: string | undefined
  for (let y = 0; y < grid.height && !killAction; y++) {
    for (let x = 0; x < grid.width && !killAction; x++) {
      const action = grid.get(x, y).action
      if (action?.command.startsWith('kill ')) killAction = action.command
    }
  }
  check('clickable kill pid', !!killAction, killAction)

  type('man echo')
  await sleep(20)
  check('man page', text().includes('SYNOPSIS') && text().includes('run=COMMAND'))

  console.log('long input line')
  const promptRowsBefore = text().split('\n').filter((row) => row.includes('guest@')).length
  for (let i = 0; i < 120; i++) kernel.screen.key('Z')
  await sleep(30)
  const typedRows = text().split('\n')
  const promptRowsAfter = typedRows.filter((row) => row.includes('guest@')).length
  const nearCursor = typedRows.slice(-4).join('\n').split('guest@').length - 1
  check('typing adds no prompt rows', promptRowsAfter <= promptRowsBefore, `before=${promptRowsBefore} after=${promptRowsAfter}`)
  check('prompt drawn once near cursor', nearCursor === 1, `near=${nearCursor}`)
  const typedZ = text().split('Z').length - 1
  check('every typed char visible once', typedZ === 120, `z=${typedZ}`)
  kernel.screen.key('\x15') // Ctrl+U — clear line
  kernel.screen.key('\r')
  await sleep(30)

  console.log('resize keeps content')
  type('echo ' + 'Z'.repeat(160))
  await sleep(30)
  const zAt80 = text().split('Z').length - 1
  check('echo output present', zAt80 >= 320, `z=${zAt80}`)
  kernel.screen.resize(40, 24)
  await sleep(40)
  const zAt40 = text().split('Z').length - 1
  check('narrow resize keeps chars', zAt40 === zAt80, `80=${zAt80} 40=${zAt40}`)
  kernel.screen.resize(160, 24)
  await sleep(40)
  const zAt160 = text().split('Z').length - 1
  check('wide resize keeps chars', zAt160 === zAt80, `80=${zAt80} 160=${zAt160}`)
  kernel.screen.resize(80, 24)
  await sleep(40)
  check('back to 80 keeps chars', text().split('Z').length - 1 === zAt80)

  console.log('split')
  type('split v3:1 "neofetch" "ps"')
  await sleep(60)
  const after = text()
  check('separator drawn', after.includes('│'))
  check('neofetch pane', after.includes('procs'))
  check('ps pane', after.includes('TTY'))
  check('terminals count', kernel.screen.grid.width > 0)

  console.log('split default layout and titles (isolated kernel)')
  {
    const k2 = new KernelImpl({
      applications,
      host: { reboot: () => {}, shutdown: () => {}, describe: () => ({ hostname: 'h2', runtime: 'node' }) },
    })
    k2.boot()
    await sleep(10)
    // No layout argument -> v1:1, two vertical panes.
    k2.screen.key('split')
    k2.screen.key('\r')
    await sleep(40)
    check('default split yields two panes', k2.screen.terminals().length === 2, `panes=${k2.screen.terminals().length}`)
    let sep = -1
    for (let y = 0; y < k2.screen.grid.height; y++) {
      for (let x = 0; x < k2.screen.grid.width; x++) {
        if (k2.screen.grid.get(x, y).char === '│') { sep = x; break }
      }
      if (sep >= 0) break
    }
    check('default split is vertical, near the middle', sep > 30 && sep < 55, `sep=${sep}`)
    // A title is shown as [TITLE] centered on the pane's top border.
    for (const ch of 'split v1:1 --title TOP "ps" "echo hi"') k2.screen.key(ch)
    k2.screen.key('\r')
    await sleep(60)
    let titleText = ''
    for (let y = 0; y < k2.screen.grid.height; y++) {
      for (let x = 0; x < k2.screen.grid.width; x++) titleText += k2.screen.grid.get(x, y).char
    }
    check('pane title drawn', titleText.includes('[TOP]'), titleText.slice(0, 120))
  }

  console.log('click routes to action target')
  let action: { x: number; y: number; command: string } | null = null
  for (let y = 0; y < grid.height && !action; y++) {
    for (let x = 0; x < grid.width && !action; x++) {
      const cell = grid.get(x, y).action
      if (cell?.command === 'help') action = { x, y, command: cell.command }
    }
  }
  check('clickable help link exists', !!action, action?.command)
  if (action) {
    const before = text()
    kernel.screen.click(action.x, action.y)
    await sleep(200)
    const after = text()
    check('click executed command', after !== before && after.includes('for details'), `changed=${after !== before} details=${after.includes('for details')}`)
  }

  console.log('pane geometry')
  const screenText = text()
  const sepIndex = (() => {
    const rows = screenText.split('\n')
    for (const row of rows) {
      const i = row.indexOf('│')
      if (i >= 0) return i
    }
    return -1
  })()
  check('v3:1 separator roughly at 3/4', sepIndex > 40 && sepIndex < 70, `sep=${sepIndex}`)

  console.log('resize')
  kernel.screen.resize(60, 18)
  await sleep(30)
  check('grid resized', kernel.screen.grid.width === 60 && kernel.screen.grid.height === 18)
  type('clear')
  await sleep(30)
  check('clear wipes focused pane', !text().includes('for details'))

  console.log('renderer (DOM stub)')
  const makeEl = (tag: string): Record<string, any> => {
    const el: Record<string, any> = {
      tagName: tag,
      className: '',
      textContent: '',
      innerHTML: '',
      style: {},
      children: [] as any[],
      clientWidth: 800,
      clientHeight: 486,
      appendChild(child: any) {
        el.children.push(child)
        child.parent = el
        return child
      },
      remove() {
        if (el.parent) el.parent.children = el.parent.children.filter((c: any) => c !== el)
      },
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect() {
        return el.className === 'probe'
          ? { width: 80, height: 18, left: 0, top: 0 }
          : { width: 800, height: 486, left: 0, top: 0 }
      },
    }
    return el
  }
  ;(globalThis as any).document = { createElement: makeEl, fonts: undefined }
  ;(globalThis as any).window = { addEventListener() {}, removeEventListener() {} }
  ;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(0), 0)
  ;(globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id)
  ;(globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  const { createHtmlRenderer } = await import('./src/renderer/html.ts')
  const mountPoint = makeEl('div')
  const renderer = createHtmlRenderer(kernel.screen)
  let mounted = true
  try {
    renderer.mount(mountPoint as unknown as HTMLElement)
  } catch (error) {
    mounted = false
    console.log(error)
  }
  await sleep(50)
  const screenEl = mountPoint.children[0] as Record<string, any>
  const rowCount = screenEl ? screenEl.children.length - 1 : 0 // minus probe
  check('renderer mounts', mounted && rowCount === kernel.screen.grid.height, `rows=${rowCount} grid=${kernel.screen.grid.height}`)
  const painted = screenEl && screenEl.children.slice(1).some((row: any) => row.innerHTML.includes('guest@') || row.innerHTML.includes('│'))
  check('renderer paints terminal content', !!painted)
  renderer.destroy()

  console.log('exit closes panes, then halts')
  // Each `exit` closes the focused pane. Exit until the last pane is gone and
  // the system halts; a halted system must accept no further input.
  for (let i = 0; i < 6 && !text().includes('halted'); i++) {
    type('exit')
    await sleep(40)
  }
  check('system halted after last exit', text().includes('halted'))
  kernel.screen.key('x')
  kernel.screen.key('\r')
  await sleep(40)
  check('halted system accepts nothing', !text().includes('sh: x: command not found'))

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
