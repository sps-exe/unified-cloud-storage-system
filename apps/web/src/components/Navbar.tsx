import { formatBytes } from '../lib/api';
import React from 'react';
import { Database, HardDrive, LogOut, ShieldCheck, User, Folder } from './icons';

interface NavbarProps {
  userEmail: string;
  activeAccountsCount: number;
  totalCapacityGb: number;
  onOpenAccounts: () => void;
  onOpenAdmin: () => void;
  onOpenWebdav: () => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  userEmail,
  activeAccountsCount,
  totalCapacityGb,
  onOpenAccounts,
  onOpenAdmin,
  onOpenWebdav,
  onLogout,
}) => {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        {/* Brand Mark */}
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-100">
            <Database className="h-4 w-4 text-zinc-200" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm tracking-tight text-zinc-100">UCSS</span>
            <span className="text-xs text-zinc-500 hidden sm:inline">Unified Cloud Storage</span>
          </div>
        </div>

        {/* Center / System Fabric Telemetry Pill */}
        <div className="hidden md:flex items-center gap-2.5 px-3 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-xs">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-zinc-400">
            <strong className="text-zinc-200 font-mono tabular-nums">{activeAccountsCount}</strong> {activeAccountsCount === 1 ? 'drive' : 'drives'} connected
          </span>
          <span className="text-zinc-700">|</span>
          <span className="text-zinc-400">
            <strong className="text-zinc-200 font-mono tabular-nums">{formatBytes(totalCapacityGb * 1024 ** 3)}</strong> total
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenWebdav}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 hover:border-zinc-700 transition"
            title="Mount native network drive via WebDAV RFC 4918"
          >
            <Folder className="h-3.5 w-3.5 text-zinc-400" />
            <span className="hidden sm:inline">WebDAV</span>
          </button>

          <button
            onClick={onOpenAccounts}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 hover:border-zinc-700 transition"
            title="Manage Connected Google Drive Accounts"
          >
            <HardDrive className="h-3.5 w-3.5 text-zinc-400" />
            <span className="hidden sm:inline">Accounts</span>
            <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 font-mono tabular-nums text-[10px]">
              {activeAccountsCount}
            </span>
          </button>

          <button
            onClick={onOpenAdmin}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 hover:border-zinc-700 transition"
            title="System Diagnostics & Consistency State Machine"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-zinc-400" />
            <span className="hidden sm:inline">Health</span>
          </button>

          <div className="h-4 w-px bg-zinc-800 mx-1" />

          {/* User Profile & Sign Out */}
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400">
              <User className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-mono text-zinc-400 hidden lg:inline max-w-[150px] truncate" title={userEmail}>
              {userEmail}
            </span>
            <button
              onClick={onLogout}
              className="p-1 rounded-md text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition"
              title="Sign Out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
