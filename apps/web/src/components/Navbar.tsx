import React from 'react';
import { Database, HardDrive, LogOut, ShieldCheck, User } from './icons';

interface NavbarProps {
  userEmail: string;
  activeAccountsCount: number;
  totalCapacityGb: number;
  onOpenAccounts: () => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  userEmail,
  activeAccountsCount,
  totalCapacityGb,
  onOpenAccounts,
  onOpenAdmin,
  onLogout,
}) => {
  return (
    <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Database className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg tracking-tight text-white">UCSS</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                10-Drive Fabric
              </span>
            </div>
            <p className="text-xs text-slate-400">Unified Cloud Storage System</p>
          </div>
        </div>

        {/* Center / Stats Pill */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700/60 text-xs">
          <HardDrive className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-slate-300">
            <strong className="text-white">{activeAccountsCount}</strong> Connected Accounts
          </span>
          <span className="text-slate-600">•</span>
          <span className="text-slate-300">
            <strong className="text-white">~{totalCapacityGb.toFixed(0)} GB</strong> Aggregated Pool
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenAccounts}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            <HardDrive className="h-4 w-4 text-indigo-400" />
            <span>Drive Accounts</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300 font-mono">
              {activeAccountsCount}
            </span>
          </button>

          <button
            onClick={onOpenAdmin}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            title="System Diagnostics & Reliability"
          >
            <ShieldCheck className="h-4 w-4 text-amber-400" />
            <span className="hidden sm:inline">Diagnostics</span>
          </button>

          <div className="h-4 w-px bg-slate-800" />

          {/* User profile & logout */}
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
              <User className="h-4 w-4" />
            </div>
            <span className="text-xs text-slate-300 hidden lg:inline max-w-[140px] truncate" title={userEmail}>
              {userEmail}
            </span>
            <button
              onClick={onLogout}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 transition"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
