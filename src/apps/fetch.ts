import type { Application, SystemInfo } from '../app.ts'
import { styled } from '../sys/protocol.ts'
import { bold, dim, link } from './ui.ts'

// Compact unicode-block wordmark, 5 rows x 10 columns.
const LOGO = [
  '  ▄▄·  ▌ ▐·',
  ' ▐█ ▌▪▪█·█▌',
  ' ██ ▄▄▐█▐█•',
  ' ▐███▌ ███ ',
  ' ·▀▀▀ . ▀  ',
]
const LOGO_WIDTH = LOGO.reduce((max, line) => Math.max(max, line.length), 0)

/** Color one logo line char by char through a left-to-right gradient. */
export function gradientLine(line: string, ramp: string[], boldGlyphs: boolean): string {
  let out = ''
  let i = 0
  for (const ch of line) {
    if (ch === ' ') {
      out += ch
      continue
    }
    const hex = ramp[Math.min(i, ramp.length - 1)]
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    out += styled(ch, { fg: { type: 'rgb', r, g, b }, bold: boldGlyphs })
    i++
  }
  return out
}

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
    link('ps', 'ps') +
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
    const ramp = context.sys.themeGradient('#ff2e6b', '#25f4ee', LOGO_WIDTH) ?? []
    const lines = [bold(info.name) + dim(` v${info.version}`), ...systemInfo(info)]
    const height = Math.max(LOGO.length, lines.length)
    for (let i = 0; i < height; i++) {
      const logoLine = LOGO[i] ?? ''
      const logo = ramp.length ? gradientLine(logoLine, ramp, true) : dim(logoLine.padEnd(LOGO_WIDTH))
      const text = lines[i] ?? ''
      context.stdout.write(logo + (text ? '  ' + text : '') + '\n')
    }
    context.stdout.write(hints())
    return 0
  },
}

