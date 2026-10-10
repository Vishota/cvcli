export type CvLang = 'en' | 'ru'
export const CV_LANGS: readonly CvLang[] = ['en', 'ru']

export type CvPage = typeof  CV_PAGES[number]
export const CV_PAGES = ['main', 'skills', 'help', 'contact'] as const


/** Font scale ladder for the browser renderer; the state keeps the index. */
export const SCALE_STEPS: readonly number[] = [0.7, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2]
export const DEFAULT_SCALE: number = SCALE_STEPS.indexOf(1)

export type CvState = {
  page: CvPage
  lang: CvLang
  /** Index into SCALE_STEPS. */
  scale: number
  /** Scroll offset of the active page body, in text lines. */
  scroll: number
}

const INITIAL: CvState = { page: 'main', lang: 'en', scale: DEFAULT_SCALE, scroll: 0 }

/**
 * The shared CV state: `cv` changes it, `cvui` renders it. A plain data object
 * with change notifications — no DOM, no terminal, no process in sight, the
 * same pattern as ThemeStore.
 */
export class CvStore {
  private state: CvState = { ...INITIAL }
  private readonly listeners = new Set<() => void>()

  get(): CvState {
    return { ...this.state }
  }

  set(patch: Partial<CvState>): void {
    this.state = { ...this.state, ...patch }
    this.emit()
  }

  /** Announce a change that lives outside this store (e.g. the theme name). */
  touch(): void {
    this.emit()
  }

  reset(): void {
    this.state = { ...INITIAL }
    this.emit()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

/** One instance per page load: every pane of the CV shares the same state. */
export const cvStore = new CvStore()
