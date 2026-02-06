'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/components/LanguageProvider';
import Link from 'next/link';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  const { t } = useLanguage();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [loadingEmail, setLoadingEmail] = useState(false);
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoadingEmail(true);

    try {
      const res = await signIn('credentials', {
        redirect: false,
        email: email.trim().toLowerCase(),
        password,
      });

      if (res?.error) {
        setError(res.error || 'Login failed');
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } finally {
      setLoadingEmail(false);
    }
  }

  async function handleMetaMaskLogin() {
    setError(null);
    setLoadingWallet(true);

    try {
      const ethereum = (window as any)?.ethereum;
      if (!ethereum) throw new Error('MetaMask not found. Please install MetaMask extension.');

      // 1) Get nonce (server sets httpOnly cookie mm_nonce)
      const nonceRes = await fetch('/api/auth/metamask/nonce', { method: 'GET' });
      if (!nonceRes.ok) throw new Error('Failed to get nonce (server error)');
      const { nonce } = await nonceRes.json();
      if (!nonce) throw new Error('Nonce is empty (server bug)');

      // 2) Connect and get accounts
      const accounts: string[] = await ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts?.[0];
      if (!address) throw new Error('MetaMask did not return an address');

      // 3) Create message (must match authorize() parser on server)
      const domain = window.location.host;
      const message =
        `Risk Score Crypto App Login\n` +
        `Domain: ${domain}\n` +
        `Address: ${address}\n` +
        `Nonce: ${nonce}\n` +
        `Issued At: ${new Date().toISOString()}`;

      // 4) Request signature from user
      const signature: string = await ethereum.request({
        method: 'personal_sign',
        params: [message, address],
      });

      if (!signature) throw new Error('Failed to get signature from MetaMask');

      // 5) Call signIn - do NOT pass address, only message + signature
      const res = await signIn('metamask', {
        redirect: false,
        message,
        signature,
      });

      if (res?.error) {
        setError(res.error);
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'MetaMask sign-in failed');
    } finally {
      setLoadingWallet(false);
    }
  }

  const disabledAll = loadingEmail || loadingWallet;

  return (
    <section className="max-w-md mx-auto mt-12">
      <h1 className="text-2xl font-semibold mb-4">{t.auth.login}</h1>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 bg-slate-900 border border-slate-800 p-4 rounded-xl"
      >
        <div>
          <label className="block text-sm mb-1">{t.auth.emailLabel}</label>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={disabledAll}
            className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm disabled:opacity-60"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">{t.auth.passwordLabel}</label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={disabledAll}
            className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm disabled:opacity-60"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={disabledAll}
          className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 px-4 py-2 rounded-md text-sm font-medium"
        >
          {loadingEmail ? '…' : t.auth.login}
        </button>

        <div className="pt-2 space-y-2">
          <button
            type="button"
            disabled={disabledAll}
            onClick={() => signIn('github', { callbackUrl: '/dashboard' })}
            className="w-full border border-slate-700 rounded-md px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
          >
            Sign in with GitHub
          </button>

          <button
            type="button"
            disabled={disabledAll}
            onClick={handleMetaMaskLogin}
            className="w-full border border-slate-700 rounded-md px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
          >
            {loadingWallet ? 'Connecting…' : 'Sign in with MetaMask'}
          </button>
        </div>

        <p className="text-xs text-slate-400 pt-2">
          Нет аккаунта?{' '}
          <Link href="/register" className="text-emerald-400 hover:underline">
            {t.auth.register}
          </Link>
        </p>
      </form>
    </section>
  );
}
