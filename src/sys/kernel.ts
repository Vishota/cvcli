import type { Application, ApplicationContext, ApplicationInfo, ProcessInfo, SystemInfo, Syscalls } from '../app.ts'
import { tokenize } from '../apps/shell.ts'
import { Display, type Screen } from './display.ts'
import { countLeaves, parseLayout } from './layout.ts'
import { styled } from './protocol.ts'
import { createPipe, type OutputStream, type Pipe } from './stream.ts'
import { ThemeStore } from './theme.ts'
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
  paneClosed: boolean
  /** True when this process is responsible for its pane's lifetime. */
  ownsPane: boolean
  startedAt: number
}

const OS_NAME = 'CVOS'
const OS_VERSION = '0.6.7'
const ERR_FG = { type: 'ansi', value: 1 } as const

export class KernelImpl implements Kernel {
  readonly screen: Screen

  private readonly display: Display
  readonly themes: ThemeStore
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
    this.themes = new ThemeStore()
    this.screen = this.display
  }

  boot(init?: string): void {
    const root = this.display.rootTerminal()
    const shell = this.resolve('shell')
    if (!shell) throw new Error('kernel: no "shell" application registered')
    this.spawn(shell, [], root, 0, true)
    if (init) queueMicrotask(() => root.stdin.write(init + '\r'))
  }
  private syscalls(proc: Proc): Syscalls {
    return {
      self: () => proc.pid,
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
      split: (layout, commands = [], titles = []) => {
        const layoutTree = parseLayout(layout)
        const leaves = countLeaves(layoutTree)
        if (commands.length > leaves) {
          throw new Error(`layout "${layout}" fits ${leaves} pane(s), got ${commands.length} command(s)`)
        }
        const oldStack = [...(this.stacks.get(proc.terminal) ?? [])]
        const terminals = this.display.split(proc.terminal, layout, commands, titles)
        for (const old of oldStack) this.terminate(old)
        this.stacks.delete(proc.terminal)

        const shell = this.resolve('shell')
        if (!shell) throw new Error('kernel: no "shell" application registered')
        // Every leaf gets an interactive shell; leaves with a command first run
        // it, then fall back to a fresh shell.
        terminals.forEach((terminal, index) => {
          const command = commands[index]?.trim()
          if (command && command !== 'shell') {
            // The `-c` shell is transient: it runs the command, then a fresh
            // interactive shell (which owns the pane) takes over.
            void this.spawn(shell, ['-c', command], terminal, 0, false).then(() => {
              if (!this.halted && this.display.terminals().includes(terminal)) this.spawn(shell, [], terminal, 0, true)
            })
          } else {
            this.spawn(shell, [], terminal, 0, true)
          }
        })
        return terminals
      },
      open: (layout, commands = [], titles = []) => {
        // Like split, but no shell is spawned: a pane lives exactly as long as
        // its application, and closes the moment that application exits.
        const leaves = countLeaves(parseLayout(layout))
        if (commands.length > leaves) {
          throw new Error(`open: layout "${layout}" fits ${leaves} pane(s), got ${commands.length} command(s)`)
        }
        const oldStack = [...(this.stacks.get(proc.terminal) ?? [])]
        const terminals = this.display.split(proc.terminal, layout, commands, titles)
        for (const old of oldStack) this.terminate(old)
        this.stacks.delete(proc.terminal)

        terminals.forEach((terminal, index) => {
          const command = commands[index]?.trim()
          if (command) this.runPane(terminal, command)
        })
        return terminals
      },
      applications: () => this.appInfos(),
      info: () => this.systemInfo(),
      themeCurrent: () => this.themes.name,
      themeList: () => this.themes.list(),
      themeUse: (name) => this.themes.use(name),
      themeAdd: (name, fg, bg, colors) => this.themes.add(name, fg, bg, colors),
      themeGradient: (from, to, steps) => this.themes.gradient(from, to, steps),
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

  /**
   * Run a command line (possibly a pipeline) in a pane. When the line is a
   * single external application, it owns the pane: on exit the pane closes. A
   * builtin or a shell command is wrapped in a shell instead, which keeps the
   * pane open after it finishes.
   */
  private runPane(terminal: Terminal, command: string): void {
    const shell = this.resolve('shell')
    let words: string[]
    try {
      words = tokenize(command)
    } catch {
      words = []
    }
    const head = words.length === 1 ? this.resolve(words[0]) : undefined
    // A lone external application owns the pane; anything else (builtin,
    // pipeline, args, unknown) is wrapped so the pane can outlive one command.
    const ownsPane = !!head && head.name !== 'shell' && head.name !== 'sh'
    if (shell && ownsPane) {
      // A lone external application owns the pane; it closes when it exits.
      this.spawn(head!, [], terminal, 0, true)
    } else if (shell) {
      // Wrapped in a shell with no fallback (the `open` syscall), so this
      // shell owns the pane and closes it when the command finishes.
      this.spawn(shell, ['-c', command], terminal, 0, true)
    }
  }

  /** A pane whose owning process has exited: close it, or halt if it is the last. */
  private closePaneOf(terminal: Terminal, code: number): void {
    if (!this.display.terminals().includes(terminal)) return
    const next = this.display.closePane(terminal)
    if (next === null) {
      // The main shell instance's pane: nothing is left on screen, so halt.
      terminal.write(styled(`\n[process exited with code ${code}]\n`, { fg: ERR_FG }))
      this.shutdownScreen()
    }
  }

  private shutdownScreen(): void {
    if (this.halted) return
    for (const proc of [...this.procs.values()]) this.terminate(proc)
    this.halted = true
    this.display.halt(`${OS_NAME} halted`)
    this.host.shutdown()
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

  private spawn(app: Application, args: string[], terminal: Terminal, ppid: number, ownsPane = false): Promise<number> {
    const proc: Proc = {
      pid: this.nextPid++,
      ppid,
      app,
      args,
      terminal,
      ctrl: new AbortController(),
      stdin: createPipe(),
      alive: true,
      paneClosed: false,
      ownsPane,
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
      // A pane-owning process closes its pane when it is gone (by exit or by
      // kill); the system halts if it was the last one. Children (exec, the
      // transient `-c` startup shell) never own a pane.
      if (proc.ownsPane && !proc.paneClosed) {
        proc.paneClosed = true
        if (!this.halted) this.closePaneOf(proc.terminal, code)
      }
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
