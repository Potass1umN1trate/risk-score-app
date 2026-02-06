'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';

export type Locale = 'ru' | 'en';

type TranslationSchema = {
  nav: {
    home: string;
    analysis: string;
    dashboard: string;
  };
  auth: {
    login: string;
    register: string;
    emailLabel: string;
    passwordLabel: string;
    logout: string;
  };
  analysisPage: {
    title: string;
  };
  homePage: {
    title: string;
    description: string;
  };
  analysisForm: {
    addressLabel: string;
    addressPlaceholder: string;
    blockchainLabel: string;
    depthLabel: string;
    submit: string;
    submitLoading: string;
  };
  riskSummary: {
    title: string;
    levelLow: string;
    levelMedium: string;
    levelHigh: string;
    address: string;
    blockchain: string;
    depth: string;
    performedAt: string;
  };
  activityStats: {
    title: string;
    totalTx: string;
    smallTxShare: string;
    peakDayTx: string;
  };
  graph: {
    title: string;
    legend: string;
  };
  meta: {
    partialAnalysis: string; // 🆕
  };
  dashboard: {
    title: string;
    historyTab: string;
    badTab: string;
    adminTab: string;
    historyTitle: string;
    historyEmpty: string;
    badAddTitle: string;
    badAddBtn: string;
    badListTitle: string;
    badEmpty: string;
    exportCsv: string;
    adminUsersTitle: string;
  };
  common: {
    saving: string;
  };
};

const translations: Record<Locale, TranslationSchema> = {
  ru: {
    nav: {
      home: 'Главная',
      analysis: 'Анализ кошелька',
      dashboard: 'Личный кабинет',
    },
    auth: {
      login: 'Войти',
      register: 'Регистрация',
      emailLabel: 'Email',
      passwordLabel: 'Пароль',
      logout: 'Выйти'
    },
    analysisPage: {
      title: 'Анализ криптовалютного кошелька',
    },
    homePage: {
      title:
        'Система анализа транзакций в блокчейне с присвоением risk score',
      description:
        'Введите адрес криптовалютного кошелька, выберите блокчейн и период анализа. ' +
        'Система соберёт транзакции, построит граф связей и присвоит итоговый уровень риска.',
    },
    analysisForm: {
      addressLabel: 'Адрес кошелька',
      addressPlaceholder: 'Например, 0x1234... или bc1q...',
      blockchainLabel: 'Blockchain',
      // Text only, keep key name same (depthLabel)
      depthLabel: 'Analysis depth (number of hops)',
      submit: 'Запустить анализ',
      submitLoading: 'Анализируем…',
    },
    riskSummary: {
      title: 'Итоговый risk score',
      levelLow: 'Низкий риск',
      levelMedium: 'Средний риск',
      levelHigh: 'Высокий риск',
      address: 'Адрес',
      blockchain: 'Blockchain',
      // Also about analysis depth
      depth: 'Analysis depth',
      performedAt: 'Анализ выполнен',
    },
    activityStats: {
      title: 'Транзакционная активность',
      totalTx: 'Всего транзакций',
      smallTxShare: 'Доля мелких переводов',
      peakDayTx: 'Максимум транзакций за день',
    },
    graph: {
      title: 'Граф связей',
      legend:
        'Клик по вершине запускает анализ этого адреса. Цвет узла показывает уровень риска (от зелёного к красному), число в скобках — risk score.',
    },
    meta: {
      partialAnalysis:
        'Анализ выполнен частично: не удалось получить данные по части адресов.',
    },
    dashboard: {
      title: 'Личный кабинет',
      historyTab: 'История анализов',
      badTab: 'Плохие адреса',
      adminTab: 'Пользователи и роли',
      historyTitle: 'Ваши последние анализы',
      historyEmpty:
        'История пуста. Запустите анализ на странице «Анализ кошелька».',
      badAddTitle: 'Добавить плохой адрес',
      badAddBtn: 'Добавить адрес',
      badListTitle: 'База плохих адресов',
      badEmpty: 'Пока нет ни одного плохого адреса.',
      exportCsv: 'Экспорт CSV',
      adminUsersTitle: 'Пользователи и роли',
    },
    common: {
      saving: 'Сохраняем…',
    },
  },
  en: {
    nav: {
      home: 'Home',
      analysis: 'Wallet analysis',
      dashboard: 'Dashboard',
    },
    auth: {
      login: 'Sign in',
      register: 'Sign up',
      emailLabel: 'Email',
      passwordLabel: 'Password',
      logout: 'Logout'
    },
    analysisPage: {
      title: 'Crypto wallet analysis',
    },
    homePage: {
      title:
        'Blockchain transaction analysis system with risk score',
      description:
        'Enter a crypto wallet address, select the blockchain and analysis period. ' +
        'The system will collect transactions, build a relation graph and compute the final risk level.',
    },
    analysisForm: {
      addressLabel: 'Wallet address',
      addressPlaceholder: 'For example, 0x1234... or bc1q...',
      blockchainLabel: 'Blockchain',
      depthLabel: 'Analysis depth (hops)', // 👈
      submit: 'Run analysis',
      submitLoading: 'Analyzing…',
    },
    riskSummary: {
      title: 'Final risk score',
      levelLow: 'Low risk',
      levelMedium: 'Medium risk',
      levelHigh: 'High risk',
      address: 'Address',
      blockchain: 'Blockchain',
      depth: 'Analysis depth', // 👈
      performedAt: 'Analysis time',
    },
    activityStats: {
      title: 'Transaction activity',
      totalTx: 'Total transactions',
      smallTxShare: 'Share of small transfers',
      peakDayTx: 'Max transactions per day',
    },
    graph: {
      title: 'Relations graph',
      legend:
        'Click a node to analyze that address. Node color encodes risk (green → red), number in brackets is node risk score.',
    },

    meta: {
      partialAnalysis:
        'Analysis was partially completed: failed to retrieve data for some addresses.',
    },

    dashboard: {
      title: 'Personal cabinet',
      historyTab: 'History',
      badTab: 'Bad addresses',
      adminTab: 'Users & roles',
      historyTitle: 'Your recent analyses',
      historyEmpty:
        'No analyses yet. Run one on the “Wallet analysis” page.',
      badAddTitle: 'Add bad address',
      badAddBtn: 'Add address',
      badListTitle: 'Bad address database',
      badEmpty: 'No bad addresses yet.',
      exportCsv: 'Export CSV',
      adminUsersTitle: 'Users & roles',
    },
    common: {
      saving: 'Saving…',
    },
  },
};


type Dictionary = (typeof translations)['ru'];

interface LanguageContextValue {
  locale: Locale;
  t: Dictionary;
  setLocale: (locale: Locale) => void;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(
  undefined,
);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('ru');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('locale') as Locale | null;
      if (stored === 'ru' || stored === 'en') {
        setLocale(stored);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('locale', locale);
    } catch {
      // ignore
    }
  }, [locale]);

  const value: LanguageContextValue = {
    locale,
    t: translations[locale],
    setLocale,
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return ctx;
}
