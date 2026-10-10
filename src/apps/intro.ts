import type { Application } from '../app.ts'
import { CLEAR_SCREEN, RESET, encodeAction, hideCursor, moveCursor, showCursor } from '../sys/protocol.ts'
import { readEvents } from './shell.ts'

// The "8" wordmark shown on boot, exactly as designed.
const ART = [
  "    ,o888888o.  `8.`888b           ,8'",
  "   8888     `88. `8.`888b         ,8'",
  ",8 8888       `8. `8.`888b       ,8'",
  "88 8888            `8.`888b     ,8'",
  "88 8888             `8.`888b   ,8'",
  "88 8888              `8.`888b ,8'",
  "88 8888               `8.`888b8'",
  "`8 8888       .8'      `8.`888'",
  "   8888     ,88'        `8.`8'",
  "    `8888888P'           `8.`",
]
const FROM = '#ff2e6b'
const TO = '#25f4ee'

// Phase timing in ms: sweep in, wobble + glitch, burst into particles.
const T_REVEAL = 250
const T_HOLD = 300
const T_BURST = 700
const TICK = 33

type Cell = { col: number; row: number; ch: string; r: number; g: number; b: number }
type Flight = { flying: boolean; x: number; y: number; vx: number; vy: number; age: number; life: number }

const hexRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

const sgr = (r: number, g: number, b: number): string => `\x1b[38;2;${r | 0};${g | 0};${b | 0}m`
const BOLD = '\x1b[1m'
const UNBOLD = '\x1b[22m'
const GLITCH = '#$%&@+=~*'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const isResize = (seq: string): boolean => /^\x1b\[8;\d+;\d+t$/.test(seq)


export const intro: Application = {
  name: 'intro',
  summary: 'boot animation: the wordmark forms, distorts and disintegrates',
  synopsis: 'intro',
  description: [
    'The boot intro. The wordmark sweeps in, wobbles with a glitch wave,',
    'then disintegrates into particles from the top-right corner and hands',
    'the screen to the CV split. Any key or tap skips straight to the split.',
  ],
  async run(context) {
    const sys = context.sys
    const out = (text: string): void => context.stdout.write(text)

    // Art cells with a per-column brand gradient.
    const artWidth = Math.max(...ART.map((line) => line.length))
    const ramp = sys.themeGradient(FROM, TO, artWidth) ?? []
    const cells: Cell[] = []
    ART.forEach((line, row) => {
      for (let col = 0; col < line.length; col++) {
        const ch = line[col]
        if (ch === ' ') continue
        const [r, g, b] = hexRgb(ramp[Math.min(col, ramp.length - 1)] ?? '#ffffff')
        cells.push({ col, row, ch, r, g, b })
      }
    })

    let skip = false
    let aborted = false
    context.signal.addEventListener('abort', () => {
      skip = true
      aborted = true
    }, { once: true })
    const offInput = context.stdin.subscribe((data) => {
      for (const item of readEvents(data)) {
        if (item.kind === 'key' && isResize(item.seq)) continue
        skip = true
      }
    })

    // Per-cell flight state, filled in as the burst wave reaches each cell.
    const flights = new Map<Cell, Flight>()
    for (const cell of cells) {
      flights.set(cell, { flying: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 10 + Math.floor(Math.random() * 8) })
    }

    const wobble = (row: number, t: number): number => Math.round(Math.sin(t * 0.008 + row * 0.85) * 1)
    const start = Date.now()

    while (!skip && !aborted) {
      const t = Date.now() - start
      const { cols: W, rows: H } = context.terminal.size()
      const x0 = Math.max(0, Math.floor((W - artWidth) / 2))
      const y0 = Math.max(0, Math.floor((H - ART.length) / 2) - 1)
      const xR = x0 + artWidth

      // The burst wave sweeps from the top-right corner and detaches cells
      // into particles as it passes them.
      if (t > T_REVEAL + T_HOLD) {
        const wave = ((t - T_REVEAL - T_HOLD) / T_BURST) * (artWidth + ART.length * 1.4) * 1.15
        for (const cell of cells) {
          const flight = flights.get(cell)!
          if (flight.flying) continue
          const distance = xR - (x0 + cell.col) + cell.row * 1.4
          if (wave >= distance) {
            flight.flying = true
            flight.x = x0 + cell.col + wobble(cell.row, t)
            flight.y = y0 + cell.row
            flight.vx = 0.4 + Math.random() * 1.6
            flight.vy = -0.8 + Math.random() * 0.9
          }
        }
      }
      for (const flight of flights.values()) {
        if (!flight.flying) continue
        flight.x += flight.vx
        flight.y += flight.vy
        flight.vy += 0.18
        flight.age++
      }

      // Compose the frame. The action is emitted once before all segments, so
      // the whole painted area acts as one big skip button; per-segment SGR
      // (without a leading reset) keeps it attached until the final RESET.
      const segs: string[] = [CLEAR_SCREEN, hideCursor(), encodeAction('skip'), BOLD]
      const glitching = t > T_REVEAL && t <= T_REVEAL + T_HOLD && Math.random() < 0.35
      const revealSpan = (artWidth + ART.length * 2) * 1.05
      for (const cell of cells) {
        const flight = flights.get(cell)!
        const revealed = t >= T_REVEAL || cell.col + cell.row * 2 < (t / T_REVEAL) * revealSpan
        if (!revealed) continue
        if (flight.flying) {
          if (flight.age > flight.life) continue
          if (flight.x < 0 || flight.x >= W || flight.y < 0 || flight.y >= H) continue
          const ch = flight.age < 7 ? cell.ch : flight.age < 14 ? '▒' : '░'
          const fade = Math.max(0.15, 1 - flight.age / flight.life)
          segs.push(UNBOLD, moveCursor(Math.round(flight.x), Math.round(flight.y)), sgr(cell.r * fade, cell.g * fade, cell.b * fade), ch)
        } else {
          let ch = cell.ch
          if (glitching && Math.random() < 0.08) ch = GLITCH[Math.floor(Math.random() * GLITCH.length)]
          segs.push(moveCursor(x0 + cell.col + wobble(cell.row, t), y0 + cell.row), sgr(cell.r, cell.g, cell.b), ch)
        }
      }
      segs.push(BOLD, sgr(105, 105, 115), moveCursor(Math.max(0, Math.floor((W - 15) / 2)), Math.max(0, H - 1)), 'press any key', RESET)
      out(segs.join(''))

      const anyLeft = cells.some((cell) => {
        const flight = flights.get(cell)!
        return !flight.flying || flight.age <= flight.life
      })
      if (t > T_REVEAL + T_HOLD && !anyLeft) break
      await sleep(TICK)
    }

    offInput()
    out(CLEAR_SCREEN + showCursor())
    if (aborted) return 0
    // Hand the screen over: any arguments after `intro` are the command to
    // run (usually the CV split); bare `intro` defaults to that split.
    if (context.args.length > 0) await sys.exec(context.args[0], context.args.slice(1))
    else sys.split('h2:1', ['cvui'], ['VISHOTA CV'])
    return 0
  },
}

