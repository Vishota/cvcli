import type { CvLang, CvPage } from './cvstore.ts'

/*
 * ── EDIT THE CV TEXT HERE ────────────────────────────────────────────────────
 * Everything the cvui pane shows as prose comes from this one file.
 *
 * Conventions inside a `body` list:
 *   '# heading'  — a bold section heading
 *   '- item'     — a bullet list item
 *   ''           — a blank line (paragraph spacing)
 *   plain text   — a paragraph, wrapped to the pane width automatically
 *
 * INTRO is the block above the page content (right of the sidebar); `pdf` is
 * the sentence the "[ PDF version ]" copy-link is appended to.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// export const CV_OWNER = 'Uladzislau'
// Relative path: Vite copies public/cv.pdf to the site root, and a relative
// link works both as a GitHub Pages project site and on a custom domain.
export const CV_PDF_URL = 'cv.pdf'

export const INTRO: Record<CvLang, { text: string[]; pdf: string }> = {
  en: {
    text: [
      `Hi! My name is Uladzislau.`,
      'I am a Fullstack Node.js Developer and this app is my CV.',
    ],
    pdf: 'If you do not appreciate this interface, you should see',
  },
  ru: {
    text: [
      `Привет! Меня зовут Владислав.`,
      'Я Fullstack Node.js разработчик, и это приложение — моё CV.',
    ],
    pdf: 'Если вам не нравится этот интерфейс, посмотрите',
  },
}

export type CvPageContent = {
  title: Record<CvLang, string>
  body: Record<CvLang, string[]>
}

export const PAGES: Record<CvPage, CvPageContent> = {
  main: {
    title: { en: 'Main', ru: 'Главная' },
    body: {
      en: [
        'I have a lot of commercial and non-commercial experience developing precise, reliable, supportable and complex systems using JS stack.',
        '',
        'My typical project\'s stack:',
        '- Node.js',
        '- TypeScript',
        '- SQL',
        '- Vue.js',
        '- NGINX',
        '- Docker',
        '',
        'C1 English level.',
        '',
        'Graduated from BSUIR with honors.',
        '',
        'Passionate about programming since childhood. Developed numerous pet projects like the one you are looking at right now.',
        '',
        'Feel free to contact! Telegram: @vishota.'
      ],
      ru: [
        'Имею большой коммерческий и некоммерческий опыт разработки точных, надёжных, поддерживаемых и сложных систем на стеке JS.',
        '',
        'Стек моего типичного проекта:',
        '- Node.js',
        '- TypeScript',
        '- SQL',
        '- Vue.js',
        '- NGINX',
        '- Docker',
        '',
        'Уровень английского — C1.',
        '',
        'Окончил БГУИР с отличием.',
        '',
        'Увлекаюсь программированием с детства. Разработал множество пет-проектов, включая тот, на который вы сейчас смотрите.',
        '',
        'Я на связи! Telegram: @vishota.'
      ],
    },
  },
  skills: {
    title: { en: 'Skills', ru: 'Навыки' },
    body: {
      en: [
        'Main stack:',
        '- Node.js',
        '- TypeScript',
        '- SQL',
        '- Vue.js',
        '',
        'Backend & architecture:',
        'Express  ·  REST APIs  ·  JWT  ·  Microservices  ·  Event loop  ·  Multithreading  ·  CORS  ·  External APIs',
        '',
        'Infrastructure & tools:',
        'Linux  ·  Nginx  ·  Docker  ·  Git  ·  SSH  ·  FTP  ·  SSL',
        '',
        'Frontend:',
        'CSS & preprocessors  ·  Vite  ·  Figma  ·  WebGPU',
        '',
        'Engineering:',
        'Design patterns  ·  Design principles  ·  Security  ·  Cryptography  ·  Reliability  ·  Testing  ·  npm package development  ·  npm libraries & frameworks',
        '',
        'Soft skills:',
        'Communication  ·  Mentoring  ·  Leadership  ·  Determination  ·  Critical & systems thinking  ·  Continuous self-development  ·  Responsibility',
      ],
      ru: [
        'Основной стек:',
        '- Node.js',
        '- TypeScript',
        '- SQL',
        '- Vue.js',
        '- Nuxt',
        '',
        'Бэкенд и архитектура:',
        'Express  ·  REST API  ·  JWT  ·  Микросервисы  ·  Event Loop  ·  Многопоточность  ·  CORS  ·  Внешние API',
        '',
        'Инфраструктура и инструменты:',
        'Linux  ·  Nginx  ·  Docker  ·  Git  ·  SSH  ·  FTP  ·  SSL',
        '',
        'Фронтенд:',
        'CSS и препроцессоры  ·  Vite  ·  Figma  ·  WebGPU',
        '',
        'Инженерные практики:',
        'Паттерны проектирования  ·  Принципы проектирования  ·  Безопасность  ·  Криптография  ·  Надёжность  ·  Тестирование  ·  Разработка npm-пакетов  ·  Множество npm-библиотек и фреймворков',
        '',
        'Гибкие навыки:',
        'Коммуникация  ·  Наставничество  ·  Лидерство  ·  Целеустремлённость  ·  Критическое и системное мышление  ·  Постоянное развитие  ·  Ответственность',
      ],
    },
  },
  help: {
    title: { en: 'Help', ru: 'Помощь' },
    body: {
      en: [
        '# Keys',
        '- Up / Down — scroll the page one line.',
        '- PageUp / PageDown — scroll by ten lines.',
        '- Home / End — jump to the top or the bottom.',
        '- Ctrl-C — leave the CV screen (a shell takes the pane).',
        '# Commands',
        'The shell below accepts the same commands the buttons here run:',
        '- cv page main|skills|help|contact — open a page.',
        '- cv lang en|ru — switch the language.',
        '- cv theme NAME — switch the theme; cv theme next cycles.',
        '- cv scale add|sub — scale the interface up or down.',
        '- cv scroll up|down|top|bottom — scroll this page.',
        '- cv pdf — print the PDF version link.',
        '# Panes',
        'split, kill and ps manage panes and processes. Clicking a link in any pane runs its command in that pane. Try split v1:1 "neofetch" "ps" in the shell below.',
      ],
      ru: [
        '# Клавиши',
        '- Вверх / Вниз — прокрутить страницу на строку.',
        '- PageUp / PageDown — прокрутить на десять строк.',
        '- Home / End — в начало или в конец.',
        '- Ctrl-C — закрыть CV-экран (панель займёт шелл).',
        '# Команды',
        'Шелл снизу принимает те же команды, что выполняют кнопки здесь:',
        '- cv page main|skills|help|contact — открыть страницу.',
        '- cv lang en|ru — сменить язык.',
        '- cv theme ИМЯ — сменить тему; cv theme next листает по кругу.',
        '- cv scale add|sub — увеличить или уменьшить интерфейс.',
        '- cv scroll up|down|top|bottom — прокрутить эту страницу.',
        '- cv pdf — напечатать ссылку на PDF-версию.',
        '# Панели',
        'split, kill и ps управляют панелями и процессами. Клик по ссылке в любой панели выполняет команду в ней же. Попробуйте split v1:1 "neofetch" "ps" в шелле снизу.',
      ],
    },
  },
  contact: {
    title: { en: 'Contact', ru: 'Контакты' },
    body: {
      en: [
        '# Contact',
        '- Telegram (preferred) — @vishota',
        '- Email — mvishota@gmail.com',
        '- GitHub — github.com/vishota',
      ],
      ru: [
        '# Контакты',
        '- Telegram (предпочитаемый способ связи) — @vishota',
        '- Email — mvishota@gmail.com',
        '- GitHub — github.com/vishota',
      ],
    },
  }
}
