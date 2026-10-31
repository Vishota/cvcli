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
// The RU page lives one level deeper (/ru/), so its PDF link climbs up.
const onRuPage = typeof location !== 'undefined' && /\/ru\/?$/.test(location.pathname)
export const CV_PDF_URL = onRuPage ? '../cv.pdf' : 'cv.pdf'

export const INTRO: Record<CvLang, { text: string[]; pdf: string }> = {
  en: {
    text: [
      'This app is my CLI-styled CV.',
      '',
    ],
    pdf: 'If you do not appreciate this interface, you should see',
  },
  ru: {
    text: [
      'Это приложение — моё CV в стиле CLI.',
      '',
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
        `Hi! My name is Mishota Uladzislau.`,
        'Goal-oriented JavaScript Fullstack developer, ready to learn new skills and grow professionally. Interested in programming since childhood and constantly expanding my knowledge. I regularly build pet projects for self-education. Detail-oriented and stress-resistant; a team player who sees things through.',
        'I am currently actively looking for a job.',
        'I focus on building high-performance web applications, scalable Node.js microservices and interactive graphics (Cocos, Pixi.js, Three.js).',
        '',
        'My typical project\'s stack:',
        '- Node.js',
        '- TypeScript',
        '- SQL',
        '- Vue.js',
        '',
        'C1 English level.',
        '',
        'BSUIR 2021 - 2025, "Engineering and psychological support of information technologies", GPA 9.41/10.',
        '',
        'Feel free to contact! Telegram: @vishota.'
      ],
      ru: [
        `Привет! Меня зовут Мишота Владислав.`,
        'Целеустремлённый JavaScript Fullstack-разработчик, готовый к освоению новых навыков и профессиональному росту. Интересуюсь программированием с детства и постоянно повышаю уровень своих знаний. Регулярно разрабатываю проекты «для себя» в целях самообразования. Внимателен к деталям, стрессоустойчив. Умею работать в команде, довожу дела до конца.',
        'Сейчас я нахожусь в активном поиске работы.',
        'Фокусируюсь на высокопроизводительных веб-приложениях, масштабируемых Node.js-микросервисах и интерактивной графике (Cocos, Pixi.js, Three.js).',
        '',
        'Стек моего типичного проекта:',
        '- Node.js',
        '- TypeScript',
        '- SQL',
        '- Vue.js',
        '',
        'Уровень английского — C1.',
        '',
        'БГУИР 2021 - 2025, «Инженерно-психологическое обеспечение информационных технологий», средний балл 9.41/10.',
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
        'CSS & preprocessors  ·  Vite  ·  Figma  ·  WebGPU  ·  Cocos Creator  ·  Pixi.js  ·  Three.js',
        '',
        'Engineering:',
        'Design patterns  ·  Design principles  ·  Security  ·  Cryptography  ·  Reliability  ·  Testing  ·  npm package development  ·  npm libraries & frameworks',
        '',
        'Also acquainted with:',
        'Design & UI/UX: Photoshop  ·  Blender  ·  Usability',
        'Other languages: C++  ·  PHP  ·  Python (basics)',
        'CS fundamentals: Networks  ·  Cryptography  ·  Cybersecurity  ·  Management',
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
        'CSS и препроцессоры  ·  Vite  ·  Figma  ·  WebGPU  ·  Cocos Creator  ·  Pixi.js  ·  Three.js',
        '',
        'Инженерные практики:',
        'Паттерны проектирования  ·  Принципы проектирования  ·  Безопасность  ·  Криптография  ·  Надёжность  ·  Тестирование  ·  Разработка npm-пакетов  ·  Множество npm-библиотек и фреймворков',
        '',
        'Также знаком с:',
        'Дизайн и UI/UX: Photoshop  ·  Blender  ·  Usability',
        'Другие языки: C++  ·  PHP  ·  Python (основы)',
        'Основы CS: Сети  ·  Криптография  ·  Кибербезопасность  ·  Менеджмент',
        '',
        'Гибкие навыки:',
        'Коммуникация  ·  Наставничество  ·  Лидерство  ·  Целеустремлённость  ·  Критическое и системное мышление  ·  Постоянное развитие  ·  Ответственность',
      ],
    },
  },
  experience: {
    title: { en: 'Experience', ru: 'Опыт' },
    body: {
      en: [
        '# MRAID Development (mraid.io) — Feb 2024 - Sep 2025',
        '',
        'Worked on Playable Ads with Cocos Creator, Pixi.js, Three.js and other tools.',
        'Optimized the Dashboard service and added new features on request (tracking, builds for specific networks).',
        'Fixed bugs and optimized legacy code.',
        '',
        '# Career track',
        '- Feb 2024 - Sep 2025 — MRAID Development.',
        '- Sep 2025 - Sep 2026 — compulsory military service.',
        '- Now — job seek.',
      ],
      ru: [
        '# MRAID Development (mraid.io) — фев 2024 - сен 2025',
        '',
        'Работал с Playable Ads с использованием Cocos Creator, Pixi.js, Three.js и прочих инструментов.',
        'Оптимизировал работу Dashboard-сервиса, добавлял новые фичи по запросу (трекинг, билды для определённых сетей).',
        'Исправлял баги, оптимизировал Legacy-код.',
        '',
        '# Карьерный трек',
        '- фев 2024 - сен 2025 — MRAID Development.',
        '- сен 2025 - сен 2026 — срочная военная служба.',
        '- сейчас — в поиске работы.',
      ],
    },
  },
  help: {
    title: { en: 'Help', ru: 'Помощь' },
    body: {
      en: [
        'Brief information about this software is located here.',
        '',
        '# Keys',
        '- Up / Down — scroll the page one line.',
        '- PageUp / PageDown — scroll by ten lines.',
        '- Home / End — jump to the top or the bottom.',
        '- Ctrl-C — leave the CV screen (a shell takes the pane).',
        '',
        '# Commands',
        'The shell below accepts the same commands the buttons here run:',
        '- cv page main|skills|experience|help|contact — open a page.',
        '- cv lang en|ru — switch the language.',
        '- cv theme NAME — switch the theme; cv theme next cycles.',
        '- cv scale add|sub — scale the interface up or down.',
        '- cv scroll up|down|top|bottom — scroll this page.',
        '- cv pdf — print the PDF version link.',
        '# Panes',
        'split, kill and ps manage panes and processes. Clicking a link in any pane runs its command in that pane. Try split v1:1 "neofetch" "ps" in the shell below.',
      ],
      ru: [
        'Здесь расположена краткая информация об этой системе.',
        '',
        '# Клавиши',
        '',
        '- Вверх / Вниз — прокрутить страницу на строку.',
        '- PageUp / PageDown — прокрутить на десять строк.',
        '- Home / End — в начало или в конец.',
        '- Ctrl-C — закрыть CV-экран (панель займёт шелл).',
        '',
        '# Команды',
        'Шелл снизу принимает те же команды, что выполняют кнопки здесь:',
        '- cv page main|skills|experience|help|contact — открыть страницу.',
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
        '- Phone — +375 (25) 507-70-70',
        '- Email — mvishota@gmail.com',
        '- GitHub — github.com/vishota',
      ],
      ru: [
        '# Контакты',
        '- Telegram (предпочитаемый способ связи) — @vishota',
        '- Телефон — +375 (25) 507-70-70',
        '- Email — mvishota@gmail.com',
        '- GitHub — github.com/vishota',
      ],
    },
  }
}
