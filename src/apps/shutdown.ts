import type { Application } from '../app.ts'
import { dim } from './ui.ts'

export const shutdown: Application = {
  name: 'shutdown',
  summary: 'halt the system',
  synopsis: 'shutdown [now]',
  description: [
    'Kills every process, paints "system halted" and stops accepting input.',
    'Browsers refuse to close tabs they did not open, so the window may stay.',
  ],
  async run(context) {
    context.stdout.write(dim('shutting down...\n'))
    await new Promise((resolve) => setTimeout(resolve, 150))
    // The kernel host owns the platform: it halts everything and, in a
    // browser, tries to close the tab. Nothing left for the app to do.
    context.sys.shutdown()
    return 0
  },
}
