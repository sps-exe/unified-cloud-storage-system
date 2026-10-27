import React from 'react';
import { Database, HardDrive, ShieldAlert, Zap } from './icons';
import { formatBytes } from '../lib/api';

interface StorageOverviewProps {
  totalQuotaBytes: string;
  totalUsedBytes: string;
  totalAvailableBytes: string;
  totalReservedBytes: string;
  activeAccountsCount: number;
  totalAccountsCount: number;
  onOpenAccounts?: () => void;
}

export const StorageOverview: React.FC<StorageOverviewProps> = ({
  totalQuotaBytes,
  totalUsedBytes,
  totalAvailableBytes,
  totalReservedBytes,
  activeAccountsCount,
  totalAccountsCount,
  onOpenAccounts,
}) => {
  const limit = Number(totalQuotaBytes) || 1;
  const used = Number(totalUsedBytes) || 0;
  const reserved = Number(totalReservedBytes) || 0;

  const hasAccounts = totalAccountsCount > 0;
  const usedPct = hasAccounts ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;
  const reservedPct = hasAccounts ? Math.min(100 - usedPct, Math.max(0, (reserved / limit) * 100)) : 0;
  const freePct = hasAccounts ? Math.max(0, 100 - usedPct - reservedPct) : 100;

  return (
    <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
      {/* Background ambient gradient glow */}
      <div className="absolute -top-24 -right-24 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 relative">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white tracking-tight">Unified Storage Pool</h2>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700/60 font-mono">
              {hasAccounts ? `${activeAccountsCount}-Drive Fabric` : '0 Drives Connected'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {hasAccounts
              ? `Dynamic aggregation across ${activeAccountsCount} active Google Drive account${activeAccountsCount === 1 ? '' : 's'}.`
              : 'Connect Google accounts to aggregate storage into a single high-speed virtual filesystem.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="sm:text-right">
            <span className="text-[11px] text-slate-400 uppercase font-medium tracking-wider">Available Headroom</span>
            <div className="text-lg font-bold text-emerald-400 font-mono">
              {hasAccounts ? formatBytes(totalAvailableBytes) : '0 B'}
            </div>
          </div>
        </div>
      </div>

      {/* Aggregated Progress Bar */}
      <div className="space-y-2 mb-6">
        <div className="h-3 w-full bg-slate-950 rounded-full overflow-hidden flex p-0.5 border border-slate-800">
          {usedPct > 0 && (
            <div
              style={{ width: `${usedPct}%` }}
              className="bg-indigo-500 rounded-l-full transition-all duration-500"
              title={`Used: ${formatBytes(totalUsedBytes)} (${usedPct.toFixed(1)}%)`}
            />
          )}
          {reservedPct > 0 && (
            <div
              style={{ width: `${reservedPct}%` }}
              className="bg-amber-500 transition-all duration-500"
              title={`In-Flight Reserved: ${formatBytes(totalReservedBytes)} (${reservedPct.toFixed(1)}%)`}
            />
          )}
          <div
            style={{ width: `${freePct}%` }}
            className={`transition-all duration-500 rounded-r-full ${
              hasAccounts ? 'bg-slate-800/80' : 'bg-slate-800/40'
            }`}
            title={`Available: ${formatBytes(totalAvailableBytes)} (${freePct.toFixed(1)}%)`}
          />
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-between text-xs text-slate-400 pt-0.5 gap-2">
          <div className="flex items-center gap-3 text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-indigo-500" />
              <span>Used: <strong className="text-slate-200 font-mono">{formatBytes(totalUsedBytes)}</strong></span>
            </div>
            {reserved > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                <span>Reserved: <strong className="text-slate-200 font-mono">{formatBytes(totalReservedBytes)}</strong></span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-slate-600" />
              <span>Headroom: <strong className="text-slate-200 font-mono">{formatBytes(totalAvailableBytes)}</strong></span>
            </div>
          </div>
          <div className="text-[11px]">
            <span>Total Capacity: <strong className="text-white font-mono">{formatBytes(totalQuotaBytes)}</strong></span>
          </div>
        </div>
      </div>

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div
          onClick={onOpenAccounts}
          className={`bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5 transition ${
            onOpenAccounts ? 'cursor-pointer hover:border-indigo-500/50 hover:bg-slate-950/80' : ''
          }`}
        >
          <div className="flex items-center gap-1.5 text-indigo-400 mb-1">
            <Database className="h-3.5 w-3.5" />
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Total Pool</span>
          </div>
          <div className="text-lg font-bold text-white font-mono">
            {formatBytes(totalQuotaBytes)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {activeAccountsCount} of {totalAccountsCount} accounts linked
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5">
          <div className="flex items-center gap-1.5 text-indigo-400 mb-1">
            <HardDrive className="h-3.5 w-3.5" />
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Used Storage</span>
          </div>
          <div className="text-lg font-bold text-white font-mono">
            {formatBytes(totalUsedBytes)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {usedPct.toFixed(1)}% of total capacity
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5">
          <div className="flex items-center gap-1.5 text-emerald-400 mb-1">
            <Zap className="h-3.5 w-3.5" />
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Available Free</span>
          </div>
          <div className="text-lg font-bold text-emerald-400 font-mono">
            {formatBytes(totalAvailableBytes)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {freePct.toFixed(1)}% remaining space
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5">
          <div className="flex items-center gap-1.5 text-amber-400 mb-1">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">In-Flight Lock</span>
          </div>
          <div className="text-lg font-bold text-amber-400 font-mono">
            {formatBytes(totalReservedBytes)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Atomic byte reservations
          </div>
        </div>
      </div>
    </div>
  );
};
