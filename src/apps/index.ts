import type { Application } from '../app.ts'
import { clear } from './clear.ts'
import { cv } from './cv.ts'
import { cvui } from './cvui.ts'
import { echo } from './echo.ts'
import { fetch, neofetch } from './fetch.ts'
import { help } from './help.ts'
import { intro } from './intro.ts'
import { man } from './man.ts'
import { kill, ps } from './ps.ts'
import { reboot } from './reboot.ts'
import { shell } from './shell.ts'
import { shutdown } from './shutdown.ts'
import { split } from './split.ts'
import { theme } from './theme.ts'

/** Every application the kernel knows about, in listing order. */
export const applications: Application[] = [
  shell,
  help,
  man,
  echo,
  clear,
  fetch,
  neofetch,
  ps,
  kill,
  split,
  intro,
  cvui,
  cv,
  theme,
  reboot,
  shutdown,
]
