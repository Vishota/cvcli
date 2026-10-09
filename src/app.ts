import type { InputStream, OutputStream } from './sys/stream.ts'
import type { Terminal, TerminalSize } from './sys/terminal.ts'

export type ProcessInfo = {
  pid: number
  ppid: number
  name: string
  args: string[]
  tty: number
  startedAt: number
}

export type SystemInfo = {
  name: string
  version: string
  uptimeMs: number
  processes: number
  terminals: number
  screen: TerminalSize
  host: Record<string, string>
}

export type ApplicationInfo = {
  name: string
  aliases: readonly string[]
  summary: string
  synopsis: string
  description: readonly string[]
}

/** The only way an application reaches the kernel. No renderer in sight. */
export interface Syscalls {
  /** This process's own pid (so a pane can tell if it is the only one left). */
  self(): number
  /** Run another application in this terminal and wait for it, like a child. */
  exec(name: string, args: string[]): Promise<number>
  processes(): ProcessInfo[]
  kill(pid: number): boolean
  /**
   * Replace this terminal with a split layout. Leaves run a shell, optionally
   * preloaded with a command, and may carry a title. Returns leaf terminals in
   * layout order.
   */
  split(layout: string, commands?: string[], titles?: string[]): Terminal[]
  applications(): ApplicationInfo[]
  info(): SystemInfo
  reboot(): void
  shutdown(): void
  /** Active theme name. */
  themeCurrent(): string
  /** Every known theme name. */
  themeList(): string[]
  /** Switch the active theme. False if the name is unknown. */
  themeUse(name: string): boolean
  /** Register a custom theme. False if a color token is invalid. */
  themeAdd(name: string, fg: string, bg: string, colors: string[]): boolean
  /** Linear color ramp of `steps` hexes for gradient text. */
  themeGradient(from: string, to: string, steps: number): string[] | null
  /**
   * Split this terminal and run applications, one per leaf. No shell is spawned:
   * a pane only closes when its application exits.
   */
  open(layout: string, commands?: string[], titles?: string[]): Terminal[]
}

export interface ApplicationContext {
  readonly args: string[]
  readonly terminal: Terminal
  readonly stdin: InputStream
  readonly stdout: OutputStream
  readonly sys: Syscalls
  /** Fires when the process is killed. */
  readonly signal: AbortSignal
}

export interface Application {
  readonly name: string
  readonly aliases?: readonly string[]
  readonly summary: string
  readonly synopsis: string
  readonly description?: readonly string[]
  /** Omitting stdout in the context means discard the output. */
  run(context: ApplicationContext): Promise<number>
}
