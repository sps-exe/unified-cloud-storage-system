import React from 'react';
import { Database, HardDrive, ShieldAlert, Zap } from './icons';
import { formatBytes } from '../lib/api';
import type { DriveAccountDto } from '@ucss/shared';

interface StorageOverviewProps {
  totalQuotaBytes: string;
  totalUsedBytes: string;
  totalAvailableBytes: string;
  totalReservedBytes: string;
  activeAccountsCount: number;
  totalAccountsCount: number;
  accounts?: DriveAccountDto[];
  onOpenAccounts?: () => void;
}

export const StorageOverview: React.FC<StorageOverviewProps> = ({
  totalQuotaBytes,
  totalUsedBytes,
  totalAvailableBytes,
  totalReservedBytes,
  activeAccountsCount,
  totalAccountsCount,
  accounts = [],
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
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5">
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-100 tracking-tight">Aggregated Storage Capacity</h2>
            <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-zinc-950 text-zinc-400 border border-zinc-800">
              {hasAccounts ? `${activeAccountsCount} Drives Active` : '0 Drives Linked'}
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            {hasAccounts
              ? `Unified virtual filesystem across ${activeAccountsCount} Google Drive node${activeAccountsCount === 1 ? '' : 's'}.`
              : 'Link personal Google accounts to aggregate storage into a single high-speed virtual filesystem.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="sm:text-right">
            <span className="text-[10px] text-zinc-500 uppercase font-medium tracking-wider block">Available Headroom</span>
            <div className="text-base font-semibold text-emerald-400 font-mono tabular-nums">
              {hasAccounts ? formatBytes(totalAvailableBytes) : '0 B'}
            </div>
          </div>
        </div>
      </div>

      {/* Segmented Linear Progress Bar (Account Breakdown) */}
      <div className="space-y-2 mb-5">
        {hasAccounts && accounts.length > 0 ? (
          /* Multi-account discrete segments */
          <div className="h-2.5 w-full bg-zinc-950 rounded overflow-hidden flex border border-zinc-800">
            {accounts.map((acc) => {
              const accLimit = Number(acc.quotaLimitBytes) || 1;
              const accUsed = Number(acc.quotaUsedBytes) || 0;
              const accReserved = Number(acc.reservedBytes) || 0;
              const weightPct = Math.max(5, (accLimit / limit) * 100);

              const accUsedFrac = accLimit > 0 ? Math.min(1, accUsed / accLimit) : 0;
              const accReservedFrac = accLimit > 0 ? Math.min(1 - accUsedFrac, accReserved / accLimit) : 0;

              return (
                <div
                  key={acc.id}
                  style={{ width: `${weightPct}%` }}
                  className="h-full border-r border-zinc-950 last:border-r-0 flex bg-zinc-800/40 relative group"
                  title={`${acc.googleEmail}: ${formatBytes(accUsed)} used of ${formatBytes(accLimit)}`}
                >
                  {accUsedFrac > 0 && (
                    <div
                      style={{ width: `${accUsedFrac * 100}%` }}
                      className="h-full bg-zinc-400 transition-all duration-300"
                    />
                  )}
                  {accReservedFrac > 0 && (
                    <div
                      style={{ width: `${accReservedFrac * 100}%` }}
                      className="h-full bg-amber-500 transition-all duration-300"
                    />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* Simple single fallback bar */
          <div className="h-2.5 w-full bg-zinc-950 rounded overflow-hidden flex border border-zinc-800">
            {usedPct > 0 && (
              <div
                style={{ width: `${usedPct}%` }}
                className="bg-zinc-400 transition-all duration-300"
                title={`Used: ${formatBytes(totalUsedBytes)}`}
              />
            )}
            {reservedPct > 0 && (
              <div
                style={{ width: `${reservedPct}%` }}
                className="bg-amber-500 transition-all duration-300"
                title={`In-Flight: ${formatBytes(totalReservedBytes)}`}
              />
            )}
            <div
              style={{ width: `${freePct}%` }}
              className="bg-zinc-800/40 transition-all duration-300"
              title={`Available: ${formatBytes(totalAvailableBytes)}`}
            />
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-between text-xs text-zinc-400 pt-0.5 gap-2">
          <div className="flex items-center gap-3 text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-xs bg-zinc-400" />
              <span>Used: <strong className="text-zinc-200 font-mono tabular-nums">{formatBytes(totalUsedBytes)}</strong></span>
            </div>
            {reserved > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-xs bg-amber-500" />
                <span>Reserved: <strong className="text-zinc-200 font-mono tabular-nums">{formatBytes(totalReservedBytes)}</strong></span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-xs bg-zinc-700" />
              <span>Free: <strong className="text-emerald-400 font-mono tabular-nums">{formatBytes(totalAvailableBytes)}</strong></span>
            </div>
          </div>
          <div className="text-[11px]">
            <span>Total Pool: <strong className="text-zinc-100 font-mono tabular-nums">{formatBytes(totalQuotaBytes)}</strong></span>
          </div>
        </div>
      </div>

      {/* 4 High-Density Metric Surfaces */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div
          onClick={onOpenAccounts}
          className={`bg-zinc-950 border border-zinc-800 rounded-lg p-3 transition ${
            onOpenAccounts ? 'cursor-pointer hover:border-zinc-700 hover:bg-zinc-900/50' : ''
          }`}
        >
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Total Pool</span>
            <Database className="h-3.5 w-3.5 text-zinc-400" />
          </div>
          <div className="text-base font-semibold text-zinc-100 font-mono tabular-nums">
            {formatBytes(totalQuotaBytes)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5 font-mono tabular-nums">
            {activeAccountsCount} of {totalAccountsCount} accounts linked
          </div>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Allocated</span>
            <HardDrive className="h-3.5 w-3.5 text-zinc-400" />
          </div>
          <div className="text-base font-semibold text-zinc-100 font-mono tabular-nums">
            {formatBytes(totalUsedBytes)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5 font-mono tabular-nums">
            {usedPct.toFixed(1)}% of total pool
          </div>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Available</span>
            <Zap className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <div className="text-base font-semibold text-emerald-400 font-mono tabular-nums">
            {formatBytes(totalAvailableBytes)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5 font-mono tabular-nums">
            {freePct.toFixed(1)}% headroom remaining
          </div>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">In-Flight Lock</span>
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
          </div>
          <div className="text-base font-semibold text-amber-400 font-mono tabular-nums">
            {formatBytes(totalReservedBytes)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5 font-mono tabular-nums">
            Atomic byte reservations
          </div>
        </div>
      </div>
    </div>
  );
};
