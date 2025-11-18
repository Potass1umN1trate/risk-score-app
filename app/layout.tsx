// app/layout.tsx
import './globals.css';
import type { ReactNode } from 'react';
import Header from '@/components/Header';

export const metadata = {
  title: 'Blockchain Risk Score',
  description: 'Система анализа транзакций в блокчейне с присвоением risk score',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-slate-950 text-slate-100">
        {/* Общая шапка сайта (логотип + меню) */}
        <Header />

        {/* Контент конкретной страницы */}
        <main className="max-w-6xl mx-auto px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
