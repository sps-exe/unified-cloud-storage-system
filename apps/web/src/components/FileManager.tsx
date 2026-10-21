import React, { useState } from 'react';
import {
  Search,
  Upload,
  Download,
  Edit2,
  Trash2,
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
} from './icons';
import { api, formatBytes, resolveUrl } from '../lib/api';
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
  onOpenUpload: () => void;
  onRefresh: () => void;
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
  onRefresh,
}) => {
  const [copiedSha, setCopiedSha] = useState<string | null>(null);
  const [renamingFile, setRenamingFile] = useState<FileDto | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingFile, setDeletingFile] = useState<FileDto | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const getFileIcon = (mime: string) => {
    if (mime.includes('image')) return <FileImage className="h-5 w-5 text-sky-400" />;
    if (mime.includes('video')) return <FileVideo className="h-5 w-5 text-rose-400" />;
    if (mime.includes('audio')) return <FileAudio className="h-5 w-5 text-amber-400" />;
    if (mime.includes('pdf') || mime.includes('text') || mime.includes('document'))
      return <FileText className="h-5 w-5 text-emerald-400" />;
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip'))
      return <FileArchive className="h-5 w-5 text-purple-400" />;
    return <FileGeneric className="h-5 w-5 text-slate-400" />;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSha(text);
    setTimeout(() => setCopiedSha(null), 2000);
  };

  const handleDownload = (fileId: string, filename: string) => {
    // Direct stream download with auth token
    const token = api.getToken();
    const url = resolveUrl(`/api/files/${fileId}/download`);
    
    // Trigger download via anchor
    fetch(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    })
      .then((res) => res.blob())
      .then((blob) => {
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
      })
      .catch((err) => alert('Download failed: ' + err.message));
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
      setRenamingFile(null);
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Rename failed');
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
      setDeletingFile(null);
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Soft delete failed');
    } finally {
      setActionLoading(false);
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
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden flex flex-col">
      {/* Action & Filter Toolbar */}
      <div className="p-4 sm:p-6 border-b border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Search bar */}
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search files by name..."
              className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs sm:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button
              onClick={onOpenUpload}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-medium shadow-md shadow-indigo-600/20 transition shrink-0"
            >
              <Upload className="h-4 w-4" />
              <span>Upload File</span>
            </button>
          </div>
        </div>

        {/* Secondary Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1">
          {/* MIME Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {mimeFilters.map((f) => (
              <button
                key={f.value}
                onClick={() => onMimeChange(f.value)}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  selectedMime === f.value
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Account Filter & Sorting */}
          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <select
              value={selectedAccount}
              onChange={(e) => onAccountChange(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="">All Drive Accounts</option>
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
              className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
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

      {/* File Table */}
      <div className="overflow-x-auto min-h-[300px]">
        {files.length === 0 ? (
          <div className="text-center py-16 text-slate-500 text-sm">
            <FileGeneric className="h-10 w-10 text-slate-600 mx-auto mb-2 opacity-50" />
            <p className="font-medium text-slate-400">No files found</p>
            <p className="text-xs text-slate-500 mt-1">
              Upload files or clear your search and filter criteria.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/40 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">Size</th>
                <th className="py-3 px-4">Storage Account</th>
                <th className="py-3 px-4 hidden md:table-cell">SHA-256 Checksum</th>
                <th className="py-3 px-4 hidden sm:table-cell">Uploaded At</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {files.map((file) => (
                <tr
                  key={file.id}
                  className="hover:bg-slate-800/30 transition group text-slate-300"
                >
                  {/* Name & Icon */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 rounded-lg bg-slate-800/80 shrink-0">
                        {getFileIcon(file.mimeType)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-white truncate max-w-[200px] sm:max-w-xs" title={file.displayFilename}>
                          {file.displayFilename}
                        </p>
                        {file.originalFilename !== file.displayFilename && (
                          <p className="text-[10px] text-slate-500 truncate" title={`Original: ${file.originalFilename}`}>
                            orig: {file.originalFilename}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Size */}
                  <td className="py-3 px-4 font-mono font-medium text-slate-200 whitespace-nowrap">
                    {formatBytes(file.sizeBytes)}
                  </td>

                  {/* Drive Account Pill */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <div className="flex items-center gap-1.5 text-xs text-slate-300 bg-slate-950/80 px-2.5 py-1 rounded-full border border-slate-800 inline-flex">
                      <HardDrive className="h-3 w-3 text-indigo-400" />
                      <span className="font-mono text-[11px] truncate max-w-[120px]" title={file.driveAccountEmail}>
                        {file.driveAccountEmail}
                      </span>
                    </div>
                  </td>

                  {/* Checksum */}
                  <td className="py-3 px-4 hidden md:table-cell whitespace-nowrap">
                    {file.checksumSha256 ? (
                      <button
                        onClick={() => copyToClipboard(file.checksumSha256!)}
                        className="flex items-center gap-1.5 font-mono text-[10px] text-slate-500 hover:text-slate-300 transition"
                        title="Click to copy full SHA-256 hash"
                      >
                        <span>{file.checksumSha256.slice(0, 12)}...</span>
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
                  <td className="py-3 px-4 hidden sm:table-cell text-slate-400 whitespace-nowrap">
                    {new Date(file.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>

                  {/* Actions */}
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleDownload(file.id, file.displayFilename)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition"
                        title="Download File"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          setRenamingFile(file);
                          setRenameValue(file.displayFilename);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        title="Rename File"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeletingFile(file)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                        title="Soft Delete File"
                      >
                        <Trash2 className="h-4 w-4" />
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
      <div className="p-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
        <div>
          Showing <strong className="text-slate-200">{files.length}</strong> of{' '}
          <strong className="text-slate-200">{meta.total}</strong> files
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 transition"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span>
            Page <strong className="text-white">{page}</strong> of{' '}
            <strong className="text-white">{meta.totalPages || 1}</strong>
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= meta.totalPages}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 transition"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Rename Modal */}
      {renamingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <form
            onSubmit={handleRenameSubmit}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4"
          >
            <h3 className="text-base font-bold text-white">Rename File</h3>
            <p className="text-xs text-slate-400">
              Updates display filename in PostgreSQL and syncs rename with Google Drive.
            </p>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              autoFocus
            />
            <div className="flex items-center justify-end gap-3 pt-2">
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
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition"
              >
                {actionLoading ? 'Renaming...' : 'Save Rename'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Soft Delete Modal */}
      {deletingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-rose-400 flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              <span>Soft Delete File</span>
            </h3>
            <p className="text-xs text-slate-300">
              Are you sure you want to delete <strong className="text-white font-mono">{deletingFile.displayFilename}</strong>?
            </p>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-slate-400 leading-relaxed">
              <strong>Architectural Guarantee:</strong> This application enforces strict soft-deletion (<code className="text-indigo-400">is_deleted = TRUE</code>). The file is immediately omitted from user views while preserving complete database audit history.
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeletingFile(null)}
                disabled={actionLoading}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteSubmit}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium transition"
              >
                {actionLoading ? 'Deleting...' : 'Confirm Soft Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
