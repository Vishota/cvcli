import type { Application } from '../app.ts'
import { bold, dim, link } from './ui.ts'

export const help: Application = {
  name: 'help',
  summary: 'list available commands',
  synopsis: 'help',
  description: ['Lists every application with a clickable name.'],
  async run(context) {
    context.stdout.write(bold('commands\n\n'))
    for (const app of context.sys.applications()) {
      context.stdout.write('  ' + link(app.name.padEnd(10), app.name) + '  ' + dim(app.summary) + '\n')
    }
    context.stdout.write('\nrun "man <command>" for details\n')
    return 0
  },
}
