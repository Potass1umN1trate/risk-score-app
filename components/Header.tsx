'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from './LanguageProvider';

export default function Header() {
  const pathname = usePathname();
  const { locale, setLocale, t } = useLanguage();

  const navItems = [
    { href: '/', label: t.nav.home },
    { href: '/analysis', label: t.nav.analysis },
    { href: '/dashboard', label: t.nav.dashboard },
  ];

  return (
    <header className="border-b border-slate-800">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="font-semibold text-lg">
          RiskScore<span className="text-emerald-400">.app</span>
        </Link>

        <nav className="flex gap-4">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  'text-sm ' +
                  (active
                    ? 'text-emerald-400 font-medium'
                    : 'text-slate-300 hover:text-white')
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex gap-2 items-center">
          {/* Переключатель RU/EN */}
          <button
            type="button"
            onClick={() => setLocale(locale === 'ru' ? 'en' : 'ru')}
            className="text-xs border border-slate-600 rounded-full px-3 py-1 text-slate-200 hover:bg-slate-800"
          >
            {locale === 'ru' ? 'EN' : 'RU'}
          </button>

          <Link
            href="/login"
            className="text-sm text-slate-300 hover:text-white"
          >
            {t.auth.login}
          </Link>
          <Link
            href="/register"
            className="text-sm bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3 py-1 rounded-md font-medium"
          >
            {t.auth.register}
          </Link>
        </div>
      </div>
    </header>
  );
}
