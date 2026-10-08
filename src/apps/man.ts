import type { Application } from '../app.ts'
import { bold, dim, error, link } from './ui.ts'

export const man: Application = {
  name: 'man',
  summary: 'show a manual page',
  synopsis: 'man [page]',
  description: [
    'Without an argument lists all pages. With an argument it prints',
    'NAME, SYNOPSIS, DESCRIPTION and OPTIONS of that application.',
    'Listed names are clickable and run the matching command.',
  ],
  async run(context) {
    const pages = context.sys.applications()
    const wanted = context.args[0]
    if (!wanted) {
      context.stdout.write(bold('available pages\n\n'))
      for (const page of pages) {
        context.stdout.write('  ' + link(page.name.padEnd(10), `man ${page.name}`) + '  ' + dim(page.summary) + '\n')
      }
      context.stdout.write('\nclick a name or run: man <page>\n')
      return 0
    }
    const page = pages.find((candidate) => candidate.name === wanted || candidate.aliases.includes(wanted))
    if (!page) {
      context.stdout.write(error(`man: no manual entry for ${wanted}\n`))
      return 1
    }
    context.stdout.write('\n' + bold(page.name.toUpperCase()) + '       ' + dim(page.summary) + '\n\n')
    context.stdout.write(bold('NAME\n       ') + page.name + ' - ' + page.summary + '\n\n')
    context.stdout.write(bold('SYNOPSIS\n       ') + page.synopsis + '\n\n')
    context.stdout.write(bold('DESCRIPTION\n'))
    for (const line of page.description) context.stdout.write('       ' + line + '\n')
    if (page.aliases.length > 0) context.stdout.write('\n' + bold('ALIASES\n       ') + page.aliases.join(', ') + '\n')
    context.stdout.write('\n')
    return 0
  },
}
