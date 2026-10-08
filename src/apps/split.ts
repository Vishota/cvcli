import type { Application } from '../app.ts'
import { error } from './ui.ts'

export const split: Application = {
  name: 'split',
  aliases: ['vsplit'],
  summary: 'split this pane and run a shell in each part',
  synopsis: 'split <layout> [command]...',
  description: [
    'Replaces this terminal with a weighted pane tree and starts a shell',
    'in every leaf. Extra commands fill leaves left to right; remaining',
    'leaves get an interactive shell.',
    '  layout = ("v"|"h") weight(":"weight)* (("("(layout|leaf)")")|leaf)*',
    '  v3:1        two panes, left gets 3/4 of the space',
    '  h1:2        two rows, top gets 1/3',
    '  v1:(h1:2)   left pane, right side split into two rows',
    'A click on a link runs its command in the pane that was clicked.',
    'Example: split v3:1 "neofetch" "ps"',
  ],
  async run(context) {
    const args = [...context.args]
    const layout = args.shift()
    if (!layout) {
      context.stdout.write(error('split: layout required\n') + 'usage: ' + 'split <layout> [command]...\n')
      return 1
    }
    try {
      context.sys.split(layout, args)
      return 0
    } catch (error_) {
      const message = error_ instanceof Error ? error_.message : String(error_)
      context.stdout.write(error(`split: ${message}\n`))
      return 1
    }
  },
}

