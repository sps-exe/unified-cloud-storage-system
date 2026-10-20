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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-amber-400" />
              <span>System Consistency & Reliability Diagnostics</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Real-time audit of PostgreSQL metadata consistency, orphaned reservations, and background reconciliation.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Trigger Card */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Activity className="h-4 w-4 text-indigo-400" />
                <span>Background Reconciliation Engine</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Executes PostgreSQL CTE queries with <code className="text-indigo-400">FOR UPDATE SKIP LOCKED</code>, recovers stuck uploads, and resets orphaned reservations.
              </p>
            </div>
            <button
              onClick={handleTriggerReconcile}
              disabled={reconciling}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium shadow-md shadow-amber-600/20 transition shrink-0"
            >
              <RefreshCw className={`h-4 w-4 ${reconciling ? 'animate-spin' : ''}`} />
              <span>{reconciling ? 'Reconciling...' : 'Trigger Full Reconciliation'}</span>
            </button>
          </div>

          {/* Report Banner if just reconciled */}
          {report && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs space-y-2">
              <div className="font-semibold text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                <span>Reconciliation Executed Successfully</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-slate-300 pt-1">
                <div>Stuck Recovered: <strong className="text-white">{report.stuckUploadsRecovered.length}</strong></div>
                <div>Reservations Corrected: <strong className="text-white">{report.reservationsCorrected.length}</strong></div>
                <div>Quotas Synced: <strong className="text-white">{report.quotasSyncedCount}</strong></div>
              </div>
            </div>
          )}

          {/* Diagnostics Grid */}
          {data && (
            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                File State Machine Distribution
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl">
                  <span className="text-xs text-slate-400">Completed</span>
                  <div className="text-lg font-bold text-emerald-400 font-mono mt-0.5">
                    {data.completedFiles}
                  </div>
                </div>
                <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl">
                  <span className="text-xs text-slate-400">In-Flight / Pending</span>
                  <div className="text-lg font-bold text-amber-400 font-mono mt-0.5">
                    {data.pendingFiles + data.uploadingFiles}
                  </div>
                </div>
                <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl">
                  <span className="text-xs text-slate-400">Failed / Aborted</span>
                  <div className="text-lg font-bold text-rose-400 font-mono mt-0.5">
                    {data.failedFiles}
                  </div>
                </div>
                <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl">
                  <span className="text-xs text-slate-400">Soft Deleted</span>
                  <div className="text-lg font-bold text-slate-400 font-mono mt-0.5">
                    {data.deletedFiles}
                  </div>
                </div>
              </div>

              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider pt-2">
                Storage & Integrity Verification
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl">
                  <span className="text-xs text-slate-400">Total Managed Bytes</span>
                  <div className="text-base font-bold text-white font-mono mt-0.5">
                    {formatBytes(data.totalManagedBytes)}
                  </div>
                </div>
                <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl">
                  <span className="text-xs text-slate-400">Active Drive Accounts</span>
                  <div className="text-base font-bold text-indigo-400 font-mono mt-0.5">
                    {data.activeAccountsCount} accounts
                  </div>
                </div>
                <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl">
                  <span className="text-xs text-slate-400">Potentially Stuck Uploads</span>
                  <div className={`text-base font-bold font-mono mt-0.5 ${
                    data.potentiallyStuckFiles > 0 ? 'text-amber-400' : 'text-slate-400'
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
