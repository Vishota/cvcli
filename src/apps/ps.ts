import type { Application } from '../app.ts'
import { styled } from '../sys/protocol.ts'
import { error, link, pad, padLeft } from './ui.ts'

export const ps: Application = {
  name: 'ps',
  summary: 'list running processes',
  synopsis: 'ps',
  description: ['Shows every live process: pid, parent, terminal, name and arguments.', 'The pid is clickable and runs kill <pid>.'],
  async run(context) {
    const rows = context.sys
      .processes()
      .map((proc) => ({
        pid: String(proc.pid),
        ppid: String(proc.ppid),
        tty: `tty${proc.tty}`,
        name: proc.name,
        args: proc.args.join(' '),
      }))
      .sort((a, b) => Number(a.pid) - Number(b.pid))

    const header = { pid: 'PID', ppid: 'PPID', tty: 'TTY', name: 'COMMAND', args: 'ARGS' }
    const width = {
      pid: Math.max(header.pid.length, ...rows.map((row) => row.pid.length)),
      ppid: Math.max(header.ppid.length, ...rows.map((row) => row.ppid.length)),
      tty: Math.max(header.tty.length, ...rows.map((row) => row.tty.length)),
      name: Math.max(header.name.length, ...rows.map((row) => row.name.length)),
    }

    const head = (text: string, size: number): string => styled(pad(text, size), { bold: true })
    context.stdout.write(
      '  ' + head(header.pid, width.pid) + '  ' + head(header.ppid, width.ppid) + '  ' + head(header.tty, width.tty) + '  ' + head(header.name, width.name) + '  ' + styled(header.args, { bold: true }) + '\n',
    )
    if (rows.length === 0) {
      context.stdout.write('  no processes\n')
      return 0
    }
    for (const row of rows) {
      context.stdout.write(
        '  ' +
          link(padLeft(row.pid, width.pid), `kill ${row.pid}`) +
          '  ' +
          pad(row.ppid, width.ppid) +
          '  ' +
          pad(row.tty, width.tty) +
          '  ' +
          pad(row.name, width.name) +
          '  ' +
          row.args +
          '\n',
      )
    }
    return 0
  },
}

export const kill: Application = {
  name: 'kill',
  summary: 'terminate a process',
  synopsis: 'kill <pid>...',
  description: ['Sends a termination signal to each pid. Unknown pids are reported.', 'Killing a pane shell takes the whole pane down with it.'],
  async run(context) {
    if (context.args.length === 0) {
      context.stdout.write(error('kill: pid required\n') + 'usage: kill <pid>...\n')
      return 1
    }
    let failed = false
    for (const arg of context.args) {
      const pid = Number(arg)
      if (!Number.isInteger(pid) || pid <= 0) {
        context.stdout.write(error(`kill: bad pid "${arg}"\n`))
        failed = true
        continue
      }
      if (!context.sys.kill(pid)) {
        context.stdout.write(error(`kill: (${pid}) - no such process\n`))
        failed = true
      }
    }
    return failed ? 1 : 0
  },
}
