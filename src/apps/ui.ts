import type { Color } from '../sys/grid.ts'
import { styled } from '../sys/protocol.ts'

export const COLORS = {
  black: { type: 'ansi', value: 0 },
  red: { type: 'ansi', value: 1 },
  green: { type: 'ansi', value: 2 },
  yellow: { type: 'ansi', value: 3 },
  blue: { type: 'ansi', value: 4 },
  magenta: { type: 'ansi', value: 5 },
  cyan: { type: 'ansi', value: 6 },
  white: { type: 'ansi', value: 7 },
  gray: { type: 'ansi', value: 8 },
  brightRed: { type: 'ansi', value: 9 },
  brightGreen: { type: 'ansi', value: 10 },
  brightYellow: { type: 'ansi', value: 11 },
  brightBlue: { type: 'ansi', value: 12 },
  brightCyan: { type: 'ansi', value: 14 },
  brightWhite: { type: 'ansi', value: 15 },
} satisfies Record<string, Color>

export function bold(text: string): string {
  return styled(text, { bold: true })
}

export function dim(text: string): string {
  return styled(text, { fg: COLORS.gray })
}

export function error(text: string): string {
  return styled(text, { fg: COLORS.red })
}

/** Clickable text: the cell carries the command, the click feeds the shell. */
export function link(text: string, command: string): string {
  return styled(text, { fg: COLORS.blue, underline: true }, command)
}

/** Click-to-copy text: the cell carries the payload, the click copies it. */
export function copyLink(text: string, payload: string): string {
  return styled(text, { fg: COLORS.blue, underline: true }, '', payload)
}

/** Click-to-open text: the cell carries the URL, the click opens a new tab. */
export function openLink(text: string, url: string): string {
  return styled(text, { fg: COLORS.blue, underline: true }, undefined, undefined, url)
}

export function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - text.length))
}

export function padLeft(text: string, width: number): string {
  return ' '.repeat(Math.max(0, width - text.length)) + text
}
