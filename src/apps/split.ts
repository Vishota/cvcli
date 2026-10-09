import type { Application } from '../app.ts'
import { error } from './ui.ts'

export const split: Application = {
  name: 'split',
  aliases: ['vsplit'],
  summary: 'split this pane and run a shell in each part',
  synopsis: 'split [layout] [command]... [--title NAME command]',
  description: [
    'Replaces this terminal with a weighted pane tree and starts a shell',
    'in every leaf. Extra commands fill leaves left to right; remaining',
    'leaves get an interactive shell. With no layout it splits 50/50 (v1:1).',
    '  layout = ("v"|"h") weight(":"weight)* (("("(layout|leaf)")")|leaf)*',
    '  v3:1        two panes, left gets 3/4 of the space',
    '  h1:2        two rows, top gets 1/3',
    '  v1:(h1:2)   left pane, right side split into two rows',
    '  --title X cmd   title pane X (shown as [X] on its top border)',
    'Killing a pane shell closes the pane. When the last pane of a split',
    'closes, the previous terminal is restored.',
    'A click on a link runs its command in the pane that was clicked.',
    'Example: split v3:1 "neofetch" --title sys "ps"',
  ],
  async run(context) {
    const args = [...context.args]
    // No layout -> split the pane in half, the common case.
    const layout = args[0] && /^[vh]/.test(args[0]) ? args.shift()! : 'v1:1'
    // Parse the rest into parallel command/title lists. `--title X` attaches
    // the title X to the command that follows it, so the two share a slot:
    //   split v1:1 neofetch --title sys
    const commands: string[] = []
    const titles: string[] = []
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === '--title') {
        const name = args[i + 1] ?? ''
        const cmd = args[i + 2]
        if (cmd !== undefined && cmd !== '--title') {
          commands.push(cmd)
          titles.push(name)
          i += 2
          continue
        }
        // A trailing title with no command still reserves a pane.
        commands.push('')
        titles.push(name)
        i += 1
        continue
      }
      commands.push(arg)
      titles.push('')
    }
    try {
      context.sys.split(layout, commands, titles)
      return 0
    } catch (error_) {
      const message = error_ instanceof Error ? error_.message : String(error_)
      context.stdout.write(error(`split: ${message}\n`))
      return 1
    }
  },
}

