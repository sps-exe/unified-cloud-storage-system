import { useState, useEffect, useCallback } from 'react';
import { api } from './lib/api';
import { Navbar } from './components/Navbar';
import { StorageOverview } from './components/StorageOverview';
import { FileManager } from './components/FileManager';
import { AccountsModal } from './components/AccountsModal';
import { UploadModal } from './components/UploadModal';
import { AdminHealthModal } from './components/AdminHealthModal';
import { WebdavModal } from './components/WebdavModal';
import { AuthModal } from './components/AuthModal';
import type { FileDto, DriveAccountDto, PaginationMeta } from '@ucss/shared';

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState('');
  
  // Storage summary state
  const [totalQuotaBytes, setTotalQuotaBytes] = useState('0');
  const [totalUsedBytes, setTotalUsedBytes] = useState('0');
  const [totalAvailableBytes, setTotalAvailableBytes] = useState('0');
  const [totalReservedBytes, setTotalReservedBytes] = useState('0');
  const [activeAccountsCount, setActiveAccountsCount] = useState(0);

  // Lists state
  const [accounts, setAccounts] = useState<DriveAccountDto[]>([]);
  const [files, setFiles] = useState<FileDto[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });

  // Query filters
  const [search, setSearch] = useState('');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedMime, setSelectedMime] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  // Modals state
  const [isAccountsOpen, setIsAccountsOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isWebdavOpen, setIsWebdavOpen] = useState(false);

  // 1. Fetch user profile and unified storage stats
  const fetchProfileAndStorage = useCallback(async () => {
    try {
      const res = await api.request<{
        id?: string;
        email?: string;
        user?: { id: string; email: string };
        storage?: {
          totalQuotaBytes: string;
          totalUsedBytes: string;
          totalAvailableBytes: string;
          totalReservedBytes: string;
          activeAccountsCount: number;
        };
      }>('/api/auth/me');

      if (res.ok && res.data) {
        setIsAuthenticated(true);
        const resolvedEmail = res.data.email || res.data.user?.email || '';
        if (resolvedEmail) setUserEmail(resolvedEmail);
        if (res.data.storage) {
          setTotalQuotaBytes(res.data.storage.totalQuotaBytes);
          setTotalUsedBytes(res.data.storage.totalUsedBytes);
          setTotalAvailableBytes(res.data.storage.totalAvailableBytes);
          setTotalReservedBytes(res.data.storage.totalReservedBytes);
          setActiveAccountsCount(res.data.storage.activeAccountsCount);
        }
      } else {
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.warn('Session verification failed:', err);
      setIsAuthenticated(false);
    }
  }, []);

  // 2. Fetch connected Google Drive accounts
  const fetchAccounts = useCallback(async () => {
    try {
      const res = await api.request<DriveAccountDto[]>('/api/accounts');
      if (res.ok) {
        setAccounts(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    }
  }, []);

  // 3. Fetch files list with filters
  const fetchFiles = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: '20',
        sortBy,
        sortOrder,
      });
      if (search.trim()) params.append('search', search.trim());
      if (selectedAccount) params.append('driveAccountId', selectedAccount);
      if (selectedMime) params.append('mimeType', selectedMime);

      const res = await api.request<FileDto[]>(`/api/files?${params.toString()}`);
      if (res.ok) {
        setFiles(res.data);
        if (res.meta) setMeta(res.meta);
      }
    } catch (err) {
      console.error('Failed to fetch files:', err);
    }
  }, [page, search, selectedAccount, selectedMime, sortBy, sortOrder]);

  const refreshAll = useCallback(() => {
    fetchProfileAndStorage();
    fetchAccounts();
    fetchFiles();
  }, [fetchProfileAndStorage, fetchAccounts, fetchFiles]);

  // Initial load
  useEffect(() => {
    fetchProfileAndStorage();
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true') {
      setIsAccountsOpen(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [fetchProfileAndStorage]);

  // Once authenticated, load accounts & files
  useEffect(() => {
    if (isAuthenticated) {
      fetchAccounts();
      fetchFiles();
    }
  }, [isAuthenticated, fetchAccounts, fetchFiles]);

  const handleLogout = async () => {
    try {
      await api.request('/api/auth/logout', { method: 'POST' });
    } finally {
      api.setToken(null);
      api.setRefreshToken(null);
      setIsAuthenticated(false);
    }
  };

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400 text-sm">
        <div className="h-6 w-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mr-3" />
        <span>Initializing Unified Cloud Storage System...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthModal
        onSuccess={() => {
          setIsAuthenticated(true);
          fetchProfileAndStorage();
        }}
      />
    );
  }

  const totalCapacityGb = Number(totalQuotaBytes) / (1024 * 1024 * 1024);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Navigation */}
      <Navbar
        userEmail={userEmail}
        activeAccountsCount={activeAccountsCount}
        totalCapacityGb={totalCapacityGb}
        onOpenAccounts={() => setIsAccountsOpen(true)}
        onOpenAdmin={() => setIsAdminOpen(true)}
        onOpenWebdav={() => setIsWebdavOpen(true)}
        onLogout={handleLogout}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Storage Pool Overview Bar & Metric Cards */}
        <StorageOverview
          totalQuotaBytes={totalQuotaBytes}
          totalUsedBytes={totalUsedBytes}
          totalAvailableBytes={totalAvailableBytes}
          totalReservedBytes={totalReservedBytes}
          activeAccountsCount={activeAccountsCount}
          totalAccountsCount={accounts.length}
        />

        {/* Unified File Explorer */}
        <FileManager
          files={files}
          meta={meta}
          accounts={accounts}
          search={search}
          onSearchChange={(val) => { setSearch(val); setPage(1); }}
          selectedAccount={selectedAccount}
          onAccountChange={(val) => { setSelectedAccount(val); setPage(1); }}
          selectedMime={selectedMime}
          onMimeChange={(val) => { setSelectedMime(val); setPage(1); }}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSortChange={(sb, so) => { setSortBy(sb); setSortOrder(so); setPage(1); }}
          page={page}
          onPageChange={setPage}
          onOpenUpload={() => setIsUploadOpen(true)}
          onRefresh={refreshAll}
        />
      </main>

      {/* Modals */}
      <AccountsModal
        isOpen={isAccountsOpen}
        onClose={() => setIsAccountsOpen(false)}
        accounts={accounts}
        onRefresh={refreshAll}
      />

      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        accounts={accounts}
        onUploadComplete={refreshAll}
      />

      <AdminHealthModal
        isOpen={isAdminOpen}
        onClose={() => setIsAdminOpen(false)}
        onReconciliationComplete={refreshAll}
      />

      <WebdavModal
        isOpen={isWebdavOpen}
        onClose={() => setIsWebdavOpen(false)}
        userEmail={userEmail}
      />

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        <p>Unified Cloud Storage System (UCSS) • PostgreSQL-First Multi-Drive Orchestrator</p>
      </footer>
    </div>
  );
}
