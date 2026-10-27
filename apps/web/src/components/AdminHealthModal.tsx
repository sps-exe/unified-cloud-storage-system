import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2, Activity } from './icons';
import { api, formatBytes } from '../lib/api';

interface AdminHealthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReconciliationComplete: () => void;
}

interface SystemHealthData {
  completedFiles: number;
  pendingFiles: number;
  uploadingFiles: number;
  failedFiles: number;
  orphanedFiles: number;
  cancelledFiles: number;
  deletedFiles: number;
  potentiallyStuckFiles: number;
  completedWithoutDriveId: number;
  totalManagedBytes: string;
  activeAccountsCount: number;
  totalQuotaBytes: string;
  totalUsedBytes: string;
  totalReservedBytes: string;
}

interface ReconcileReport {
  timestamp: string;
  stuckUploadsRecovered: Array<{
    fileId: string;
    displayFilename: string;
    sizeBytes: string;
    googleEmail: string;
  }>;
  reservationsCorrected: Array<{
    accountId: string;
    googleEmail: string;
    previousReservedBytes: string;
    correctedReservedBytes: string;
  }>;
  quotasSyncedCount: number;
}

export const AdminHealthModal: React.FC<AdminHealthModalProps> = ({
  isOpen,
  onClose,
  onReconciliationComplete,
}) => {
  const [data, setData] = useState<SystemHealthData | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [report, setReport] = useState<ReconcileReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setError(null);
    try {
      const res = await api.request<SystemHealthData>('/api/admin/health');
      if (res.ok) {
        setData(res.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch system health');
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchHealth();
      setReport(null);
    }
  }, [isOpen]);

  const handleTriggerReconcile = async () => {
    setReconciling(true);
    setError(null);
    try {
      const res = await api.request<ReconcileReport>('/api/admin/reconcile', {
        method: 'POST',
        body: JSON.stringify({
          uploadingThresholdMinutes: 10,
          pendingThresholdMinutes: 5,
        }),
      });
      if (res.ok) {
        setReport(res.data);
        await fetchHealth();
        onReconciliationComplete();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reconciliation failed');
    } finally {
      setReconciling(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-amber-400" />
              <span>System Consistency & Reliability Diagnostics</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Real-time audit of PostgreSQL metadata consistency, orphaned reservations, and background reconciliation.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {error && (
            <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-md text-xs text-rose-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Trigger Card */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-xs font-semibold text-zinc-200 flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-zinc-400" />
                <span>Background Reconciliation Engine</span>
              </h3>
              <p className="text-xs text-zinc-400 mt-1 font-sans">
                Executes PostgreSQL CTE queries with <code className="text-zinc-300 font-mono text-[11px] bg-zinc-900 px-1 py-0.5 rounded border border-zinc-800">FOR UPDATE SKIP LOCKED</code>, recovers stuck uploads, and resets orphaned reservations.
              </p>
            </div>
            <button
              onClick={handleTriggerReconcile}
              disabled={reconciling}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium transition shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${reconciling ? 'animate-spin' : ''}`} />
              <span>{reconciling ? 'Reconciling...' : 'Trigger Full Reconciliation'}</span>
            </button>
          </div>

          {/* Report Banner if just reconciled */}
          {report && (
            <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs space-y-1.5 font-mono">
              <div className="font-medium text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                <span>Reconciliation Executed Successfully</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-zinc-300 pt-1 tabular-nums">
                <div>Stuck Recovered: <strong className="text-zinc-100">{report.stuckUploadsRecovered.length}</strong></div>
                <div>Reservations Corrected: <strong className="text-zinc-100">{report.reservationsCorrected.length}</strong></div>
                <div>Quotas Synced: <strong className="text-zinc-100">{report.quotasSyncedCount}</strong></div>
              </div>
            </div>
          )}

          {/* Diagnostics Grid */}
          {data && (
            <div className="space-y-4">
              <h4 className="text-[11px] font-mono font-medium text-zinc-400 uppercase tracking-wider">
                File State Machine Distribution
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
                  <span className="text-[11px] text-zinc-400 font-mono">Completed</span>
                  <div className="text-base font-semibold text-emerald-400 font-mono tabular-nums mt-0.5">
                    {data.completedFiles}
                  </div>
                </div>
                <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
                  <span className="text-[11px] text-zinc-400 font-mono">In-Flight / Pending</span>
                  <div className="text-base font-semibold text-amber-400 font-mono tabular-nums mt-0.5">
                    {data.pendingFiles + data.uploadingFiles}
                  </div>
                </div>
                <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
                  <span className="text-[11px] text-zinc-400 font-mono">Failed / Aborted</span>
                  <div className="text-base font-semibold text-rose-400 font-mono tabular-nums mt-0.5">
                    {data.failedFiles}
                  </div>
                </div>
                <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
                  <span className="text-[11px] text-zinc-400 font-mono">Soft Deleted</span>
                  <div className="text-base font-semibold text-zinc-400 font-mono tabular-nums mt-0.5">
                    {data.deletedFiles}
                  </div>
                </div>
              </div>

              <h4 className="text-[11px] font-mono font-medium text-zinc-400 uppercase tracking-wider pt-2">
                Storage & Integrity Verification
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
                  <span className="text-[11px] text-zinc-400 font-mono">Total Managed Bytes</span>
                  <div className="text-sm font-semibold text-zinc-200 font-mono tabular-nums mt-0.5">
                    {formatBytes(data.totalManagedBytes)}
                  </div>
                </div>
                <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
                  <span className="text-[11px] text-zinc-400 font-mono">Active Drive Accounts</span>
                  <div className="text-sm font-semibold text-zinc-200 font-mono tabular-nums mt-0.5">
                    {data.activeAccountsCount} accounts
                  </div>
                </div>
                <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
                  <span className="text-[11px] text-zinc-400 font-mono">Potentially Stuck Uploads</span>
                  <div className={`text-sm font-semibold font-mono tabular-nums mt-0.5 ${
                    data.potentiallyStuckFiles > 0 ? 'text-amber-400' : 'text-zinc-400'
                  }`}>
                    {data.potentiallyStuckFiles}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
