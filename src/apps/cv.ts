import type { Application, Syscalls } from '../app.ts'
import { sanitizeText } from '../sys/protocol.ts'
import { CV_PDF_URL } from './cvcontent.ts'
import { CV_LANGS, CV_PAGES, SCALE_STEPS, cvStore, type CvLang, type CvPage } from './cvstore.ts'
import { bold, dim, error } from './ui.ts'

export type CvResult = { code: number; message: string }

const ok = (message: string): CvResult => ({ code: 0, message })
const fail = (message: string): CvResult => ({ code: 1, message: error(message) })

const scaleText = (index: number): string => `${Math.round(SCALE_STEPS[index] * 100)}%`

const USAGE = [
  'usage:',
  '  cv page main|skills|help|contact|next|prev',
  '  cv lang en|ru',
  '  cv theme NAME|next',
  '  cv scale add|sub|PERCENT',
  '  cv scroll up|down|top|bottom',
  '  cv pdf',
].join('\n')

/**
 * The `cv` command grammar, shared by the `cv` app and the cvui pane: a click
 * on a cvui button feeds the same tokens here that a typed `cv ...` does.
 */
export function applyCvCommand(sys: Syscalls, args: string[]): CvResult {
  const [sub, value] = args
  const state = cvStore.get()

  if (!sub) {
    return ok(
      bold('page ') + state.page +
        dim('  lang ') + state.lang +
        dim('  theme ') + sys.themeCurrent() +
        dim('  scale ') + scaleText(state.scale),
    )
  }

  if (sub === 'page') {
    if (!value || value === 'next' || value === 'prev') {
      const dir = value === 'prev' ? -1 : 1
      const index = (CV_PAGES.indexOf(state.page) + dir + CV_PAGES.length) % CV_PAGES.length
      cvStore.set({ page: CV_PAGES[index], scroll: 0 })
      return ok(`page: ${CV_PAGES[index]}`)
    }
    if (!CV_PAGES.includes(value as CvPage)) return fail(`cv: unknown page "${value}"`)
    cvStore.set({ page: value as CvPage, scroll: 0 })
    return ok(`page: ${value}`)
  }

  if (sub === 'lang') {
    let lang: CvLang
    if (value === 'en' || value === 'ru') lang = value
    else if (!value) lang = state.lang === 'en' ? 'ru' : 'en'
    else return fail(`cv: unknown language "${value}" (use ${CV_LANGS.join(' or ')})`)
    cvStore.set({ lang })
    return ok(`lang: ${lang}`)
  }

  if (sub === 'theme') {
    if (value === 'next') {
      const list = sys.themeList()
      const index = list.indexOf(sys.themeCurrent())
      const name = list[(index + 1) % Math.max(1, list.length)]
      if (!name || !sys.themeUse(name)) return fail('cv: no themes to switch to')
      cvStore.touch()
      return ok(`theme: ${name}`)
    }
    if (!value) return ok(`theme: ${sys.themeCurrent()}`)
    if (!sys.themeUse(value)) return fail(`cv: unknown theme "${value}" (try "theme list")`)
    cvStore.touch()
    return ok(`theme: ${value}`)
  }

  if (sub === 'scale') {
    let index = state.scale
    if (value === 'add' || value === '+') index = state.scale + 1
    else if (value === 'sub' || value === '-') index = state.scale - 1
    else if (value && /^\d+%?$/.test(value)) {
      const wanted = Number(value.replace('%', ''))
      index = SCALE_STEPS.reduce(
        (best, step, i) => (Math.abs(step * 100 - wanted) < Math.abs(SCALE_STEPS[best] * 100 - wanted) ? i : best),
        0,
      )
    } else if (value) return fail(`cv: bad scale "${value}" (use add, sub or a percent)`)
    index = Math.max(0, Math.min(SCALE_STEPS.length - 1, index))
    cvStore.set({ scale: index })
    return ok(`scale: ${scaleText(index)}`)
  }

  if (sub === 'scroll') {
    const dir = value ?? 'down'
    const next =
      dir === 'up' ? state.scroll - 1 :
      dir === 'down' ? state.scroll + 1 :
      dir === 'top' ? 0 :
      dir === 'bottom' ? Number.MAX_SAFE_INTEGER : NaN
    if (!Number.isFinite(next)) return fail(`cv: unknown scroll direction "${value}"`)
    cvStore.set({ scroll: Math.max(0, next) })
    return ok(`scroll: ${dir}`)
  }

  if (sub === 'pdf') {
    return ok(`${sanitizeText(CV_PDF_URL)}\n(a copy of this link is on the [ PDF version ] button)`)
  }

  return fail(`cv: unknown subcommand "${sub}"\n${USAGE}`)
}

export const cv: Application = {
  name: 'cv',
  summary: 'control the CV screen: pages, language, theme, scale, scroll',
  synopsis: 'cv [page NAME|lang en|ru|theme NAME|scale add|sub|scroll DIR|pdf]',
  description: [
    'Manages the state of the cvui pane: which page it shows, in which',
    'language, at which scale, and where it is scrolled to. The same commands',
    'run when you click the buttons on the CV screen itself.',
  ],
  async run(context) {
    const result = applyCvCommand(context.sys, context.args)
    context.stdout.write(result.message + '\n')
    return result.code
  },
}
