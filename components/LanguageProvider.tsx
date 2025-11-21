'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';

export type Locale = 'ru' | 'en';

const translations: Record<
  Locale,
  {
    nav: {
      home: string;
      analysis: string;
      dashboard: string;
    };
    auth: {
      login: string;
      register: string;
    };
    analysisPage: {
      title: string;
    };
    homePage: {
      title: string;
      description: string;
    };
  }
> = {
  ru: {
    nav: {
      home: 'Главная',
      analysis: 'Анализ кошелька',
      dashboard: 'Личный кабинет',
    },
    auth: {
      login: 'Войти',
      register: 'Регистрация',
    },
    analysisPage: {
      title: 'Анализ криптовалютного кошелька',
    },
    homePage: {
      title:
        'Система анализа транзакций в блокчейне с присвоением risk score',
      description:
        'Введите адрес криптовалютного кошелька, выберите блокчейн и глубину анализа. ' +
        'Система соберёт транзакции, построит граф связей и присвоит итоговый уровень риска.',
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
    },
    analysisPage: {
      title: 'Crypto wallet analysis',
    },
    homePage: {
      title:
        'Blockchain transaction analysis system with risk score',
      description:
        'Enter a crypto wallet address, select the blockchain and analysis depth. ' +
        'The system will collect transactions, build a graph of relations and compute the final risk level.',
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

  // Читаем язык из localStorage при первом рендере на клиенте
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('locale') as Locale | null;
      if (stored === 'ru' || stored === 'en') {
        setLocale(stored);
      }
    } catch {
      // если localStorage недоступен — просто игнорируем
    }
  }, []);

  // Сохраняем язык при изменении
  useEffect(() => {
    try {
      window.localStorage.setItem('locale', locale);
    } catch {
      // игнорируем
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
