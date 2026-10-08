import type { Application, SystemInfo } from '../app.ts'
import { bold, dim, link } from './ui.ts'

// Compact unicode-block wordmark, 5 rows x 10 columns.
const LOGO = [
  ' ▄▄·  ▌ ▐·',
  '▐█ ▌▪▪█·█▌',
  '██ ▄▄▐█▐█•',
  '▐███▌ ███ ',
  '·▀▀▀ . ▀  ',
]
const LOGO_WIDTH = LOGO.reduce((max, line) => Math.max(max, line.length), 0)

function uptimeText(ms: number): string {
  const uptime = Math.max(0, Math.floor(ms / 1000))
  const hh = String(Math.floor(uptime / 3600)).padStart(2, '0')
  const mm = String(Math.floor((uptime % 3600) / 60)).padStart(2, '0')
  const ss = String(uptime % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export function systemInfo(info: SystemInfo): string[] {
  const host = Object.entries(info.host)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ')
  return [
    `uptime    ${uptimeText(info.uptimeMs)}`,
    `procs     ${info.processes}   ttys ${info.terminals}`,
    `screen    ${info.screen.cols}x${info.screen.rows}`,
    `host      ${host}`,
  ]
}

function hints(): string {
  return (
    '\n' +
    dim('try: ') +
    link('help', 'help') +
    dim('  ') +
    link('man', 'man') +
    dim('  ') +
    link('split v3:1', 'split v3:1 "neofetch" "ps"') +
    '\n'
  )
}

export const fetch: Application = {
  name: 'fetch',
  summary: 'show system information',
  synopsis: 'fetch',
  description: ['Prints system information in one compact block.'],
  async run(context) {
    const info = context.sys.info()
    context.stdout.write(bold(info.name) + dim(` v${info.version}`) + '\n')
    for (const line of systemInfo(info)) context.stdout.write(line + '\n')
    context.stdout.write(hints())
    return 0
  },
}

export const neofetch: Application = {
  name: 'neofetch',
  summary: 'show system information with the logo',
  synopsis: 'neofetch',
  description: ['Same as fetch, with an ASCII logo next to the information.'],
  async run(context) {
    const info = context.sys.info()
    const lines = [bold(info.name) + dim(` v${info.version}`), ...systemInfo(info)]
    const height = Math.max(LOGO.length, lines.length)
    for (let i = 0; i < height; i++) {
      const logo = (LOGO[i] ?? '').padEnd(LOGO_WIDTH)
      const text = lines[i] ?? ''
      context.stdout.write(dim(logo) + (text ? '  ' + text : text) + '\n')
    }
    context.stdout.write(hints())
    return 0
  },
}

