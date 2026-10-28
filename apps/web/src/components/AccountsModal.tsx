import React, { useState } from 'react';
import { X, HardDrive, RefreshCw, Plus, Trash2, CheckCircle2 } from './icons';
import { api, formatBytes, type PublicConfig } from '../lib/api';
import { useToast } from './Toast';
import type { DriveAccountDto } from '@ucss/shared';

interface AccountsModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: DriveAccountDto[];
  onRefresh: () => void;
  config?: PublicConfig | null;
}

export const AccountsModal: React.FC<AccountsModalProps> = ({
  isOpen,
  onClose,
  accounts,
  onRefresh,
  config = null,
}) => {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSyncAccount = async (accountId: string) => {
    setLoading(true);
    try {
      await api.request(`/api/accounts/${accountId}/sync`, { method: 'POST' });
      toast.success('Storage quota synchronized with Google Drive');
      setMessage('Storage quota synchronized successfully with Google Drive.');
      setTimeout(() => setMessage(null), 4000);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed');
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
      toast.success(`Disconnected ${email}`);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Disconnect failed');
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
        toast.error('Could not retrieve Google authorization URL. Please try again.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate OAuth URL');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-zinc-400" />
              <span>Connected Drive Accounts</span>
              <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                {accounts.filter((a) => a.status === 'ACTIVE').length} Active
              </span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Each connected account contributes its Google Drive quota to the unified virtual storage pool.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Message Banner */}
        {message && (
          <div className="px-6 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-400 text-xs font-mono flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{message}</span>
          </div>
        )}

        {/* First-run: Google OAuth credentials are required before any account can be linked */}
        {config && !config.googleConfigured && (
          <div className="px-6 py-3 bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-xs space-y-1.5">
            <p className="font-semibold">One-time setup: add Google OAuth credentials</p>
            <ol className="list-decimal list-inside space-y-0.5 text-amber-200/80">
              <li>Create an OAuth client (type: Web application) in the Google Cloud Console and enable the Drive API.</li>
              <li>Add this redirect URI: <code className="font-mono text-amber-100 select-all">{config.googleRedirectUri}</code></li>
              <li>Put the client ID and secret in <code className="font-mono">GOOGLE_CLIENT_ID</code> / <code className="font-mono">GOOGLE_CLIENT_SECRET</code> in your <code className="font-mono">.env</code> and restart.</li>
            </ol>
            <p className="text-amber-200/70">Full walkthrough: docs/google-oauth-setup.md</p>
          </div>
        )}

        {/* Action Controls */}
        <div className="px-6 py-3 bg-zinc-950/60 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={handleConnectLive}
            disabled={loading || (config !== null && !config.googleConfigured)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium transition disabled:opacity-50"
          >
            {loading ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            <span>{loading ? 'Connecting to Google...' : 'Connect Google Drive Account'}</span>
          </button>

          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-zinc-800 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Status</span>
          </button>
        </div>

        {/* Accounts Grid */}
        <div className="p-6 overflow-y-auto space-y-2.5">
          {accounts.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-xs font-mono">
              No Google Drive accounts connected. Connect an account to initialize storage pooling.
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
                  className="bg-zinc-950 border border-zinc-800/80 rounded-lg p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-zinc-700 transition"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 font-mono text-xs font-semibold shrink-0">
                      #{String(index + 1).padStart(2, '0')}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-zinc-200 truncate" title={acc.googleEmail}>
                          {acc.googleEmail}
                        </span>
                        <span className={`text-[10px] font-mono font-medium px-1.5 py-0.5 rounded ${
                          acc.status === 'ACTIVE'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}>
                          {acc.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-1 flex items-center gap-2.5 font-mono tabular-nums">
                        <span>Used: <strong className="text-zinc-200 font-medium">{formatBytes(acc.quotaUsedBytes)}</strong></span>
                        <span className="text-zinc-600">•</span>
                        <span>Capacity: <strong className="text-zinc-200 font-medium">{formatBytes(acc.quotaLimitBytes)}</strong></span>
                        {reserved > 0 && (
                          <>
                            <span className="text-zinc-600">•</span>
                            <span className="text-amber-400 font-medium">Reserved: {formatBytes(acc.reservedBytes)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Meter & Actions */}
                  <div className="flex items-center gap-4">
                    <div className="w-32 hidden sm:block">
                      <div className="flex justify-between text-[10px] text-zinc-400 font-mono tabular-nums mb-1">
                        <span>Used</span>
                        <span>{usedPct.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${usedPct}%` }}
                          className={`h-full rounded-full transition-all duration-300 ${
                            usedPct > 90 ? 'bg-rose-500' : usedPct > 70 ? 'bg-amber-400' : 'bg-emerald-500'
                          }`}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {acc.status === 'TOKEN_EXPIRED' && (
                        <button
                          onClick={handleConnectLive}
                          disabled={loading}
                          className="px-2 py-1 rounded-md text-[11px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 transition"
                          title="Google access expired or was revoked. Sign in again with this account."
                        >
                          Reconnect
                        </button>
                      )}
                      <button
                        onClick={() => handleSyncAccount(acc.id)}
                        disabled={loading}
                        className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
                        title="Sync Quota with Google Drive"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDisconnect(acc.id, acc.googleEmail)}
                        disabled={loading}
                        className="p-1.5 rounded-md text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 transition"
                        title="Disconnect Account"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
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
