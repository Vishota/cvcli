import type { Application } from '../app.ts'
import type { Cell } from '../sys/grid.ts'
import { CLEAR_SCREEN, encodeAction, encodeOpen, encodeStyle, hideCursor, moveCursor, showCursor } from '../sys/protocol.ts'
import { readEvents } from './shell.ts'

// Physics: grains are released with a small random delay, then accelerate
// downwards and leave through the bottom edge. Units are cells and ticks.
const TICK = 33
const G = 0.35 // cells per tick^2
const MAX_RELEASE = 8 // ticks of crumble stagger

type Grain = { x: number; y: number; ox: number; oy: number; vy: number; release: number; cell: Cell }

const isResize = (seq: string): boolean => /^\x1b\[8;\d+;\d+t$/.test(seq)
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** A cell worth painting: a glyph, a background block or a clickable zone. */
const solid = (cell: Cell): boolean => cell.char !== ' ' || !!cell.bg || !!cell.action

/** Full-fidelity cell repaint, actions included. */
function paint(cell: Cell): string {
  let out = encodeStyle(cell)
  if (cell.action?.open) out += encodeOpen(cell.action.open)
  else if (cell.action?.command) out += encodeAction(cell.action.command, cell.action.copy)
  return out + cell.char
}

export const gravity: Application = {
  name: 'gravity',
  aliases: ['collapse'],
  summary: 'the screen loses its grip and crumbles to the floor',
  synopsis: 'gravity',
  description: [
    'Snapshots the current screen, takes every glyph apart and lets',
    'the pieces fall under gravity, then reassembles the screen exactly',
    'as it was. Any key cancels the fall mid-air.',
  ],
  async run(context) {
    const out = (text: string): void => context.stdout.write(text)
    const { rows: H } = context.terminal.size()

    // Snapshot every solid cell, then give each one a grain of physics.
    const grid = context.terminal.grid
    const grains: Grain[] = []
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.get(x, y)
        if (!solid(cell)) continue
        grains.push({ x, y, ox: x, oy: y, vy: Math.random() * 0.3, release: Math.floor(Math.random() * MAX_RELEASE), cell })
      }
    }
    const cursor = { ...context.terminal.cursor }

    let skip = false
    context.signal.addEventListener('abort', () => {
      skip = true
    }, { once: true })
    const offInput = context.stdin.subscribe((data) => {
      for (const item of readEvents(data)) {
        if (item.kind === 'key' && isResize(item.seq)) continue
        skip = true
      }
    })

    out(hideCursor())
    let airborne = grains.length
    while (!skip && airborne > 0) {
      airborne = 0
      for (const grain of grains) {
        if (grain.release > 0) {
          grain.release--
          airborne++
          continue
        }
        grain.vy += G
        grain.y += grain.vy
        if (grain.y < H) airborne++
      }

      // Compose the frame: un-released grains stay in place, released ones fall.
      const segs: string[] = [CLEAR_SCREEN]
      for (const grain of grains) {
        if (grain.release <= 0 && grain.y >= H) continue
        segs.push(moveCursor(grain.x, Math.floor(grain.y)), encodeStyle(grain.cell), grain.cell.char)
      }
      out(segs.join(''))
      await sleep(TICK)
    }
    offInput()

    // Reassemble the screen exactly as it was (from the snapshot — the live
    // grid only holds the last animation frame), wipe the stale command line
    // from the cursor onwards and hand control back.
    const restore: string[] = [CLEAR_SCREEN]
    for (const grain of grains) restore.push(moveCursor(grain.ox, grain.oy), paint(grain.cell))
    restore.push(moveCursor(cursor.x, cursor.y), '\x1b[K', cursor.visible ? showCursor() : hideCursor())
    out(restore.join(''))
    return 0
  },
}
