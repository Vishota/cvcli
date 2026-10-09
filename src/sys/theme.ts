/**
 * A visual theme: the 16 ANSI colors as CSS hex, plus the default foreground
 * and background. Every `ansi` color an application prints is resolved through
 * the active theme by the renderer, so switching a theme recolors the whole
 * system without any application knowing a theme exists.
 */
export type ThemeSpec = {
  name: string
  fg: string
  bg: string
  /** 16 entries, index = ANSI color 0..15. */
  colors: string[]
}

const NAMED: Record<string, number> = {
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  magenta: 5,
  cyan: 6,
  white: 7,
  gray: 8,
  grey: 8,
  brightred: 9,
  brightgreen: 10,
  brightyellow: 11,
  brightblue: 12,
  brightmagenta: 13,
  brightcyan: 14,
  brightwhite: 15,
}

const BUILTIN: ThemeSpec[] = [
  {
    name: 'default',
    fg: '#d6d6db',
    bg: '#0b0b0d',
    colors: [
      '#1c1c1e', '#d75f5f', '#87c96b', '#d8b456', '#5f87d7', '#c17ac9', '#5fb7b7', '#c8c8cc',
      '#6b6b70', '#ff8585', '#a8e38a', '#f0d181', '#82aef0', '#d9a1dd', '#8ad9d9', '#f2f2f5',
    ],
  },
  {
    name: 'neon',
    fg: '#e6faff',
    bg: '#05060a',
    colors: [
      '#0a0a12', '#ff2e6b', '#39ff88', '#ffe14d', '#3aa0ff', '#c77dff', '#25f4ee', '#e8f6ff',
      '#4a4a5a', '#ff6b9a', '#7dffb0', '#fff08a', '#7fc4ff', '#e0b3ff', '#8ffaf6', '#ffffff',
    ],
  },
  {
    name: 'matrix',
    fg: '#33ff66',
    bg: '#000000',
    colors: [
      '#001100', '#00cc33', '#33ff66', '#aaffaa', '#008822', '#00ff44', '#22dd55', '#ccffcc',
      '#004411', '#00ee44', '#66ff88', '#bbffbb', '#009922', '#00ff55', '#33ee66', '#ddffdd',
    ],
  },
  {
    name: 'dracula',
    fg: '#f8f8f2',
    bg: '#282a36',
    colors: [
      '#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
      '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff',
    ],
  },
  {
    name: 'nord',
    fg: '#d8dee9',
    bg: '#2e3440',
    colors: [
      '#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
      '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4',
    ],
  },
  {
    name: 'mono',
    fg: '#d0d0d0',
    bg: '#0b0b0b',
    colors: [
      '#0b0b0b', '#8a8a8a', '#c0c0c0', '#e0e0e0', '#9a9a9a', '#b0b0b0', '#a8a8a8', '#f2f2f2',
      '#5a5a5a', '#a0a0a0', '#d0d0d0', '#ffffff', '#888888', '#b8b8b8', '#c8c8c8', '#ffffff',
    ],
  },
]

/**
 * Holds every known theme and the active one. A shared data object: the
 * renderer reads it, applications change it through the kernel. Nothing here
 * knows about DOM, processes or the screen.
 */
export class ThemeStore {
  private readonly themes = new Map<string, ThemeSpec>()
  private active = 'default'
  private readonly listeners = new Set<() => void>()

  constructor(extra: ThemeSpec[] = []) {
    for (const theme of BUILTIN) this.themes.set(theme.name, theme)
    for (const theme of extra) this.themes.set(theme.name, theme)
  }

  get current(): ThemeSpec {
    return this.themes.get(this.active) ?? BUILTIN[0]
  }

  get name(): string {
    return this.active
  }

  list(): string[] {
    return [...this.themes.keys()]
  }

  has(name: string): boolean {
    return this.themes.has(name)
  }

  use(name: string): boolean {
    if (!this.themes.has(name)) return false
    this.active = name
    this.emit()
    return true
  }

  /** Resolve tokens against the active palette, then register. */
  add(name: string, fg: string, bg: string, tokens: string[]): boolean {
    const trimmedName = name.trim().toLowerCase()
    if (!trimmedName || /[^a-z0-9_-]/.test(trimmedName)) return false
    if (this.themes.has(trimmedName)) return false
    if (tokens.length !== 16) return false
    const resolvedFg = this.resolve(fg)
    const resolvedBg = this.resolve(bg)
    const colors = tokens.map((token) => this.resolve(token))
    if (!resolvedFg || !resolvedBg || colors.some((c) => c === null)) return false
    this.themes.set(trimmedName, { name: trimmedName, fg: resolvedFg, bg: resolvedBg, colors: colors as string[] })
    this.emit()
    return true
  }

  /** `#rrggbb`, an ANSI index 0-15, or a color name -> hex of the active theme. */
  resolve(token: string): string | null {
    const value = token.trim().toLowerCase()
    if (/^#[0-9a-f]{6}$/.test(value)) return value
    if (value in NAMED) return this.current.colors[NAMED[value]]
    if (/^\d{1,2}$/.test(value)) {
      const index = Number(value)
      if (index >= 0 && index < 16) return this.current.colors[index]
    }
    return null
  }

  /** Linear ramp of `steps` hex colors from `from` to `to` for gradient text. */
  gradient(from: string, to: string, steps: number): string[] | null {
    const a = hexToRgb(from)
    const b = hexToRgb(to)
    if (!a || !b) return null
    const count = Math.max(1, steps)
    const out: string[] = []
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1)
      const r = Math.round(a.r + (b.r - a.r) * t)
      const g = Math.round(a.g + (b.g - a.g) * t)
      const bl = Math.round(a.bl + (b.bl - a.bl) * t)
      out.push('#' + [r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join(''))
    }
    return out
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

function hexToRgb(hex: string): { r: number; g: number; bl: number } | null {
  if (!/^#[0-9a-f]{6}$/.test(hex)) return null
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    bl: parseInt(hex.slice(5, 7), 16),
  }
}
