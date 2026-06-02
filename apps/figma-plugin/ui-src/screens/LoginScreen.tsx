import { useState, type FormEvent } from 'react';
import { RiLoader4Line } from '@remixicon/react';

export type LoginState =
  | { step: 'idle' }
  | { step: 'loading' }
  | { step: 'email_sent'; email: string }
  | { step: 'google_pending' }
  | { step: 'error'; message: string };

type LoginScreenProps = {
  onMagicLink: (email: string) => void;
  onGoogle: () => void;
  state: LoginState;
};

export function LoginScreen({ onMagicLink, onGoogle, state }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const busy = state.step === 'loading' || state.step === 'google_pending';

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    onMagicLink(email.trim());
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div className="flex w-[320px] flex-col items-center rounded-2xl bg-white px-6 py-7 shadow-xl">

        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-black">
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden>
            <path d="M16 8C11.58 8 8 11.58 8 16s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 10.5c-2.67 0-5.02-1.37-6.4-3.44.03-2.12 4.27-3.29 6.4-3.29s6.36 1.17 6.4 3.29A7.48 7.48 0 0 1 16 21.5z" fill="#fff"/>
          </svg>
        </div>

        <h1 className="mb-5 text-center text-[17px] font-semibold leading-snug text-gray-900">
          Create an account<br />or sign in
        </h1>

        {state.step === 'email_sent' ? (
          <div className="flex flex-col items-center gap-2 text-center py-2">
            <span className="text-3xl">✉️</span>
            <p className="text-sm font-semibold text-gray-900">Check your email</p>
            <p className="text-xs text-gray-500 leading-relaxed">
              We sent a link to<br />
              <span className="font-medium text-gray-800">{state.email}</span>
            </p>
            <p className="text-[11px] text-gray-400 mt-1">Click it to sign in, then come back.</p>
          </div>
        ) : state.step === 'google_pending' ? (
          <div className="flex flex-col items-center gap-2 text-center py-2">
            <RiLoader4Line size={28} className="animate-spin text-gray-400" />
            <p className="text-sm font-semibold text-gray-900">Waiting for Google…</p>
            <p className="text-xs text-gray-500">Complete sign-in in the browser tab.</p>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="flex w-full flex-col gap-2">
              <label htmlFor="login-email" className="text-xs font-medium text-gray-500">
                Email
              </label>
              <input
                id="login-email"
                type="text"
                inputMode="email"
                autoComplete="email"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-gray-900 disabled:opacity-50"
                placeholder="Enter email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                autoFocus
              />
              <button
                type="submit"
                disabled={busy || !email.trim()}
                className="mt-0.5 flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {state.step === 'loading'
                  ? <RiLoader4Line size={15} className="animate-spin" />
                  : 'Continue'}
              </button>
            </form>

            <div className="my-3.5 flex w-full items-center gap-2.5 text-[11px] text-gray-400">
              <span className="flex-1 border-t border-gray-200" />
              or
              <span className="flex-1 border-t border-gray-200" />
            </div>

            <button
              type="button"
              onClick={onGoogle}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-800 transition hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GoogleIcon />
              Continue with Google
            </button>

            {state.step === 'error' && (
              <p className="mt-3 w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs text-red-700">
                {state.message}
              </p>
            )}

            <p className="mt-4 text-center text-[10px] leading-relaxed text-gray-400">
              By continuing you agree to our{' '}
              <a className="underline" href="https://insta2figma.app/terms" target="_blank" rel="noopener noreferrer">Terms</a>
              {' '}&{' '}
              <a className="underline" href="https://insta2figma.app/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"/>
    </svg>
  );
}
