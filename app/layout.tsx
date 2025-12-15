import './globals.css';
import type { ReactNode } from 'react';
import Header from '@/components/Header';
import { LanguageProvider } from '@/components/LanguageProvider';
import AuthSessionProvider from '@/components/AuthSessionProvider';

export const metadata = {
  title: 'Blockchain Risk Score',
  description:
    'Система анализа транзакций в блокчейне с присвоением risk score',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-slate-950 text-slate-100">
        <AuthSessionProvider>
          <LanguageProvider>
            <Header />
            <main className="max-w-6xl mx-auto px-4 py-6">
              {children}
            </main>
          </LanguageProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
