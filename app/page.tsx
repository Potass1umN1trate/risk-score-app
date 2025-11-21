'use client';

import { useLanguage } from '@/components/LanguageProvider';

export default function HomePage() {
  const { t } = useLanguage();

  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-bold">
        {t.homePage.title}
      </h1>

      <p className="text-slate-300 max-w-2xl">
        {t.homePage.description}
      </p>

      {/* Тут можешь оставить буллиты, как раньше, либо тоже утащить их в словарь */}
    </section>
  );
}
