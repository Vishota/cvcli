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
  /** Run another application in this terminal and wait for it, like a child. */
  exec(name: string, args: string[]): Promise<number>
  processes(): ProcessInfo[]
  kill(pid: number): boolean
  /**
   * Replace this terminal with a split layout. Leaves run a shell, optionally
   * preloaded with a command. Returns leaf terminals in layout order.
   */
  split(layout: string, commands?: string[]): Terminal[]
  applications(): ApplicationInfo[]
  info(): SystemInfo
  reboot(): void
  shutdown(): void
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
