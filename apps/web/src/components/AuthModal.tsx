import React, { useEffect, useState } from 'react';
import { Database, Lock, Mail, ArrowRight, Check, AlertCircle } from './icons';
import { api } from '../lib/api';

interface AuthModalProps {
  onSuccess: () => void;
  registrationOpen?: boolean;
  firstRun?: boolean;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onSuccess, registrationOpen = true, firstRun = false }) => {
  // A brand-new install has no users, so start on "create your account".
  const [isRegister, setIsRegister] = useState(firstRun);
  useEffect(() => {
    if (firstRun) setIsRegister(true); // config usually arrives after first paint
  }, [firstRun]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live password validation rules
  const hasLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const isPasswordValid = hasLength && hasUpper && hasLower && hasNumber && hasSpecial;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRegister && !isPasswordValid) {
      setError('Please satisfy all password requirements');
      return;
    }

    setLoading(true);
    setError(null);

    const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
    const payload = isRegister
      ? { email: email.trim(), password, displayName: displayName.trim() || undefined }
      : { email: email.trim(), password };

    try {
      const res = await api.request<{ accessToken: string; refreshToken?: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res.ok && res.data.accessToken) {
        api.setToken(res.data.accessToken);
        if (res.data.refreshToken) {
          api.setRefreshToken(res.data.refreshToken);
        }
        onSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-md shadow-2xl overflow-hidden p-8">
        {/* Logo & Header */}
        <div className="text-center mb-6">
          <div className="h-10 w-10 rounded-lg bg-zinc-800 border border-zinc-700/80 flex items-center justify-center mx-auto mb-3 text-zinc-200">
            <Database className="h-5 w-5" />
          </div>
          <h1 className="text-base font-semibold text-zinc-100 tracking-tight">
            Unified Cloud Storage System
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            {firstRun
              ? 'Welcome! Create the first account to set up your storage pool.'
              : 'Pool all your Google Drive accounts into one storage space.'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-md text-xs text-rose-400 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {isRegister && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Display Name (Optional)</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 font-mono"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full pl-8 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Password</label>
            <div className="relative">
              <Lock className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-8 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 font-mono"
              />
            </div>

            {/* Live Password Strength Criteria Checklist */}
            {isRegister && (
              <div className="mt-2.5 p-2.5 bg-zinc-950 rounded-lg border border-zinc-800 space-y-1.5">
                <p className="text-[11px] font-mono text-zinc-400 mb-1">Password Requirements:</p>
                <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                  <div className={`flex items-center gap-1.5 ${hasLength ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    <span className={`h-3 w-3 rounded-full flex items-center justify-center text-[9px] ${hasLength ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-600'}`}>
                      {hasLength ? <Check className="h-2.5 w-2.5" /> : '•'}
                    </span>
                    <span>8+ characters</span>
                  </div>

                  <div className={`flex items-center gap-1.5 ${hasUpper ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    <span className={`h-3 w-3 rounded-full flex items-center justify-center text-[9px] ${hasUpper ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-600'}`}>
                      {hasUpper ? <Check className="h-2.5 w-2.5" /> : '•'}
                    </span>
                    <span>Uppercase (A-Z)</span>
                  </div>

                  <div className={`flex items-center gap-1.5 ${hasLower ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    <span className={`h-3 w-3 rounded-full flex items-center justify-center text-[9px] ${hasLower ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-600'}`}>
                      {hasLower ? <Check className="h-2.5 w-2.5" /> : '•'}
                    </span>
                    <span>Lowercase (a-z)</span>
                  </div>

                  <div className={`flex items-center gap-1.5 ${hasNumber ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    <span className={`h-3 w-3 rounded-full flex items-center justify-center text-[9px] ${hasNumber ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-600'}`}>
                      {hasNumber ? <Check className="h-2.5 w-2.5" /> : '•'}
                    </span>
                    <span>Number (0-9)</span>
                  </div>

                  <div className={`col-span-2 flex items-center gap-1.5 ${hasSpecial ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    <span className={`h-3 w-3 rounded-full flex items-center justify-center text-[9px] ${hasSpecial ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-600'}`}>
                      {hasSpecial ? <Check className="h-2.5 w-2.5" /> : '•'}
                    </span>
                    <span>Special character (!@#$%^&*...)</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || (isRegister && !isPasswordValid)}
            className="w-full py-2 rounded-md bg-zinc-100 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-medium text-xs transition flex items-center justify-center gap-2 mt-2"
          >
            {loading ? (
              <span className="h-3.5 w-3.5 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin" />
            ) : (
              <>
                <span>{isRegister ? 'Create Account' : 'Sign In'}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </form>

        {/* Switch Auth Mode */}
        <div className="mt-4 pt-4 border-t border-zinc-800/80 flex items-center justify-center text-xs">
          {!registrationOpen && !isRegister ? (
            <span className="text-zinc-500 font-mono">Sign-ups are closed on this server</span>
          ) : (
          <button
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
            }}
            className="text-zinc-400 hover:text-zinc-200 font-mono transition"
          >
            {isRegister ? 'Already registered? Sign In' : "Don't have an account? Sign Up"}
          </button>
          )}
        </div>
      </div>
    </div>
  );
};
