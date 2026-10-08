import type { Application } from '../app.ts'
import { dim } from './ui.ts'

export const reboot: Application = {
  name: 'reboot',
  summary: 'restart the system',
  synopsis: 'reboot',
  description: ['Reloads the page: the whole terminal environment boots from scratch.'],
  async run(context) {
    context.stdout.write(dim('rebooting...\n'))
    await new Promise((resolve) => setTimeout(resolve, 150))
    context.sys.reboot()
    return 0
  },
}
