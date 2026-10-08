import type { Application, ApplicationContext, ApplicationInfo, ProcessInfo, SystemInfo, Syscalls } from '../app.ts'
import { Display, type Screen } from './display.ts'
import { countLeaves, parseLayout } from './layout.ts'
import { styled } from './protocol.ts'
import { createPipe, type OutputStream, type Pipe } from './stream.ts'
import { TerminalImpl, type Terminal } from './terminal.ts'

export interface KernelHost {
  reboot(): void
  shutdown(): void
  describe(): Record<string, string>
}

export interface KernelOptions {
  applications: readonly Application[]
  host: KernelHost
}

export interface Kernel {
  /** Hand this to the renderer. Nothing above this line is visible inside. */
  readonly screen: Screen
  boot(init?: string): void
}

type Proc = {
  pid: number
  ppid: number
  app: Application
  args: string[]
  terminal: Terminal
  ctrl: AbortController
  stdin: Pipe
  alive: boolean
  startedAt: number
}

const OS_NAME = 'VISHOTA OS'
const OS_VERSION = '0.1.0'
const ERR_FG = { type: 'ansi', value: 1 } as const

export class KernelImpl implements Kernel {
  readonly screen: Screen

  private readonly display: Display
  private readonly apps = new Map<string, Application>()
  private readonly allApps: Application[]
  private readonly procs = new Map<number, Proc>()
  private readonly stacks = new Map<Terminal, Proc[]>()
  private readonly host: KernelHost
  private readonly startedAt = Date.now()
  private nextPid = 1
  private nextTty = 1
  private halted = false

  constructor(options: KernelOptions) {
    this.host = options.host
    this.allApps = [...options.applications]
    for (const app of this.allApps) {
      this.apps.set(app.name, app)
      for (const alias of app.aliases ?? []) this.apps.set(alias, app)
    }
    this.display = new Display((cols, rows) => this.newTerminal(cols, rows))
    this.screen = this.display
  }

  boot(init?: string): void {
    const root = this.display.rootTerminal()
    const shell = this.resolve('shell')
    if (!shell) throw new Error('kernel: no "shell" application registered')
    this.spawn(shell, [], root, 0)
    if (init) queueMicrotask(() => root.stdin.write(init + '\r'))
  }
  private syscalls(proc: Proc): Syscalls {
    return {
      exec: (name, args = []) => {
        const app = this.resolve(name)
        if (!app) return Promise.resolve(127)
        if (!proc.alive) return Promise.resolve(130)
        return this.spawn(app, args, proc.terminal, proc.pid)
      },
      processes: () => this.processList(),
      kill: (pid) => {
        const target = this.procs.get(pid)
        if (!target) return false
        this.terminate(target)
        return true
      },
      split: (layout, commands = []) => {
        const layoutTree = parseLayout(layout)
        const leaves = countLeaves(layoutTree)
        if (commands.length > leaves) {
          throw new Error(`layout "${layout}" fits ${leaves} pane(s), got ${commands.length} command(s)`)
        }
        const oldStack = [...(this.stacks.get(proc.terminal) ?? [])]
        const terminals = this.display.split(proc.terminal, layout, commands)
        for (const old of oldStack) this.terminate(old)
        this.stacks.delete(proc.terminal)

        const shell = this.resolve('shell')
        if (!shell) throw new Error('kernel: no "shell" application registered')
        terminals.forEach((terminal, index) => {
          const command = commands[index]?.trim()
          if (command && command !== 'shell') {
            void this.spawn(shell, ['-c', command], terminal, 0).then(() => {
              if (!this.halted && this.display.terminals().includes(terminal)) this.spawn(shell, [], terminal, 0)
            })
          } else {
            this.spawn(shell, [], terminal, 0)
          }
        })
        return terminals
      },
      applications: () => this.appInfos(),
      info: () => this.systemInfo(),
      reboot: () => this.host.reboot(),
      shutdown: () => {
        for (const proc of [...this.procs.values()]) this.terminate(proc)
        this.halted = true
        this.display.halt(`${OS_NAME} halted`)
        this.host.shutdown()
      },
    }
  }

  private processList(): ProcessInfo[] {
    return [...this.procs.values()].map((proc) => ({
      pid: proc.pid,
      ppid: proc.ppid,
      name: proc.app.name,
      args: proc.args,
      tty: proc.terminal.id,
      startedAt: proc.startedAt,
    }))
  }

  private appInfos(): ApplicationInfo[] {
    return this.allApps.map((app) => ({
      name: app.name,
      aliases: app.aliases ?? [],
      summary: app.summary,
      synopsis: app.synopsis,
      description: app.description ?? [app.summary],
    }))
  }

  private systemInfo(): SystemInfo {
    const grid = this.display.grid
    return {
      name: OS_NAME,
      version: OS_VERSION,
      uptimeMs: Date.now() - this.startedAt,
      processes: this.procs.size,
      terminals: this.display.terminals().length,
      screen: { cols: grid.width, rows: grid.height },
      host: this.host.describe(),
    }
  }

  private newTerminal(cols: number, rows: number): Terminal {
    const terminal = new TerminalImpl(this.nextTty++, cols, rows)
    this.stacks.set(terminal, [])
    terminal.stdin.subscribe((data) => this.route(terminal, data))
    return terminal
  }

  private route(terminal: Terminal, data: string): void {
    if (this.halted) return
    const stack = this.stacks.get(terminal)
    if (!stack || stack.length === 0) return
    const top = stack[stack.length - 1]
    if (data === '\x03' && stack.length > 1) {
      this.terminate(top)
      terminal.write('^C\n')
      return
    }
    top.stdin.write(data)
  }

  private resolve(name: string): Application | undefined {
    return this.apps.get(name)
  }

  private spawn(app: Application, args: string[], terminal: Terminal, ppid: number): Promise<number> {
    const proc: Proc = {
      pid: this.nextPid++,
      ppid,
      app,
      args,
      terminal,
      ctrl: new AbortController(),
      stdin: createPipe(),
      alive: true,
      startedAt: Date.now(),
    }
    const stdout: OutputStream = {
      write: (data: string) => {
        if (proc.alive) terminal.write(data)
      },
    }
    const context: ApplicationContext = {
      args,
      terminal,
      stdin: proc.stdin,
      stdout,
      sys: this.syscalls(proc),
      signal: proc.ctrl.signal,
    }

    const done = Promise.resolve()
      .then(() => {
        this.procs.set(proc.pid, proc)
        // Pushed when the app actually starts: an exec'd caller must have
        // already stepped aside, or two processes would read one stdin.
        const stack = this.stacks.get(terminal) ?? []
        stack.push(proc)
        this.stacks.set(terminal, stack)
        return app.run(context)
      })
      .then(
        () => 0,
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          terminal.write(styled(`${app.name}: ${message}\n`, { fg: ERR_FG }))
          return 1
        },
      )
    const killed = new Promise<number>((resolve) => {
      proc.ctrl.signal.addEventListener('abort', () => resolve(130), { once: true })
    })

    return Promise.race([done, killed]).then((code) => {
      this.reap(proc)
      return code
    })
  }

  private reap(proc: Proc): void {
    if (!proc.alive) return
    proc.alive = false
    this.procs.delete(proc.pid)
    const stack = this.stacks.get(proc.terminal)
    if (stack) {
      const index = stack.indexOf(proc)
      if (index >= 0) stack.splice(index, 1)
    }
  }

  private terminate(proc: Proc): void {
    this.reap(proc)
    proc.ctrl.abort()
  }
}
