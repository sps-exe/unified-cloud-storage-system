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
}

export const StorageOverview: React.FC<StorageOverviewProps> = ({
  totalQuotaBytes,
  totalUsedBytes,
  totalAvailableBytes,
  totalReservedBytes,
  activeAccountsCount,
  totalAccountsCount,
}) => {
  const limit = Number(totalQuotaBytes) || 1;
  const used = Number(totalUsedBytes) || 0;
  const reserved = Number(totalReservedBytes) || 0;

  const usedPct = Math.min(100, Math.max(0, (used / limit) * 100));
  const reservedPct = Math.min(100 - usedPct, Math.max(0, (reserved / limit) * 100));
  const freePct = Math.max(0, 100 - usedPct - reservedPct);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
      {/* Background ambient gradient glow */}
      <div className="absolute -top-24 -right-24 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 relative">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>Unified Storage Pool</span>
            <span className="text-xs font-normal px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              Aggregated 10-Account Fabric
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Aggregating multiple personal Google Drive accounts into a singular virtual filesystem.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-xs text-slate-400">Headroom Available</span>
            <div className="text-lg font-bold text-emerald-400">
              {formatBytes(totalAvailableBytes)}
            </div>
          </div>
        </div>
      </div>

      {/* Aggregated Progress Bar */}
      <div className="space-y-2 mb-6">
        <div className="h-4 w-full bg-slate-800 rounded-full overflow-hidden flex p-0.5 border border-slate-700/50">
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
            className="bg-slate-700/40 rounded-r-full transition-all duration-500"
            title={`Available: ${formatBytes(totalAvailableBytes)} (${freePct.toFixed(1)}%)`}
          />
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
              <span>Used: <strong className="text-slate-200">{formatBytes(totalUsedBytes)}</strong></span>
            </div>
            {reserved > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
                <span>Reserved: <strong className="text-slate-200">{formatBytes(totalReservedBytes)}</strong></span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
              <span>Free Headroom: <strong className="text-slate-200">{formatBytes(totalAvailableBytes)}</strong></span>
            </div>
          </div>
          <div>
            <span>Total Capacity: <strong className="text-white">{formatBytes(totalQuotaBytes)}</strong></span>
          </div>
        </div>
      </div>

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
          <div className="flex items-center gap-2 text-indigo-400 mb-1">
            <Database className="h-4 w-4" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Quota</span>
          </div>
          <div className="text-xl font-bold text-white font-mono">
            {formatBytes(totalQuotaBytes)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {activeAccountsCount} of {totalAccountsCount} accounts active (~15 GB ea.)
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
          <div className="flex items-center gap-2 text-indigo-400 mb-1">
            <HardDrive className="h-4 w-4" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Used Bytes</span>
          </div>
          <div className="text-xl font-bold text-white font-mono">
            {formatBytes(totalUsedBytes)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {usedPct.toFixed(1)}% of total pool consumed
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
          <div className="flex items-center gap-2 text-emerald-400 mb-1">
            <Zap className="h-4 w-4" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Available Free</span>
          </div>
          <div className="text-xl font-bold text-emerald-400 font-mono">
            {formatBytes(totalAvailableBytes)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {freePct.toFixed(1)}% available headroom
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
          <div className="flex items-center gap-2 text-amber-400 mb-1">
            <ShieldAlert className="h-4 w-4" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">In-Flight Lock</span>
          </div>
          <div className="text-xl font-bold text-amber-400 font-mono">
            {formatBytes(totalReservedBytes)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            PostgreSQL advisory locks active
          </div>
        </div>
      </div>
    </div>
  );
};
