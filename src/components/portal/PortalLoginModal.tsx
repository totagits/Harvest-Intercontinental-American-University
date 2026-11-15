import React, { useState } from 'react';
import { setSessionCsrf } from '../../services/session';
import type { UserProfile } from '../../types';

export function PortalLoginModal({
  isOpen,
  onClose,
  onLoginSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: UserProfile, token: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [token] = useState(() => {
    const value = new URLSearchParams(location.search).has('activate')
      ? location.hash.slice(1)
      : '';
    if (value)
      history.replaceState(null, '', location.pathname + '?activate=1');
    return value;
  });
  const [activation, setActivation] = useState(!!token);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#1A071E]/75 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="hiau-login-title" className="w-full max-w-[490px] overflow-hidden rounded-xl border-2 border-[#C39A53] bg-white text-[#2A082C] shadow-2xl">
        <div className="h-2 bg-[#C39A53]" />
        <div className="p-6 sm:p-9">
        <div className="text-xs font-black tracking-[0.16em] uppercase text-[#8C662B]">HARVEST INTERCONTINENTAL AMERICAN UNIVERSITY</div>
        <h2 id="hiau-login-title" className="my-5 font-black text-3xl uppercase tracking-tight text-[#4A1249] sm:text-4xl">
          {activation ? 'Activate your account' : 'Welcome back.'}
        </h2>
        <p className="text-sm leading-6 text-slate-700">
          {activation
            ? 'Choose a private password of at least 12 characters. This activation link can only be used once.'
            : 'Sign in with your university account. Your access is determined by your assigned role.'}
        </p>
        <form
          className="mt-6 grid grid-cols-1 gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage('');
            try {
              if (activation && password !== confirm)
                throw Error('Passwords do not match.');
              const authPath=activation ? '/api/auth/activate' : '/api/auth/login';
              const authUrl=new URL(authPath,window.location.origin).toString();
              const response = await fetch(authUrl,{
                method:'POST',
                credentials:'same-origin',
                cache:'no-store',
                headers:{'Content-Type':'application/json','Accept':'application/json'},
                body:JSON.stringify(activation?{token,password}:{email,password}),
              });
              const contentType=response.headers.get('content-type')||'';
              const data=contentType.includes('application/json')
                ? await response.json()
                : null;
              if(!data)throw Error('The university authentication service returned an invalid response. Refresh the Staff App and try again.');
              if(!response.ok)throw Error(data.error||'Unable to sign in.');
              if (activation) {
                // Activation is complete. Remove its marker so refresh or a
                // copied address cannot reopen a stale password-setup flow.
                const cleanUrl = new URL(window.location.href);
                cleanUrl.searchParams.delete('activate');
                window.history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search);
                setActivation(false);
                setPassword('');
                setConfirm('');
                setMessage(
                  'Account activated. Sign in with your email and new password.',
                );
              } else {
                setSessionCsrf(data.csrf);
                onLoginSuccess(data.user, '');
                setPassword('');
              }
            } catch (e) {
              setMessage(e instanceof Error ? e.message : 'Unable to sign in.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {!activation && (
            <label className="grid gap-2 text-sm font-semibold text-[#4A1249]">
              University email
              <input
                type="email"
                className="w-full rounded-md border border-slate-400 bg-white p-3 text-slate-900 outline-none focus:border-[#4A1249] focus:ring-2 focus:ring-[#C39A53]"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
          )}
          <label className="grid gap-2 text-sm font-semibold text-[#4A1249]">
            {activation ? 'Choose password' : 'Password'}
            <input
              type="password"
              className="w-full rounded-md border border-slate-400 bg-white p-3 text-slate-900 outline-none focus:border-[#4A1249] focus:ring-2 focus:ring-[#C39A53]"
              autoComplete={activation ? 'new-password' : 'current-password'}
              minLength={activation ? 12 : undefined}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {activation && (
            <label className="grid gap-2 text-sm font-semibold text-[#4A1249]">
              Confirm password
              <input
                type="password"
              className="w-full rounded-md border border-slate-400 bg-white p-3 text-slate-900 outline-none focus:border-[#4A1249] focus:ring-2 focus:ring-[#C39A53]"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </label>
          )}
          <button type="submit" className="hiau-dashboard-selected mt-1 rounded-md hiau-brand-action border border-[#C39A53] bg-[#4A1249] px-5 py-3 font-bold text-white transition-colors hover:bg-[#661B69] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C39A53] disabled:opacity-50" disabled={busy}>
            {busy
              ? 'Please wait…'
              : activation
                ? 'Activate account'
                : 'Sign in'}
          </button>
          <p role="status" aria-live="polite" className="text-sm text-[#4A1249]">
            {message}
          </p>
        </form>
        <div className="mt-3 flex flex-wrap gap-3">
        {!activation && <button type="button" className="rounded-md border border-[#C39A53] bg-[#FFF9ED] px-4 py-2.5 text-sm font-semibold text-[#4A1249] hover:bg-[#FBE9C7] disabled:opacity-50" disabled={busy} onClick={async()=>{
          if(!email.trim()){setMessage('Enter your university email above first.');return;}
          setBusy(true);
          try{const response=await fetch(new URL('/api/auth/forgot-password',window.location.origin).toString(),{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({email})});const contentType=response.headers.get('content-type')||'';const result=contentType.includes('application/json')?await response.json():null;if(!result)throw Error('The university authentication service returned an invalid response. Refresh the Staff App and try again.');if(!response.ok)throw Error(result.error);setMessage('If your account can receive recovery email, a private link will be sent. Otherwise contact the university administrator.');}catch(error){setMessage(error instanceof Error?error.message:'Could not request account recovery.');}finally{setBusy(false);}
        }}>Request password recovery</button>}
        <button type="button" className="rounded-md border border-[#4A1249] px-4 py-2.5 text-sm font-semibold text-[#4A1249] hover:bg-purple-50" onClick={onClose}>
          Back to university website
        </button>
        </div>
        <p className="mt-6 text-xs leading-5 text-slate-600">
          Need access or a password reset? Contact the university administrator.
        </p>
        </div>
      </section>
    </div>
  );
}
