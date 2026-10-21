import React, { useState } from 'react';
import { X, HardDrive, RefreshCw, Plus, Trash2, CheckCircle2 } from './icons';
import { api, formatBytes } from '../lib/api';
import type { DriveAccountDto } from '@ucss/shared';

interface AccountsModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: DriveAccountDto[];
  onRefresh: () => void;
}

export const AccountsModal: React.FC<AccountsModalProps> = ({
  isOpen,
  onClose,
  accounts,
  onRefresh,
}) => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSyncAccount = async (accountId: string) => {
    setLoading(true);
    try {
      await api.request(`/api/accounts/${accountId}/sync`, { method: 'POST' });
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async (accountId: string, email: string) => {
    if (!confirm(`Are you sure you want to disconnect ${email}? Files will remain preserved in Google Drive.`)) {
      return;
    }
    setLoading(true);
    try {
      await api.request(`/api/accounts/${accountId}`, { method: 'DELETE' });
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setLoading(false);
    }
  };

  const handleConnectLive = async () => {
    setLoading(true);
    try {
      const res = await api.request<{ authUrl?: string; url?: string }>('/api/oauth/google/connect');
      const targetUrl = res.data?.authUrl || res.data?.url;
      if (targetUrl) {
        window.location.href = targetUrl;
      } else {
        alert('Could not retrieve Google authorization URL. Please try again.');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to generate OAuth URL');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-indigo-400" />
              <span>Connected Google Drive Accounts</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                {accounts.length} Active
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Each connected account contributes its available Google Drive storage to your unified virtual filesystem.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Message Banner */}
        {message && (
          <div className="px-6 py-3 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{message}</span>
          </div>
        )}

        {/* Action Controls */}
        <div className="p-4 bg-slate-950/40 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={handleConnectLive}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/25 transition disabled:opacity-50"
          >
            {loading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            <span>{loading ? 'Connecting to Google...' : 'Connect Google Drive Account'}</span>
          </button>

          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Status</span>
          </button>
        </div>

        {/* Accounts Grid */}
        <div className="p-6 overflow-y-auto space-y-3">
          {accounts.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              No Google Drive accounts connected yet. Click "+ Connect Google Drive Account" above to link your first account.
            </div>
          ) : (
            accounts.map((acc, index) => {
              const limit = Number(acc.quotaLimitBytes) || 1;
              const used = Number(acc.quotaUsedBytes) || 0;
              const reserved = Number(acc.reservedBytes) || 0;
              const usedPct = Math.min(100, (used / limit) * 100);

              return (
                <div
                  key={acc.id}
                  className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-slate-700/80 transition"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300 font-mono text-xs font-bold shrink-0">
                      #{String(index + 1).padStart(2, '0')}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white text-sm truncate" title={acc.googleEmail}>
                          {acc.googleEmail}
                        </span>
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                          acc.status === 'ACTIVE'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}>
                          {acc.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-3">
                        <span>Used: <strong className="text-slate-200">{formatBytes(acc.quotaUsedBytes)}</strong></span>
                        <span>•</span>
                        <span>Capacity: <strong className="text-slate-200">{formatBytes(acc.quotaLimitBytes)}</strong></span>
                        {reserved > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-amber-400 font-medium">Reserved: {formatBytes(acc.reservedBytes)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Meter & Actions */}
                  <div className="flex items-center gap-4">
                    <div className="w-36 hidden sm:block">
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                        <span>Headroom</span>
                        <span>{usedPct.toFixed(1)}%</span>
                      </div>
                      <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${usedPct}%` }}
                          className="h-full bg-indigo-500 rounded-full"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleSyncAccount(acc.id)}
                        disabled={loading}
                        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        title="Sync Quota with Google Drive"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDisconnect(acc.id, acc.googleEmail)}
                        disabled={loading}
                        className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                        title="Disconnect Account"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
