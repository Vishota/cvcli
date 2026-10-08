import type { Application } from '../app.ts'
import { CLEAR_SCREEN } from '../sys/protocol.ts'

export const clear: Application = {
  name: 'clear',
  summary: 'clear the terminal screen',
  synopsis: 'clear',
  description: ['Erases everything on the screen of this terminal and homes the cursor.'],
  async run(context) {
    context.stdout.write(CLEAR_SCREEN)
    return 0
  },
}
