import type { Application } from '../app.ts'
import { bold, error, link } from './ui.ts'

const SLOT_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'gray', 'bred', 'bgreen', 'byellow', 'bblue', 'bmagenta', 'bcyan', 'bwhite']

function usage(): string {
  return (
    bold('theme') +
    ' — manage color themes\n' +
    '\n' +
    '  theme                 show the active theme\n' +
    '  theme list            list every known theme\n' +
    '  theme use NAME        switch to NAME\n' +
    '  theme add NAME FG BG C0 C1 ... C15\n' +
    '\n' +
    'FG/BG and the 16 colors are #hex, an ANSI index 0-15, or a color name.\n' +
    'Colors are given in palette order:\n' +
    '  ' +
    SLOT_NAMES.join(' ') +
    '\n' +
    'Example:\n' +
    '  ' +
    link('theme add dracula #f8f8f2 #282a36 #21222c #ff5555 ...', 'theme add dracula #f8f8f2 #282a36 #21222c #ff5555 #50fa7b #f1fa8c #bd93f9 #ff79c6 #8be9fd #f8f8f2 #6272a4 #ff6e6e #69ff94 #ffffa5 #d6acff #ff92df #a4ffff #ffffff')
  )
}

export const theme: Application = {
  name: 'theme',
  summary: 'list, switch and define color themes',
  synopsis: 'theme [list|use NAME|add NAME FG BG C0..C15]',
  description: [
    'Recolors the whole terminal through the active theme.',
    'Every ANSI color an application prints is resolved against the theme,',
    'so switching themes changes prompts, borders, errors and links at once.',
  ],
  async run(context) {
    const args = [...context.args]
    const out = context.stdout
    const sub = args[0]

    if (!sub) {
      const current = context.sys.themeCurrent()
      out.write(bold('active theme: ') + link(current, `theme use ${current}`) + '\n')
      out.write('run ' + link('theme list', 'theme list') + ' to see all themes\n')
      return 0
    }

    if (sub === 'list') {
      const current = context.sys.themeCurrent()
      const names = context.sys.themeList()
      out.write(bold('themes:') + '\n')
      for (const name of names) {
        const marker = name === current ? ' ' + bold('*') : '  '
        out.write(marker + link(name, `theme use ${name}`) + '\n')
      }
      return 0
    }

    if (sub === 'use') {
      const name = args[1]
      if (!name) {
        out.write(error('theme use: name required\n') + 'usage: theme use NAME\n')
        return 1
      }
      if (!context.sys.themeUse(name)) {
        out.write(error(`theme use: unknown theme "${name}"\n`))
        return 1
      }
      out.write(bold('theme set to ') + name + '\n')
      return 0
    }

    if (sub === 'add') {
      const name = args[1]
      const rest = args.slice(2)
      if (!name || rest.length !== 18) {
        out.write(error('theme add: expected NAME, fg, bg and 16 colors\n'))
        out.write(usage() + '\n')
        return 1
      }
      const [fg, bg, ...colors] = rest
      if (!context.sys.themeAdd(name, fg, bg, colors)) {
        out.write(error('theme add: invalid color token (use #hex, 0-15, or a name)\n'))
        return 1
      }
      out.write(bold('theme added: ') + name + ' — ' + link('use it', `theme use ${name}`) + '\n')
      return 0
    }

    out.write(error(`theme: unknown subcommand "${sub}"\n`) + usage() + '\n')
    return 1
  },
}
