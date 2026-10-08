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
    context.sys.shutdown()
    try {
      window.close()
    } catch {
      /* browsers only allow closing script-opened windows */
    }
    return 0
  },
}
