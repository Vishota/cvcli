import { ArrayCharGrid, type ReadonlyCharGrid } from './grid.ts'
import { countLeaves, parseLayout, type LayoutNode } from './layout.ts'
import type { Terminal, TerminalCursor } from './terminal.ts'

/**
 * The only thing the renderer is allowed to know: a screen grid plus input
 * plumbing. No terminal, no process, no kernel behind it.
 */
export interface Screen {
  readonly grid: ReadonlyCharGrid
  readonly cursor: TerminalCursor | null
  resize(cols: number, rows: number): void
  key(data: string): void
  click(x: number, y: number): void
  subscribe(listener: () => void): () => void
  /** Drop a pane; collapses the tree, returns the new focus or null if empty. */
  closePane(terminal: Terminal): Terminal | null
}

export type Rect = { x: number; y: number; w: number; h: number }

type Node =
  | { kind: 'leaf'; terminal: Terminal; title: string; off: () => void }
  | { kind: 'group'; dir: 'v' | 'h'; children: Child[] }
type Child = { weight: number; node: Node }
type Parent = { children: Child[] }

const BORDER_FG = { type: 'ansi', value: 8 } as const

/**
 * The outer frame is double weight. A wall that reaches it blends: the frame
 * keeps its own line along the edge, the stub crossing in is single.
 */
function frameGlyph(
  x: number,
  y: number,
  width: number,
  height: number,
  up: boolean,
  down: boolean,
  left: boolean,
  right: boolean,
): string {
  const top = y === 0
  const bottom = y === height - 1
  const atLeft = x === 0
  const atRight = x === width - 1
  if (top && atLeft) return '╔'
  if (top && atRight) return '╗'
  if (bottom && atLeft) return '╚'
  if (bottom && atRight) return '╝'
  if (top && down) return '╤'
  if (bottom && up) return '╧'
  if (atLeft && right) return '╟'
  if (atRight && left) return '╢'
  return top || bottom ? '═' : '║'
}

function innerGlyph(up: boolean, down: boolean, left: boolean, right: boolean): string {
  // The side flags spell out the glyph: a corner where a line ends, a tee
  // where one line passes through and the other ends, a crossing where both do.
  const key = `${up ? 'u' : ''}${down ? 'd' : ''}${left ? 'l' : ''}${right ? 'r' : ''}`
  switch (key) {
    case 'udlr':
      return '┼'
    case 'udl':
      return '┤'
    case 'udr':
      return '├'
    case 'ulr':
      return '┴'
    case 'dlr':
      return '┬'
    case 'ul':
      return '┘'
    case 'ur':
      return '└'
    case 'dl':
      return '┐'
    case 'dr':
      return '┌'
    case 'ud':
      return '│'
    case 'lr':
      return '─'
    default:
      // A lone stub: keep the line it belongs to.
      return up || down ? '│' : '─'
  }
}

/** Owns pane layout: split, focus, composition of terminals into one screen. */
export class Display implements Screen {
  readonly grid = new ArrayCharGrid(80, 24)
  cursor: TerminalCursor | null = null

  private root: Node
  private focus: Terminal
  private readonly rects = new Map<Terminal, Rect>()
  private readonly listeners = new Set<() => void>()
  private scheduled = false
  private halted = false
  private haltMessage = ''

  private readonly createTerminal: (cols: number, rows: number) => Terminal

  constructor(createTerminal: (cols: number, rows: number) => Terminal) {
    this.createTerminal = createTerminal
    const terminal = this.createTerminal(80, 24)
    this.root = this.leaf(terminal)
    this.focus = terminal
  }

  private leaf(terminal: Terminal, title = ''): Node {
    return { kind: 'leaf', terminal, title, off: terminal.onChange(() => this.schedule()) }
  }

  rootTerminal(): Terminal {
    return leafOf(this.root)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  resize(cols: number, rows: number): void {
    this.grid.resize(cols, rows)
    this.schedule()
  }

  key(data: string): void {
    if (this.halted) return
    this.focus.stdin.write(data)
  }

  click(x: number, y: number): void {
    if (this.halted) return
    const target = this.hit(x, y)
    if (!target) return
    const cell = this.grid.get(x, y)
    // A click runs the same command a user would type, in the pane that was
    // clicked — the pane owns the link, so it owns the command too.
    if (cell.action) target.stdin.write(`\r${cell.action.command}\r`)
    this.focus = target
    this.schedule()
  }

  halt(message: string): void {
    this.halted = true
    this.haltMessage = message
    this.schedule()
  }

  terminals(): Terminal[] {
    const list: Terminal[] = []
    walk(this.root, (node) => list.push(node.terminal))
    return list
  }

  /**
   * Drop a leaf from the tree. A lone child inherits its parent's slot, so a
   * one-pane group collapses back to that pane. Returns the new focus terminal,
   * or null when nothing is left on screen.
   */
  closePane(target: Terminal): Terminal | null {
    const found = findLeaf(this.root, target)
    if (!found || !found.parent) return null
    const parent = found.parent
    parent.children.splice(found.index, 1)
    if (found.node.kind === 'leaf') found.node.off()

    if (parent.children.length === 1) {
      // Collapse the group: its lone survivor takes the group's own slot.
      const survivor = parent.children[0].node
      const spot = findGroupSlot(this.root, parent)
      if (spot && spot.parent) spot.parent.children[spot.index].node = survivor
      else this.root = survivor
    }

    const list = this.terminals()
    if (list.length === 0) return null
    if (!list.includes(this.focus)) this.focus = list[0]
    this.schedule()
    return this.focus
  }

  /** Replace `target` with a weighted split of fresh terminals. */
  split(target: Terminal, spec: string, commands: string[], titles: string[] = []): Terminal[] {
    const layout = parseLayout(spec)
    const leaves = countLeaves(layout)
    if (commands.length > leaves) {
      throw new Error(`split: layout "${spec}" fits ${leaves} pane(s), got ${commands.length} command(s)`)
    }

    const found = findLeaf(this.root, target)
    if (!found) throw new Error('split: terminal is not on screen')

    const created: Terminal[] = []
    const width = this.grid.width
    const height = this.grid.height
    let titleIndex = 0
    const build = (node: LayoutNode): Node => {
      if (node.kind === 'leaf') {
        const terminal = this.createTerminal(width, height)
        created.push(terminal)
        return this.leaf(terminal, titles[titleIndex++] ?? '')
      }
      return {
        kind: 'group',
        dir: node.dir,
        children: node.children.map((child) => ({ weight: child.weight, node: build(child.node) })),
      }
    }
    const replacement = build(layout)

    const replaced = found.parent === null ? this.root : found.parent.children[found.index].node
    if (replaced.kind === 'leaf') replaced.off()
    if (found.parent === null) this.root = replacement
    else found.parent.children[found.index] = { weight: found.parent.children[found.index].weight, node: replacement }

    const replacementLeaves: Terminal[] = []
    walk(replacement, (node) => replacementLeaves.push(node.terminal))
    const defaultTarget = replacementLeaves[replacementLeaves.length - 1]
    if (this.focus === target) this.focus = defaultTarget
    this.schedule()
    return created
  }
  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      this.compose()
    })
  }

  private compose(): void {
    const { width, height } = this.grid
    this.grid.clear()
    this.rects.clear()
    this.cursor = null

    if (this.halted) {
      const line = this.haltMessage
      const x = Math.max(0, Math.floor((width - line.length) / 2))
      const y = Math.max(0, Math.floor(height / 2) - 1)
      for (let i = 0; i < line.length && x + i < width; i++) {
        this.grid.set(x + i, y, { char: line[i], fg: { type: 'ansi', value: 8 }, bold: true })
      }
      this.emit()
      return
    }

    // Everything lives inside the outer frame, so panes never touch the edge.
    const inner = { x: 1, y: 1, w: Math.max(1, width - 2), h: Math.max(1, height - 2) }
    const walls: boolean[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => false))
    const mark = (x: number, y: number): void => {
      if (y >= 0 && y < height && x >= 0 && x < width) walls[y][x] = true
    }
    for (let x = 0; x < width; x++) {
      mark(x, 0)
      mark(x, height - 1)
    }
    for (let y = 0; y < height; y++) {
      mark(0, y)
      mark(width - 1, y)
    }

    this.layoutNode(this.root, inner, mark)

    // Paint walls last: pane content is already in place, walls only overwrite.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!walls[y][x]) continue
        const onFrame = y === 0 || y === height - 1 || x === 0 || x === width - 1
        const up = y > 0 && walls[y - 1][x]
        const down = y < height - 1 && walls[y + 1][x]
        const left = x > 0 && walls[y][x - 1]
        const right = x < width - 1 && walls[y][x + 1]
        const char = onFrame ? frameGlyph(x, y, width, height, up, down, left, right) : innerGlyph(up, down, left, right)
        this.grid.set(x, y, { char, fg: BORDER_FG })
      }
    }

    const rect = this.rects.get(this.focus)
    const cursor = this.focus.cursor
    if (rect && cursor.visible && cursor.y < this.focus.grid.height) {
      this.cursor = { x: rect.x + Math.min(cursor.x, Math.max(0, rect.w - 1)), y: rect.y + cursor.y, visible: true }
    }
    this.drawTitles()
    this.emit()
  }

  /** Writes `[TITLE]` centered on the top border of every titled pane. */
  private drawTitles(): void {
    const titles = new Map<Terminal, string>()
    walk(this.root, (node) => {
      if (node.title) titles.set(node.terminal, node.title)
    })
    for (const [terminal, title] of titles) {
      const rect = this.rects.get(terminal)
      if (!rect || rect.w < 5) continue
      const label = `[${title}]`
      const shown = label.slice(0, rect.w - 2)
      if (shown.length === 0) continue
      // The top border is the frame for a top-row pane, else the wall above it.
      const top = rect.y <= 1 ? 0 : rect.y - 1
      const start = rect.x + Math.max(0, Math.floor((rect.w - shown.length) / 2))
      for (let i = 0; i < shown.length; i++) {
        this.grid.set(start + i, top, { char: shown[i], fg: BORDER_FG, bold: true })
      }
    }
  }

  private layoutNode(node: Node, rect: Rect, mark: (x: number, y: number) => void): void {
    if (node.kind === 'leaf') {
      const size = node.terminal.size()
      if (rect.w > 0 && rect.h > 0 && (size.cols !== rect.w || size.rows !== rect.h)) {
        node.terminal.resize(rect.w, rect.h)
      }
      this.rects.set(node.terminal, rect)
      blit(this.grid, node.terminal, rect)
      return
    }

    const total = node.children.reduce((sum, child) => sum + child.weight, 0) || 1
    const horizontal = node.dir === 'v'
    const size = horizontal ? rect.w : rect.h
    const room = Math.max(0, size - (node.children.length - 1))
    let used = 0
    let offset = 0
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]
      const span =
        i === node.children.length - 1 ? Math.max(1, room - used) : Math.max(1, Math.floor((room * child.weight) / total))
      used += span
      const remaining = Math.max(0, size - offset)
      const clipped = Math.max(1, Math.min(span, remaining))
      const childRect: Rect = horizontal
        ? { x: rect.x + offset, y: rect.y, w: clipped, h: rect.h }
        : { x: rect.x, y: rect.y + offset, w: rect.w, h: clipped }
      this.layoutNode(child.node, childRect, mark)
      offset += clipped
      if (i < node.children.length - 1) {
        // The wall itself: glyphs are decided later, once every wall is known.
        for (let k = 0; k < (horizontal ? rect.h : rect.w); k++) {
          if (horizontal) mark(rect.x + offset, rect.y + k)
          else mark(rect.x + k, rect.y + offset)
        }
        offset += 1
      }
    }
  }

  private hit(x: number, y: number): Terminal | null {
    for (const [terminal, rect] of this.rects) {
      if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) return terminal
    }
    return null
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

function walk(node: Node, visit: (leaf: Node & { kind: 'leaf' }) => void): void {
  if (node.kind === 'leaf') {
    visit(node)
    return
  }
  for (const child of node.children) walk(child.node, visit)
}

function leafOf(node: Node): Terminal {
  if (node.kind === 'leaf') return node.terminal
  return leafOf(node.children[0].node)
}

type LeafSlot = { parent: Parent | null; index: number; node: Node & { kind: 'leaf' } }

function findLeaf(node: Node, target: Terminal, parent: Parent | null = null, index = 0): LeafSlot | null {
  if (node.kind === 'leaf') return node.terminal === target ? { parent, index, node } : null
  for (let i = 0; i < node.children.length; i++) {
    const found = findLeaf(node.children[i].node, target, node, i)
    if (found) return found
  }
  return null
}

type GroupSlot = { parent: Parent | null; index: number }

/** Locate a group node inside its parent, to splice it out during a collapse. */
function findGroupSlot(root: Node, group: Parent, parent: Parent | null = null, index = 0): GroupSlot | null {
  if (root === group) return { parent, index }
  if (root.kind === 'group') {
    for (let i = 0; i < root.children.length; i++) {
      const found = findGroupSlot(root.children[i].node, group, root, i)
      if (found) return found
    }
  }
  return null
}

function blit(grid: ArrayCharGrid, terminal: Terminal, rect: Rect): void {
  const source = terminal.grid
  for (let y = 0; y < Math.min(rect.h, source.height); y++) {
    for (let x = 0; x < Math.min(rect.w, source.width); x++) {
      grid.set(rect.x + x, rect.y + y, source.get(x, y))
    }
  }
}

