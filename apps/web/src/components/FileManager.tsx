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
import { extractFilesFromDataTransfer } from '../lib/file-tree';
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
  onOpenUpload: (preselectedFiles?: File[]) => void;
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
    if (mime.includes('image')) return <FileImage className="h-3.5 w-3.5 text-zinc-300" />;
    if (mime.includes('video')) return <FileVideo className="h-3.5 w-3.5 text-zinc-300" />;
    if (mime.includes('audio')) return <FileAudio className="h-3.5 w-3.5 text-zinc-300" />;
    if (mime.includes('pdf') || mime.includes('text') || mime.includes('document'))
      return <FileText className="h-3.5 w-3.5 text-zinc-300" />;
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip'))
      return <FileArchive className="h-3.5 w-3.5 text-zinc-300" />;
    return <FileGeneric className="h-3.5 w-3.5 text-zinc-400" />;
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
    toast.info(`Streaming ${filename}...`);

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
        document.body.removeChild(a);
        setTimeout(() => window.URL.revokeObjectURL(blobUrl), 10_000); // revoking instantly can cancel the save
        toast.success(`Downloaded ${filename}`);
      })
      .catch((err) => toast.error('Download failed: ' + err.message));
  };

  const submitRename = async () => {
    if (!renamingFile || !renameValue.trim()) return;
    setActionLoading(true);
    try {
      await api.request(`/api/files/${renamingFile.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ displayFilename: renameValue.trim() }),
      });
      toast.success('File renamed successfully');
      setRenamingFile(null);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setActionLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingFile) return;
    setActionLoading(true);
    try {
      await api.request(`/api/files/${deletingFile.id}`, {
        method: 'DELETE',
      });
      toast.success(`Deleted ${deletingFile.displayFilename}`);
      setDeletingFile(null);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    try {
      const queued = await extractFilesFromDataTransfer(e.dataTransfer);
      if (queued.length > 0) {
        onOpenUpload(queued.map((q) => q.file));
      }
    } catch {
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onOpenUpload(Array.from(e.dataTransfer.files));
      }
    }
  };

  const mimeFilters = [
    { label: 'All Files', value: '' },
    { label: 'Documents', value: 'application/pdf,text/,application/msword,application/vnd.openxmlformats*,application/vnd.ms-*' },
    { label: 'Images', value: 'image/' },
    { label: 'Videos', value: 'video/' },
    { label: 'Archives', value: 'application/zip,application/x-tar,application/gzip,application/x-7z-compressed,application/vnd.rar' },
    { label: 'Audio', value: 'audio/' },
  ];

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="bg-zinc-900 border border-zinc-800 rounded-xl relative overflow-hidden"
    >
      {/* Drag & Drop Visual Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-40 bg-zinc-950/90 flex flex-col items-center justify-center border-2 border-dashed border-zinc-600 rounded-xl pointer-events-none animate-in fade-in duration-150">
          <UploadCloud className="h-10 w-10 text-zinc-300 animate-pulse mb-2" />
          <p className="text-sm font-semibold text-zinc-100">Drop file to allocate to Unified Storage</p>
          <p className="text-xs text-zinc-400 mt-1">Direct water-level headroom placement</p>
        </div>
      )}

      {/* Action & Filter Toolbar */}
      <div className="p-3.5 sm:p-4 border-b border-zinc-800 space-y-3 bg-zinc-950/40">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Search bar */}
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Filter files across all drives..."
              className="w-full pl-8 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600/30 transition"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={() => onOpenUpload()}
              disabled={accounts.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Upload</span>
            </button>
          </div>
        </div>

        {/* Secondary Filter Row */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs pt-0.5">
          {/* MIME Filter Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 sm:pb-0">
            {mimeFilters.map((f) => (
              <button
                key={f.value}
                onClick={() => onMimeChange(f.value)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  selectedMime === f.value
                    ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent'
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
              className="px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-300 focus:outline-none focus:border-zinc-700 font-mono"
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
              className="px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-300 focus:outline-none focus:border-zinc-700 font-mono"
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
          <div className="p-4 space-y-2.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-10 bg-zinc-950/60 rounded-md animate-pulse flex items-center justify-between px-3 border border-zinc-800/50"
              >
                <div className="flex items-center gap-3">
                  <div className="h-6 w-6 rounded bg-zinc-800 shrink-0" />
                  <div className="h-3 w-40 bg-zinc-800 rounded" />
                </div>
                <div className="h-3 w-16 bg-zinc-800 rounded hidden sm:block" />
                <div className="h-4 w-24 bg-zinc-800 rounded hidden md:block" />
                <div className="h-4 w-16 bg-zinc-800 rounded" />
              </div>
            ))}
          </div>
        ) : accounts.length === 0 ? (
          /* Graceful Zero-Account Setup Empty State */
          <div className="text-center py-16 px-4 flex flex-col items-center justify-center">
            <div className="h-10 w-10 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center mb-3">
              <HardDrive className="h-5 w-5 text-zinc-400" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-100">No Google Drive Accounts Connected</h3>
            <p className="text-xs text-zinc-400 mt-1 max-w-sm">
              Link your first Google account to aggregate cloud storage into your unified virtual filesystem.
            </p>
            {onOpenAccounts && (
              <button
                onClick={onOpenAccounts}
                className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold transition"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Connect Google Drive</span>
              </button>
            )}
          </div>
        ) : files.length === 0 ? (
          /* Graceful Zero-Files Empty State */
          <div className="text-center py-16 px-4 flex flex-col items-center justify-center text-zinc-500">
            <div className="h-10 w-10 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center mb-3">
              <FileGeneric className="h-5 w-5 text-zinc-500" />
            </div>
            <p className="font-medium text-zinc-300 text-xs">No files matching criteria</p>
            <p className="text-xs text-zinc-500 mt-1 max-w-xs">
              {search || selectedAccount || selectedMime
                ? 'Try adjusting your search query or filter settings.'
                : 'Drop files anywhere on the surface to upload.'}
            </p>
            {!search && !selectedAccount && !selectedMime && (
              <button
                onClick={() => onOpenUpload()}
                className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700 transition"
              >
                <Upload className="h-3.5 w-3.5 text-zinc-300" />
                <span>Upload First File</span>
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400 font-medium uppercase tracking-wider text-[10px]">
                <th className="py-2.5 px-3.5">Name</th>
                <th className="py-2.5 px-3.5">Size</th>
                <th className="py-2.5 px-3.5">Storage Drive</th>
                <th className="py-2.5 px-3.5 hidden md:table-cell">SHA-256 Checksum</th>
                <th className="py-2.5 px-3.5 hidden sm:table-cell">Uploaded At</th>
                <th className="py-2.5 px-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {files.map((file) => (
                <tr
                  key={file.id}
                  className="hover:bg-zinc-800/40 transition-colors group text-zinc-300"
                >
                  {/* Name & Icon */}
                  <td className="py-2 px-3.5">
                    <div
                      onClick={() => setPreviewFile(file)}
                      className="flex items-center gap-2.5 min-w-0 cursor-pointer group/title"
                      title="Click to preview file"
                    >
                      <div className="p-1.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-300 group-hover/title:border-zinc-700 transition shrink-0">
                        {file.displayFilename.endsWith('.enc') ? (
                          <Lock className="h-3.5 w-3.5 text-amber-400" />
                        ) : (
                          getFileIcon(file.mimeType)
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-zinc-200 group-hover/title:text-zinc-100 transition truncate max-w-[200px] sm:max-w-xs" title={file.displayFilename}>
                            {file.displayFilename}
                          </p>
                          {file.displayFilename.endsWith('.enc') && (
                            <span className="px-1 py-0.2 text-[9px] font-mono font-medium bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded shrink-0">
                              ZK
                            </span>
                          )}
                        </div>
                        {file.originalFilename !== file.displayFilename && (
                          <p className="text-[10px] text-zinc-500 truncate font-mono" title={`Original: ${file.originalFilename}`}>
                            orig: {file.originalFilename}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Size */}
                  <td className="py-2 px-3.5 font-mono tabular-nums text-zinc-200 whitespace-nowrap">
                    {formatBytes(file.sizeBytes)}
                  </td>

                  {/* Drive Account Badge */}
                  <td className="py-2 px-3.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5 text-xs text-zinc-300 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800 inline-flex font-mono">
                      <HardDrive className="h-3 w-3 text-zinc-500 shrink-0" />
                      <span className="text-[11px] truncate max-w-[140px]" title={file.driveAccountEmail}>
                        {file.driveAccountEmail}
                      </span>
                    </div>
                  </td>

                  {/* Checksum */}
                  <td className="py-2 px-3.5 hidden md:table-cell whitespace-nowrap">
                    {file.checksumSha256 ? (
                      <button
                        onClick={() => copyToClipboard(file.checksumSha256!)}
                        className="flex items-center gap-1 font-mono text-[10px] text-zinc-500 hover:text-zinc-300 transition"
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
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>

                  {/* Upload Date */}
                  <td className="py-2 px-3.5 hidden sm:table-cell text-zinc-400 whitespace-nowrap text-[11px] font-mono tabular-nums">
                    {new Date(file.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>

                  {/* Inline Action Buttons */}
                  <td className="py-2 px-3.5 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setPreviewFile(file)}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
                        title="Preview / Stream File"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDownload(file.id, file.displayFilename)}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
                        title="Download File"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setRenamingFile(file);
                          setRenameValue(file.displayFilename);
                        }}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
                        title="Rename File"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeletingFile(file)}
                        className="p-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 transition"
                        title="Delete File"
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

      {/* Pagination Bar */}
      {meta.totalPages > 1 && (
        <div className="p-3 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between text-xs text-zinc-400">
          <div className="text-[11px] font-mono tabular-nums">
            Showing <strong className="text-zinc-200">{(page - 1) * meta.pageSize + 1}</strong> to{' '}
            <strong className="text-zinc-200">{Math.min(page * meta.pageSize, meta.total)}</strong> of{' '}
            <strong className="text-zinc-200">{meta.total}</strong> files
          </div>

          <div className="flex items-center gap-1.5 font-mono">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="p-1.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 transition"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-2 py-0.5 text-zinc-300 tabular-nums">
              {page} / {meta.totalPages}
            </span>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= meta.totalPages}
              className="p-1.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 transition"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Rename Dialog Modal */}
      {renamingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 max-w-sm w-full space-y-4 shadow-xl">
            <h3 className="text-sm font-semibold text-zinc-100">Rename File</h3>
            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">New Filename</label>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setRenamingFile(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
              >
                Cancel
              </button>
              <button
                onClick={submitRename}
                disabled={actionLoading || !renameValue.trim()}
                className="px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold disabled:opacity-40 transition"
              >
                {actionLoading ? 'Saving...' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 max-w-sm w-full space-y-4 shadow-xl">
            <h3 className="text-sm font-semibold text-rose-400">Confirm Deletion</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Are you sure you want to delete <strong className="text-zinc-200">{deletingFile.displayFilename}</strong>? The file is permanently removed from Google Drive and its space is freed. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setDeletingFile(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={actionLoading}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold disabled:opacity-40 transition"
              >
                {actionLoading ? 'Deleting...' : 'Delete File'}
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
