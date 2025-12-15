'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLanguage } from './LanguageProvider';
import type { UserRole } from '@/lib/types';

type MeUser = {
  userId: number;
  email: string;
  role: UserRole;
};

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, setLocale, t } = useLanguage();

  const [user, setUser] = useState<MeUser | null | undefined>(undefined);
  const [loadingMe, setLoadingMe] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadMe() {
      try {
        const res = await fetch('/api/auth/me', {
          method: 'GET',
        });

        if (!res.ok) {
          if (!cancelled) setUser(null);
          return;
        }

        const data = await res.json();
        if (!cancelled) {
          setUser(data.user ?? null);
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoadingMe(false);
      }
    }

    loadMe();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // пофиг, просто считаем, что разлогинились
    } finally {
      setUser(null);
      router.push('/');
      router.refresh();
    }
  }

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

          {/* Пока не знаем юзера — просто моргаем пустым местом */}
          {loadingMe ? null : user ? (
            <>
              <div className="flex flex-col items-end mr-2">
                <span className="text-xs text-slate-200">
                  {user.email}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-emerald-400">
                  {user.role}
                </span>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="text-xs border border-slate-600 rounded-md px-3 py-1 text-slate-200 hover:bg-slate-800"
              >
                {t.auth.logout ?? 'Logout'}
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </header>
  );
}
