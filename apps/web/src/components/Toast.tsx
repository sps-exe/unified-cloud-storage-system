import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, X, ShieldAlert } from './icons';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev.slice(-3), { id, type, message }]);

    setTimeout(() => {
      removeToast(id);
    }, 3600);
  }, [removeToast]);

  const success = useCallback((message: string) => showToast(message, 'success'), [showToast]);
  const error = useCallback((message: string) => showToast(message, 'error'), [showToast]);
  const info = useCallback((message: string) => showToast(message, 'info'), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, success, error, info }}>
      {children}
      {/* Toast Notification Container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg border text-xs shadow-md transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 ${
              toast.type === 'success'
                ? 'bg-zinc-900 border-emerald-500/40 text-zinc-100'
                : toast.type === 'error'
                ? 'bg-zinc-900 border-rose-500/40 text-zinc-100'
                : 'bg-zinc-900 border-zinc-700 text-zinc-100'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {toast.type === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />}
              {toast.type === 'error' && <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />}
              {toast.type === 'info' && <ShieldAlert className="h-4 w-4 text-zinc-400 shrink-0" />}
              <span className="font-medium text-zinc-200 truncate">{toast.message}</span>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-zinc-500 hover:text-zinc-200 p-0.5 rounded transition shrink-0"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
