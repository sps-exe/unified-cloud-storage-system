import React, { useState } from 'react';
import { Database, Lock, Mail, ArrowRight, Check, AlertCircle } from './icons';
import { api } from '../lib/api';

interface AuthModalProps {
  onSuccess: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onSuccess }) => {
  const [isRegister, setIsRegister] = useState(false);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden p-8">
        {/* Logo & Header */}
        <div className="text-center mb-6">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 mx-auto mb-3">
            <Database className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            Unified Cloud Storage System
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Aggregated multi-account Google Drive file manager with PostgreSQL
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {isRegister && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Display Name (Optional)</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Shaurya Pratap Singh"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Live Password Strength Criteria Checklist */}
            {isRegister && (
              <div className="mt-2.5 p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/80 space-y-1.5">
                <p className="text-[11px] font-medium text-slate-400 mb-1">Password Requirements:</p>
                <div className="grid grid-cols-2 gap-1 text-[11px]">
                  <div className={`flex items-center gap-1.5 ${hasLength ? 'text-emerald-400' : 'text-slate-500'}`}>
                    <span className={`h-3 w-3 rounded-full flex items-center justify-center text-[9px] ${hasLength ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-600'}`}>
                      {hasLength ? <Check className="h-2.5 w-2.5" /> : '•'}
                    </span>
                    <span>8+ characters</span>
                  </div>

                  <div className={`flex items-center gap-1.5 ${hasUpper ? 'text-emerald-400' : 'text-slate-500'}`}>
                    <span className={`h-3 w-3 rounded-full flex items-center justify-center text-[9px] ${hasUpper ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-600'}`}>
                      {hasUpper ? <Check className="h-2.5 w-2.5" /> : '•'}
                    </span>
                    <span>Uppercase (A-Z)</span>
                  </div>

                  <div className={`flex items-center gap-1.5 ${hasLower ? 'text-emerald-400' : 'text-slate-500'}`}>
                    <span className={`h-3 w-3 rounded-full flex items-center justify-center text-[9px] ${hasLower ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-600'}`}>
                      {hasLower ? <Check className="h-2.5 w-2.5" /> : '•'}
                    </span>
                    <span>Lowercase (a-z)</span>
                  </div>

                  <div className={`flex items-center gap-1.5 ${hasNumber ? 'text-emerald-400' : 'text-slate-500'}`}>
                    <span className={`h-3 w-3 rounded-full flex items-center justify-center text-[9px] ${hasNumber ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-600'}`}>
                      {hasNumber ? <Check className="h-2.5 w-2.5" /> : '•'}
                    </span>
                    <span>Number (0-9)</span>
                  </div>

                  <div className={`col-span-2 flex items-center gap-1.5 ${hasSpecial ? 'text-emerald-400' : 'text-slate-500'}`}>
                    <span className={`h-3 w-3 rounded-full flex items-center justify-center text-[9px] ${hasSpecial ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-600'}`}>
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
            className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm shadow-lg shadow-indigo-600/20 transition flex items-center justify-center gap-2 mt-2"
          >
            {loading ? (
              <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>{isRegister ? 'Create Account' : 'Sign In'}</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        {/* Switch Auth Mode */}
        <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center justify-center text-xs">
          <button
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
            }}
            className="text-indigo-400 hover:text-indigo-300 font-medium transition"
          >
            {isRegister ? 'Already registered? Sign In' : "Don't have an account? Sign Up"}
          </button>
        </div>
      </div>
    </div>
  );
};
