import React, { useState } from 'react';
import {
  Search,
  Upload,
  Download,
  Edit2,
  Trash2,
  Eye,
  Lock,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  File as FileGeneric,
  ChevronLeft,
  ChevronRight,
  HardDrive,
  Copy,
  Check,
  Plus,
  UploadCloud,
} from './icons';
import { api, formatBytes, resolveUrl } from '../lib/api';
import { useToast } from './Toast';
import { FilePreviewModal } from './FilePreviewModal';
import type { FileDto, DriveAccountDto, PaginationMeta } from '@ucss/shared';

interface FileManagerProps {
  files: FileDto[];
  meta: PaginationMeta;
  accounts: DriveAccountDto[];
  search: string;
  onSearchChange: (val: string) => void;
  selectedAccount: string;
  onAccountChange: (val: string) => void;
  selectedMime: string;
  onMimeChange: (val: string) => void;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSortChange: (sortBy: string, sortOrder: 'asc' | 'desc') => void;
  page: number;
  onPageChange: (newPage: number) => void;
  onOpenUpload: (preselectedFile?: File) => void;
  onOpenAccounts?: () => void;
  onRefresh: () => void;
  isLoading?: boolean;
}

export const FileManager: React.FC<FileManagerProps> = ({
  files,
  meta,
  accounts,
  search,
  onSearchChange,
  selectedAccount,
  onAccountChange,
  selectedMime,
  onMimeChange,
  sortBy,
  sortOrder,
  onSortChange,
  page,
  onPageChange,
  onOpenUpload,
  onOpenAccounts,
  onRefresh,
  isLoading = false,
}) => {
  const toast = useToast();
  const [copiedSha, setCopiedSha] = useState<string | null>(null);
  const [renamingFile, setRenamingFile] = useState<FileDto | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingFile, setDeletingFile] = useState<FileDto | null>(null);
  const [previewFile, setPreviewFile] = useState<FileDto | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const getFileIcon = (mime: string) => {
    if (mime.includes('image')) return <FileImage className="h-4 w-4 text-sky-400" />;
    if (mime.includes('video')) return <FileVideo className="h-4 w-4 text-rose-400" />;
    if (mime.includes('audio')) return <FileAudio className="h-4 w-4 text-amber-400" />;
    if (mime.includes('pdf') || mime.includes('text') || mime.includes('document'))
      return <FileText className="h-4 w-4 text-emerald-400" />;
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip'))
      return <FileArchive className="h-4 w-4 text-purple-400" />;
    return <FileGeneric className="h-4 w-4 text-slate-400" />;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSha(text);
    toast.success('SHA-256 checksum copied to clipboard');
    setTimeout(() => setCopiedSha(null), 2000);
  };

  const handleDownload = (fileId: string, filename: string) => {
    const token = api.getToken();
    const url = resolveUrl(`/api/files/${fileId}/download`);
    toast.info(`Preparing stream download for ${filename}...`);

    fetch(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
        toast.success(`Downloaded ${filename}`);
      })
      .catch((err) => toast.error(`Download failed: ${err.message}`));
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingFile || !renameValue.trim()) return;

    setActionLoading(true);
    try {
      await api.request(`/api/files/${renamingFile.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ displayFilename: renameValue.trim() }),
      });
      toast.success(`Renamed file to ${renameValue.trim()}`);
      setRenamingFile(null);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteSubmit = async () => {
    if (!deletingFile) return;

    setActionLoading(true);
    try {
      await api.request(`/api/files/${deletingFile.id}`, {
        method: 'DELETE',
      });
      toast.success(`"${deletingFile.displayFilename}" moved to trash`);
      setDeletingFile(null);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Soft delete failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onOpenUpload(e.dataTransfer.files[0]);
    }
  };

  const mimeFilters = [
    { label: 'All Files', value: '' },
    { label: 'Documents', value: '%document%' },
    { label: 'Images', value: 'image/%' },
    { label: 'Videos', value: 'video/%' },
    { label: 'Audio', value: 'audio/%' },
  ];

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`bg-slate-900 border rounded-2xl shadow-xl overflow-hidden flex flex-col transition-all duration-200 relative ${
        isDragOver
          ? 'border-indigo-500 ring-2 ring-indigo-500/30 bg-slate-900/90'
          : 'border-slate-800/80 hover:border-slate-700/80'
      }`}
    >
      {/* Drag & Drop Visual Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-40 bg-indigo-950/60 backdrop-blur-xs flex flex-col items-center justify-center border-2 border-dashed border-indigo-400 rounded-2xl pointer-events-none animate-in fade-in duration-150">
          <UploadCloud className="h-12 w-12 text-indigo-400 animate-bounce mb-2" />
          <p className="text-base font-semibold text-white">Drop file to upload to Unified Storage</p>
          <p className="text-xs text-indigo-200 mt-1">Automatic headroom allocation across connected drives</p>
        </div>
      )}

      {/* Action & Filter Toolbar */}
      <div className="p-4 sm:p-5 border-b border-slate-800/80 space-y-3.5 bg-slate-950/30">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Search bar */}
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search files across all drives..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              onClick={() => onOpenUpload()}
              disabled={accounts.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm shadow-indigo-600/30 transition disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Upload File</span>
            </button>
          </div>
        </div>

        {/* Secondary Filters */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs pt-0.5">
          {/* MIME Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 sm:pb-0">
            {mimeFilters.map((f) => (
              <button
                key={f.value}
                onClick={() => onMimeChange(f.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                  selectedMime === f.value
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    : 'bg-slate-800/50 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Account Filter & Sorting */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <select
              value={selectedAccount}
              onChange={(e) => onAccountChange(e.target.value)}
              className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="">All Connected Drives</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.googleEmail}
                </option>
              ))}
            </select>

            <select
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [sb, so] = e.target.value.split('-');
                onSortChange(sb as string, so as 'asc' | 'desc');
              }}
              className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="createdAt-desc">Newest First</option>
              <option value="createdAt-asc">Oldest First</option>
              <option value="name-asc">Name (A-Z)</option>
              <option value="name-desc">Name (Z-A)</option>
              <option value="size-desc">Size (Largest)</option>
              <option value="size-asc">Size (Smallest)</option>
            </select>
          </div>
        </div>
      </div>

      {/* File Table / Empty States / Loading Skeletons */}
      <div className="overflow-x-auto min-h-[300px]">
        {isLoading ? (
          /* Sleek Skeleton Loading State */
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-12 bg-slate-800/40 rounded-xl animate-pulse flex items-center justify-between px-4"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-slate-800 shrink-0" />
                  <div className="space-y-1.5">
                    <div className="h-3.5 w-36 bg-slate-800 rounded" />
                    <div className="h-2 w-20 bg-slate-800/60 rounded" />
                  </div>
                </div>
                <div className="h-3 w-16 bg-slate-800 rounded hidden sm:block" />
                <div className="h-5 w-24 bg-slate-800/60 rounded-full hidden md:block" />
                <div className="h-6 w-20 bg-slate-800/50 rounded" />
              </div>
            ))}
          </div>
        ) : accounts.length === 0 ? (
          /* Graceful Zero-Account Setup Empty State */
          <div className="text-center py-16 px-4 flex flex-col items-center justify-center">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-indigo-500/20 to-violet-500/20 border border-indigo-500/30 flex items-center justify-center mb-3">
              <HardDrive className="h-6 w-6 text-indigo-400" />
            </div>
            <h3 className="text-base font-bold text-white">No Google Drive Accounts Connected</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              Link your first personal Google account to start aggregating cloud storage into your unified high-speed pool.
            </p>
            {onOpenAccounts && (
              <button
                onClick={onOpenAccounts}
                className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition"
              >
                <Plus className="h-4 w-4" />
                <span>Connect Google Drive</span>
              </button>
            )}
          </div>
        ) : files.length === 0 ? (
          /* Graceful Zero-Files Empty State */
          <div className="text-center py-16 px-4 flex flex-col items-center justify-center text-slate-500">
            <div className="h-12 w-12 rounded-2xl bg-slate-800/40 border border-slate-800 flex items-center justify-center mb-3">
              <FileGeneric className="h-6 w-6 text-slate-500" />
            </div>
            <p className="font-semibold text-slate-300 text-sm">No files found</p>
            <p className="text-xs text-slate-500 mt-1 max-w-xs">
              {search || selectedAccount || selectedMime
                ? 'Try adjusting your search keywords or filter criteria.'
                : 'Drag and drop files here or click Upload File to store data across your drives.'}
            </p>
            {!search && !selectedAccount && !selectedMime && (
              <button
                onClick={() => onOpenUpload()}
                className="mt-4 flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
              >
                <Upload className="h-3.5 w-3.5 text-indigo-400" />
                <span>Upload First File</span>
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/40 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-2.5 px-4">Name</th>
                <th className="py-2.5 px-4">Size</th>
                <th className="py-2.5 px-4">Storage Drive</th>
                <th className="py-2.5 px-4 hidden md:table-cell">SHA-256 Checksum</th>
                <th className="py-2.5 px-4 hidden sm:table-cell">Uploaded At</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {files.map((file) => (
                <tr
                  key={file.id}
                  className="hover:bg-slate-800/30 transition group text-slate-300"
                >
                  {/* Name & Icon */}
                  <td className="py-2.5 px-4">
                    <div
                      onClick={() => setPreviewFile(file)}
                      className="flex items-center gap-2.5 min-w-0 cursor-pointer group/title"
                      title="Click to preview file"
                    >
                      <div className="p-1.5 rounded-lg bg-slate-800/80 group-hover/title:bg-indigo-600/20 transition shrink-0">
                        {file.displayFilename.endsWith('.enc') ? (
                          <Lock className="h-4 w-4 text-amber-400" />
                        ) : (
                          getFileIcon(file.mimeType)
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-white group-hover/title:text-indigo-300 transition truncate max-w-[200px] sm:max-w-xs" title={file.displayFilename}>
                            {file.displayFilename}
                          </p>
                          {file.displayFilename.endsWith('.enc') && (
                            <span className="px-1.5 py-0.2 text-[9px] font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded shrink-0">
                              ZK
                            </span>
                          )}
                        </div>
                        {file.originalFilename !== file.displayFilename && (
                          <p className="text-[10px] text-slate-500 truncate" title={`Original: ${file.originalFilename}`}>
                            orig: {file.originalFilename}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Size */}
                  <td className="py-2.5 px-4 font-mono font-medium text-slate-200 whitespace-nowrap">
                    {formatBytes(file.sizeBytes)}
                  </td>

                  {/* Drive Account Pill */}
                  <td className="py-2.5 px-4 whitespace-nowrap">
                    <div className="flex items-center gap-1.5 text-xs text-slate-300 bg-slate-950/80 px-2.5 py-0.5 rounded-full border border-slate-800 inline-flex">
                      <HardDrive className="h-3 w-3 text-indigo-400 shrink-0" />
                      <span className="font-mono text-[11px] truncate max-w-[120px]" title={file.driveAccountEmail}>
                        {file.driveAccountEmail}
                      </span>
                    </div>
                  </td>

                  {/* Checksum */}
                  <td className="py-2.5 px-4 hidden md:table-cell whitespace-nowrap">
                    {file.checksumSha256 ? (
                      <button
                        onClick={() => copyToClipboard(file.checksumSha256!)}
                        className="flex items-center gap-1 font-mono text-[10px] text-slate-500 hover:text-slate-300 transition"
                        title="Click to copy full SHA-256 hash"
                      >
                        <span>{file.checksumSha256.slice(0, 10)}...</span>
                        {copiedSha === file.checksumSha256 ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Copy className="h-3 w-3 opacity-60" />
                        )}
                      </button>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>

                  {/* Upload Date */}
                  <td className="py-2.5 px-4 hidden sm:table-cell text-slate-400 whitespace-nowrap text-[11px]">
                    {new Date(file.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>

                  {/* Actions */}
                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setPreviewFile(file)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition"
                        title="Preview / Stream File"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDownload(file.id, file.displayFilename)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition"
                        title="Download File"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setRenamingFile(file);
                          setRenameValue(file.displayFilename);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        title="Rename File"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeletingFile(file)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                        title="Soft Delete File"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Footer */}
      <div className="p-3.5 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400 bg-slate-950/20">
        <div>
          Showing <strong className="text-slate-200">{files.length}</strong> of{' '}
          <strong className="text-slate-200">{meta.total}</strong> files
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 transition"
            title="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span>
            Page <strong className="text-white">{page}</strong> of{' '}
            <strong className="text-white">{meta.totalPages || 1}</strong>
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= meta.totalPages}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 transition"
            title="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Rename Modal */}
      {renamingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <form
            onSubmit={handleRenameSubmit}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-md shadow-2xl space-y-3.5"
          >
            <h3 className="text-base font-bold text-white">Rename File</h3>
            <p className="text-xs text-slate-400">
              Updates display filename in PostgreSQL and syncs rename with Google Drive.
            </p>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setRenamingFile(null)}
                disabled={actionLoading}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading || !renameValue.trim()}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
              >
                {actionLoading ? 'Renaming...' : 'Save Rename'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-md shadow-2xl space-y-3.5">
            <h3 className="text-base font-bold text-white">Soft Delete File</h3>
            <p className="text-xs text-slate-400">
              Are you sure you want to delete{' '}
              <strong className="text-white font-mono">{deletingFile.displayFilename}</strong>?
            </p>
            <p className="text-[11px] text-slate-500">
              This marks the file as deleted in PostgreSQL and preserves immutable audit logs. The
              underlying Google Drive chunk is permanently reclaimed.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setDeletingFile(null)}
                disabled={actionLoading}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteSubmit}
                disabled={actionLoading}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
              >
                {actionLoading ? 'Deleting...' : 'Confirm Soft Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
};
