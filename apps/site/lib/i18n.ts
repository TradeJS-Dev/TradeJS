export type Locale = 'en' | 'ru';

export const translations = {
  en: {
    nav: {
      advantages: 'Advantages',
      howItWorks: 'How It Works',
      devExperience: 'For Developers',
      github: 'GitHub',
      quickstart: 'Getting Started',
    },
    hero: {
      actionWords: ['WRITE', 'TEST', 'RUN'],
      titleSuffix: 'Trading Strategies',
      subtitle: 'Open-source framework for TypeScript & Pine Script strategies',
      quickstart: 'Getting Started',
      trust: {
        backtesting: 'Grid Backtesting',
        runtime: 'Runtime Signals',
        aiml: 'AI / ML',
        telegram: 'Telegram Alerts',
      },
    },
    // Group 1: Strategy Authoring (TS + Pine + Local)
    strategyAuthoring: {
      sectionTitle: 'Strategy Authoring',
      sectionSubtitle:
        'Write strategies in your preferred language with full infrastructure control',
      items: [
        {
          title: 'TypeScript Strategies & Indicators',
          description:
            'Write strategies and indicators in TypeScript with full type safety, autocompletion, and access to the entire npm ecosystem.',
          links: [
            {
              label: 'Write Strategies',
              url: 'https://docs.tradejs.dev/strategies/authoring/write-strategies',
            },
            {
              label: 'Author Indicators',
              url: 'https://docs.tradejs.dev/indicators/authoring',
            },
          ],
        },
        {
          title: 'Pine Script Compatibility',
          description:
            'Migrate existing TradingView strategies seamlessly. TradeJS supports Pine Script authoring alongside TypeScript.',
          links: [
            {
              label: 'Pine Strategies',
              url: 'https://docs.tradejs.dev/strategies/authoring/pine-strategy-step-by-step',
            },
            {
              label: 'Pine Indicators',
              url: 'https://docs.tradejs.dev/indicators/pine',
            },
          ],
        },
        {
          title: 'Local & Self-Hosted',
          description:
            'Run TradeJS locally or deploy self-hosted. Full control over your data, infrastructure, and execution environment.',
          links: [
            {
              label: 'Local Setup',
              url: 'https://docs.tradejs.dev/getting-started/quickstart',
            },
            {
              label: 'Self-Hosted',
              url: 'https://docs.tradejs.dev/operations/production-runbook',
            },
          ],
        },
      ],
    },
    // Group 2: Intelligence & Backtesting (AI/ML + Grid)
    intelligence: {
      sectionTitle: 'Intelligence & Backtesting',
      sectionSubtitle:
        'AI-powered signal enhancement and massive parameter optimization',
      items: [
        {
          title: 'Grid Backtesting',
          description:
            'Run massive parameter sweeps with grid config. Find optimal strategy configurations across thousands of combinations automatically.',
          links: [
            {
              label: 'Grid Config',
              url: 'https://docs.tradejs.dev/runtime/backtesting/grid-config',
            },
          ],
        },
        {
          title: 'Built-in AI / ML',
          description:
            'Enhance your signals with AI and ML models. Configurable pipelines for signal filtering, prediction, and risk scoring.',
          links: [
            {
              label: 'AI Configuration',
              url: 'https://docs.tradejs.dev/ai-ml/ai/configuration',
            },
            {
              label: 'ML Configuration',
              url: 'https://docs.tradejs.dev/ai-ml/ml/configuration',
            },
          ],
        },
      ],
    },
    // Group 3: Execution & Monitoring (Pipeline + Telegram)
    execution: {
      sectionTitle: 'Execution & Monitoring',
      sectionSubtitle:
        'From backtest results to live trading with real-time notifications',
      items: [
        {
          title: 'Backtest-to-Runtime Pipeline',
          description:
            'Promote your best backtest results directly to runtime config. No manual tuning — the framework handles the transition.',
          links: [
            {
              label: 'Results to Runtime',
              url: 'https://docs.tradejs.dev/runtime/backtesting/results-runtime-config',
            },
          ],
        },
        {
          title: 'Telegram Notifications',
          description:
            'Get real-time signal alerts, execution reports, and error notifications directly in Telegram. Stay informed without watching dashboards.',
          links: [
            {
              label: 'Telegram Setup',
              url: 'https://docs.tradejs.dev/runtime/execution/telegram-notifications',
            },
          ],
        },
      ],
    },
    howItWorks: {
      sectionTitle: 'How It Works',
      sectionSubtitle: 'From strategy idea to live execution in four steps',
      steps: [
        {
          step: '01',
          title: 'Create Strategy',
          description:
            'Write your strategy in TypeScript or Pine Script. Define entry/exit rules, indicators, and risk management.',
        },
        {
          step: '02',
          title: 'Run Grid Backtests',
          description:
            'Configure parameter grids and run thousands of backtests automatically. Analyze results with built-in metrics.',
        },
        {
          step: '03',
          title: 'Promote Best Configs',
          description:
            'Select top-performing parameter sets from backtest results and promote them to runtime configuration.',
        },
        {
          step: '04',
          title: 'Execute & Monitor',
          description:
            'Launch live signal execution with real-time Telegram notifications. Monitor performance and adjust on the fly.',
        },
      ],
    },
    devExperience: {
      sectionTitle: 'Developer Experience',
      sectionSubtitle: 'Dual authoring: write in the language you know best',
      tsTab: 'TypeScript',
      pineTab: 'Pine Script',
    },
    finalCta: {
      title: 'Ready to Automate Your Trading?',
      subtitle:
        'Start building with the TradeJS open-source framework today. Self-hosted and built for developers.',
      quickstart: 'Getting Started',
    },
    footer: {
      description: 'Open-source framework for trading strategy developers.',
      app: 'Application',
      docs: 'Documentation',
      github: 'GitHub Repository',
      rights: 'All rights reserved.',
    },
  },
  ru: {
    nav: {
      advantages: 'Преимущества',
      howItWorks: 'Как это работает',
      devExperience: 'Разработчикам',
      github: 'GitHub',
      quickstart: 'Быстрый старт',
    },
    hero: {
      actionWords: ['ПИШИ', 'ТЕСТИРУЙ', 'ЗАПУСКАЙ'],
      titleSuffix: 'Торговые стратегии',
      subtitle:
        'Open-source фреймворк для торговых стратегий на TypeScript и Pine Script',
      quickstart: 'Быстрый старт',
      trust: {
        backtesting: 'Grid-бэктесты',
        runtime: 'Сигналы в рантайме',
        aiml: 'AI / ML',
        telegram: 'Уведомления в Telegram',
      },
    },
    strategyAuthoring: {
      sectionTitle: 'Создание стратегий',
      sectionSubtitle:
        'Пишите стратегии на удобном языке с полным контролем инфраструктуры',
      items: [
        {
          title: 'Стратегии и индикаторы на TypeScript',
          description:
            'Пишите стратегии и индикаторы на TypeScript с полной типизацией, автодополнением и доступом ко всей экосистеме npm.',
          links: [
            {
              label: 'Написание стратегий',
              url: 'https://docs.tradejs.dev/ru/strategies/authoring/write-strategies',
            },
            {
              label: 'Создание индикаторов',
              url: 'https://docs.tradejs.dev/ru/indicators/authoring',
            },
          ],
        },
        {
          title: 'Совместимость с Pine Script',
          description:
            'Мигрируйте стратегии из TradingView без потерь. TradeJS поддерживает Pine Script наравне с TypeScript.',
          links: [
            {
              label: 'Pine-стратегии',
              url: 'https://docs.tradejs.dev/ru/strategies/authoring/pine-strategy-step-by-step',
            },
            {
              label: 'Pine-индикаторы',
              url: 'https://docs.tradejs.dev/ru/indicators/pine',
            },
          ],
        },
        {
          title: 'Локальный и self-hosted режим',
          description:
            'Запускайте TradeJS локально или на своём сервере. Полный контроль над данными, инфраструктурой и средой исполнения.',
          links: [
            {
              label: 'Локальная установка',
              url: 'https://docs.tradejs.dev/ru/getting-started/quickstart',
            },
            {
              label: 'Self-hosted установка',
              url: 'https://docs.tradejs.dev/ru/operations/production-runbook',
            },
          ],
        },
      ],
    },
    intelligence: {
      sectionTitle: 'Интеллект и бэктестинг',
      sectionSubtitle: 'AI-усиление сигналов и масштабный перебор параметров',
      items: [
        {
          title: 'Grid-бэктесты',
          description:
            'Запускайте массовый перебор параметров через Grid Config. Автоматически находите оптимальные конфигурации среди тысяч комбинаций.',
          links: [
            {
              label: 'Grid Config',
              url: 'https://docs.tradejs.dev/ru/runtime/backtesting/grid-config',
            },
          ],
        },
        {
          title: 'Встроенный AI / ML',
          description:
            'Усиливайте сигналы с помощью AI и ML моделей. Настраиваемые пайплайны для фильтрации, предсказания и оценки рисков.',
          links: [
            {
              label: 'Конфигурация AI',
              url: 'https://docs.tradejs.dev/ru/ai-ml/ai/configuration',
            },
            {
              label: 'Конфигурация ML',
              url: 'https://docs.tradejs.dev/ru/ai-ml/ml/configuration',
            },
          ],
        },
      ],
    },
    execution: {
      sectionTitle: 'Исполнение и мониторинг',
      sectionSubtitle:
        'От результатов бэктестов к живой торговле с уведомлениями в реальном времени',
      items: [
        {
          title: 'Из бэктестов в рантайм',
          description:
            'Переносите лучшие результаты бэктестов прямо в рантайм-конфиг. Без ручной настройки — фреймворк делает всё сам.',
          links: [
            {
              label: 'Результаты в рантайм',
              url: 'https://docs.tradejs.dev/ru/runtime/backtesting/results-runtime-config',
            },
          ],
        },
        {
          title: 'Telegram-уведомления',
          description:
            'Получайте алерты о сигналах, отчёты об исполнении и уведомления об ошибках прямо в Telegram. Будьте в курсе без мониторинга дашбордов.',
          links: [
            {
              label: 'Настройка Telegram',
              url: 'https://docs.tradejs.dev/ru/runtime/execution/telegram-notifications',
            },
          ],
        },
      ],
    },
    howItWorks: {
      sectionTitle: 'Как это работает',
      sectionSubtitle: 'От идеи стратегии до исполнения — четыре шага',
      steps: [
        {
          step: '01',
          title: 'Создайте стратегию',
          description:
            'Напишите стратегию на TypeScript или Pine Script. Определите правила входа/выхода, индикаторы и управление рисками.',
        },
        {
          step: '02',
          title: 'Запустите Grid-бэктесты',
          description:
            'Настройте сетку параметров и запустите тысячи бэктестов автоматически. Анализируйте результаты встроенными метриками.',
        },
        {
          step: '03',
          title: 'Перенесите лучшие конфиги',
          description:
            'Выберите лучшие наборы параметров из результатов бэктестов и перенесите их в рантайм-конфигурацию.',
        },
        {
          step: '04',
          title: 'Запуск и мониторинг',
          description:
            'Запустите исполнение сигналов в реальном времени с Telegram-уведомлениями. Контролируйте и корректируйте на лету.',
        },
      ],
    },
    devExperience: {
      sectionTitle: 'Опыт разработчика',
      sectionSubtitle:
        'Два режима разработки: пишите на языке, который знаете лучше',
      tsTab: 'TypeScript',
      pineTab: 'Pine Script',
    },
    finalCta: {
      title: 'Готовы автоматизировать трейдинг?',
      subtitle:
        'Начните работать с open-source фреймворком TradeJS уже сегодня. Self-hosted и создан для разработчиков.',
      quickstart: 'Быстрый старт',
    },
    footer: {
      description: 'Open-source фреймворк для разработчиков торговых стратегий.',
      app: 'Приложение',
      docs: 'Документация',
      github: 'GitHub-репозиторий',
      rights: 'Все права защищены.',
    },
  },
} as const;

export type Translations = (typeof translations)[Locale];
