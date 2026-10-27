import React, { useState, useRef, useEffect } from 'react';
import { X, UploadCloud, File, AlertCircle, HardDrive, Lock, Key, Folder, CheckCircle2 } from './icons';
import { api, formatBytes, resolveUrl } from '../lib/api';
import { encryptFileClientSide } from '../lib/zk-crypto';
import { extractFilesFromDataTransfer, type QueuedFile } from '../lib/file-tree';
import { useToast } from './Toast';
import type { DriveAccountDto } from '@ucss/shared';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: DriveAccountDto[];
  onUploadComplete: () => void;
  initialFile?: File | null;
  initialFiles?: File[] | null;
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  accounts,
  onUploadComplete,
  initialFile = null,
  initialFiles = null,
}) => {
  const toast = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('auto');
  const [isUploading, setIsUploading] = useState(false);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [currentFileProgress, setCurrentFileProgress] = useState(0);
  const [overallProgress, setOverallProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [encryptVault, setEncryptVault] = useState(false);
  const [vaultPassphrase, setVaultPassphrase] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Set webkitdirectory attribute on folder input
  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, [isOpen]);

  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      const q: QueuedFile[] = initialFiles.map((f) => ({
        file: f,
        relativePath: f.webkitRelativePath || f.name,
      }));
      setQueue(q);
      if (q.length === 1) setDisplayName(q[0].file.name);
      setError(null);
    } else if (initialFile) {
      setQueue([{ file: initialFile, relativePath: initialFile.name }]);
      setDisplayName(initialFile.name);
      setError(null);
    }
  }, [initialFile, initialFiles]);

  if (!isOpen) return null;

  // Active accounts with highest headroom
  const activeAccounts = accounts.filter((a) => a.status === 'ACTIVE');
  const bestAccount = [...activeAccounts].sort((a, b) => {
    const availA = Number(a.quotaAvailableBytes) || 0;
    const availB = Number(b.quotaAvailableBytes) || 0;
    return availB - availA;
  })[0];

  const targetAccount = selectedAccountId === 'auto'
    ? bestAccount
    : (activeAccounts.find((a) => a.id === selectedAccountId) || bestAccount);

  const totalBatchBytes = queue.reduce((sum, item) => sum + item.file.size, 0);

  // Extract folder name if files belong to a common directory
  const detectedFolderName = (() => {
    if (queue.length <= 1) return null;
    const paths = queue.map((q) => q.relativePath).filter((p) => p.includes('/'));
    if (paths.length === 0) return null;
    const firstSegment = paths[0].split('/')[0];
    const allMatch = paths.every((p) => p.startsWith(`${firstSegment}/`));
    return allMatch ? firstSegment : null;
  })();

  const handleFilesSelected = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const q: QueuedFile[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      q.push({ file: f, relativePath: f.webkitRelativePath || f.name });
    }
    setQueue(q);
    if (q.length === 1) setDisplayName(q[0].file.name);
    setError(null);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    try {
      const files = await extractFilesFromDataTransfer(e.dataTransfer);
      if (files.length > 0) {
        setQueue(files);
        if (files.length === 1) setDisplayName(files[0].file.name);
        setError(null);
      }
    } catch {
      // Fallback to standard files list
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  const removeItem = (index: number) => {
    const updated = queue.filter((_, i) => i !== index);
    setQueue(updated);
    if (updated.length === 1) setDisplayName(updated[0].file.name);
  };

  // Upload a single file with pre-flight reservation & pass-through streaming
  const uploadSingleItem = async (
    item: QueuedFile,
    overrideDisplayName?: string,
  ): Promise<void> => {
    let fileToUpload = item.file;
    let finalDisplayName = overrideDisplayName || item.relativePath || item.file.name;

    if (encryptVault) {
      if (!vaultPassphrase.trim()) {
        throw new Error('Please enter a master passphrase for zero-knowledge encryption');
      }
      fileToUpload = await encryptFileClientSide(item.file, vaultPassphrase.trim());
      if (!finalDisplayName.endsWith('.enc')) {
        finalDisplayName = `${finalDisplayName}.enc`;
      }
    }

    // 1. Pre-flight allocation
    const allocPayload: Record<string, unknown> = {
      originalFilename: fileToUpload.name,
      displayFilename: finalDisplayName,
      fileSizeBytes: fileToUpload.size,
      mimeType: encryptVault ? 'application/octet-stream' : (fileToUpload.type || 'application/octet-stream'),
    };
    if (selectedAccountId && selectedAccountId !== 'auto') {
      allocPayload.driveAccountId = selectedAccountId;
    }

    const allocRes = await api.request<{
      fileId: string;
      uploadOperationId: string;
      driveAccountId: string;
      googleEmail: string;
    }>('/api/files/allocate', {
      method: 'POST',
      body: JSON.stringify(allocPayload),
    });

    // 2. Multipart upload
    const formData = new FormData();
    formData.append('file', fileToUpload);
    formData.append('fileId', allocRes.data.fileId);
    formData.append('uploadOperationId', allocRes.data.uploadOperationId);
    formData.append('displayFilename', finalDisplayName);
    if (selectedAccountId && selectedAccountId !== 'auto') {
      formData.append('driveAccountId', selectedAccountId);
    }

    const token = api.getToken();
    const res = await fetch(resolveUrl('/api/files/upload'), {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
      credentials: 'include',
    });

    const body = await res.json();
    if (!res.ok || !body.ok) {
      throw new Error(body.error?.message || `Upload failed for ${item.file.name}`);
    }
  };

  const handleBatchUpload = async () => {
    if (queue.length === 0) return;

    setIsUploading(true);
    setError(null);
    setCurrentFileIndex(0);
    setCurrentFileProgress(10);
    setOverallProgress(5);

    try {
      let successCount = 0;
      for (let i = 0; i < queue.length; i++) {
        setCurrentFileIndex(i);
        setCurrentFileProgress(20);

        const currentItem = queue[i];
        const nameOverride = (queue.length === 1 && displayName) ? displayName : undefined;

        await uploadSingleItem(currentItem, nameOverride);
        successCount++;

        setCurrentFileProgress(100);
        const overall = Math.round(((i + 1) / queue.length) * 100);
        setOverallProgress(overall);
      }

      if (queue.length === 1) {
        toast.success(`Uploaded "${displayName || queue[0].file.name}" successfully!`);
      } else {
        toast.success(`Batch complete: ${successCount} files uploaded successfully!`);
      }

      setTimeout(() => {
        setIsUploading(false);
        onUploadComplete();
        onClose();
      }, 500);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Upload failed';
      setError(errMsg);
      toast.error(errMsg);
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UploadCloud className="h-4 w-4 text-zinc-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              {queue.length > 1 ? 'Batch / Folder Upload' : 'Upload to Virtual Storage'}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={isUploading}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Dropzone */}
          {queue.length === 0 ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border border-dashed rounded-lg p-7 text-center transition ${
                dragOver
                  ? 'border-zinc-400 bg-zinc-800/40'
                  : 'border-zinc-800 hover:border-zinc-700 bg-zinc-950/60'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />
              <input
                ref={folderInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />

              <UploadCloud className="h-8 w-8 text-zinc-400 mx-auto mb-2.5" />
              <p className="text-xs font-medium text-zinc-200">
                Drag & drop files or an entire folder here
              </p>
              <p className="text-[11px] text-zinc-500 mt-1 font-mono">
                Preserves folder directory structures & auto-balances across Drive accounts
              </p>

              {/* Action Buttons */}
              <div className="flex items-center justify-center gap-2.5 mt-4">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-medium rounded-md transition flex items-center gap-1.5"
                >
                  <File className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Choose Files</span>
                </button>
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-medium rounded-md transition flex items-center gap-1.5"
                >
                  <Folder className="h-3.5 w-3.5 text-amber-400" />
                  <span>Choose Folder</span>
                </button>
              </div>
            </div>
          ) : queue.length === 1 ? (
            /* Single file view */
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 shrink-0">
                  <File className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-200 truncate">{queue[0].file.name}</p>
                  <p className="text-[11px] text-zinc-400 font-mono tabular-nums">{formatBytes(queue[0].file.size)}</p>
                </div>
              </div>
              <button
                onClick={() => { setQueue([]); setDisplayName(''); }}
                disabled={isUploading}
                className="p-1 rounded text-zinc-400 hover:text-rose-400 transition"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            /* Multi-file / Folder batch view */
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2.5">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-7 w-7 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center text-amber-400 shrink-0">
                    <Folder className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-zinc-200 truncate">
                      {detectedFolderName ? `Folder: ${detectedFolderName}` : `Batch Queue: ${queue.length} files`}
                    </p>
                    <p className="text-[10px] text-zinc-400 font-mono tabular-nums">
                      {queue.length} files • {formatBytes(totalBatchBytes)} total
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setQueue([])}
                  disabled={isUploading}
                  className="text-[11px] text-zinc-400 hover:text-rose-400 transition font-mono px-2 py-0.5 rounded border border-zinc-800 hover:border-zinc-700"
                >
                  Clear All
                </button>
              </div>

              {/* Scrollable File Items */}
              <div className="max-h-36 overflow-y-auto space-y-1 pr-1 font-mono text-[11px]">
                {queue.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-1.5 rounded bg-zinc-900/60 border border-zinc-800/50 hover:border-zinc-700"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 truncate">
                      <File className="h-3 w-3 text-zinc-500 shrink-0" />
                      <span className="truncate text-zinc-300">{item.relativePath}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-zinc-500 tabular-nums">{formatBytes(item.file.size)}</span>
                      {!isUploading && (
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="text-zinc-600 hover:text-rose-400"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Display Name Input (Only for single file) */}
          {queue.length === 1 && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Display Name (Optional)
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={isUploading}
                placeholder={queue[0].file.name}
                className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 font-mono"
              />
            </div>
          )}

          {/* Destination Google Drive Account Selection */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="font-medium text-zinc-400 flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 text-zinc-400" />
                <span>Target Google Drive Allocation</span>
              </label>
              <span className="text-[11px] text-zinc-500 font-mono">
                {selectedAccountId === 'auto' ? 'Water-Level Balancing' : 'Pinned Account'}
              </span>
            </div>

            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              disabled={isUploading || activeAccounts.length === 0}
              className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 font-mono"
            >
              <option value="auto">
                Auto-Balance Across Nodes (Top Node: {bestAccount ? bestAccount.googleEmail : 'None'})
              </option>
              {activeAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.googleEmail} ({formatBytes(acc.quotaAvailableBytes)} free)
                </option>
              ))}
            </select>

            {targetAccount ? (
              <div className="bg-zinc-950 border border-zinc-800/80 rounded-md p-2.5 flex items-center justify-between text-xs">
                <span className="text-zinc-400 truncate max-w-[240px] font-mono text-[11px]">
                  Routing to: <strong className="text-zinc-200">{targetAccount.googleEmail}</strong>
                </span>
                <span className="text-emerald-400 font-mono tabular-nums text-[11px] shrink-0">
                  {formatBytes(targetAccount.quotaAvailableBytes)} headroom
                </span>
              </div>
            ) : (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-2.5 flex items-center gap-2 text-xs text-amber-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>No active Google Drive accounts connected. Connect an account first.</span>
              </div>
            )}
          </div>

          {/* Zero-Knowledge Client-Side Encryption Toggle */}
          <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-amber-400" />
                <div>
                  <span className="text-xs font-medium text-zinc-200 block">Zero-Knowledge Vault</span>
                  <span className="text-[10px] text-zinc-500 font-mono">Encrypt with AES-256-GCM before transmission</span>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={encryptVault}
                  onChange={(e) => setEncryptVault(e.target.checked)}
                  disabled={isUploading}
                  className="sr-only peer"
                />
                <div className="w-8 h-4 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-700 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500"></div>
              </label>
            </div>

            {encryptVault && (
              <div className="space-y-1.5 pt-2 border-t border-zinc-800/80">
                <label className="text-[11px] text-zinc-400 block font-mono">
                  Master Passphrase (NEVER sent to backend or Google)
                </label>
                <div className="relative">
                  <Key className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
                  <input
                    type="password"
                    value={vaultPassphrase}
                    onChange={(e) => setVaultPassphrase(e.target.value)}
                    placeholder="Enter strong encryption passphrase"
                    disabled={isUploading}
                    className="w-full pl-8 pr-3 py-1 bg-zinc-900 border border-zinc-800 rounded-md text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500 font-mono"
                    required={encryptVault}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Progress bar */}
          {isUploading && (
            <div className="space-y-2 p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
              <div className="flex justify-between text-xs text-zinc-300 font-mono tabular-nums">
                <span className="truncate max-w-[280px]">
                  {queue.length > 1
                    ? `[${currentFileIndex + 1}/${queue.length}] ${queue[currentFileIndex]?.file.name}`
                    : `Streaming: ${queue[0]?.file.name}`}
                </span>
                <span className="text-emerald-400">{currentFileProgress}%</span>
              </div>
              <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                <div
                  style={{ width: `${currentFileProgress}%` }}
                  className="h-full bg-emerald-500 transition-all duration-200"
                />
              </div>

              {queue.length > 1 && (
                <div className="pt-1.5 border-t border-zinc-800/60">
                  <div className="flex justify-between text-[11px] text-zinc-500 font-mono tabular-nums mb-1">
                    <span>Overall Batch Progress</span>
                    <span>{overallProgress}%</span>
                  </div>
                  <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${overallProgress}%` }}
                      className="h-full bg-blue-500 transition-all duration-200"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-md text-xs text-rose-400 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-zinc-950/60 border-t border-zinc-800 flex items-center justify-between">
          <div className="text-[11px] text-zinc-500 font-mono">
            {queue.length > 0 && (
              <span>
                {queue.length} {queue.length === 1 ? 'file' : 'files'} selected ({formatBytes(totalBatchBytes)})
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              disabled={isUploading}
              className="px-3.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition"
            >
              Cancel
            </button>
            <button
              onClick={handleBatchUpload}
              disabled={queue.length === 0 || isUploading || !bestAccount}
              className="px-4 py-1.5 text-xs font-medium rounded-md bg-zinc-100 hover:bg-white disabled:opacity-50 text-zinc-950 transition flex items-center gap-2"
            >
              {isUploading ? (
                <>
                  <span className="h-3 w-3 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin" />
                  <span>Uploading {queue.length > 1 ? `(${currentFileIndex + 1}/${queue.length})` : ''}...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Start Upload {queue.length > 1 ? `(${queue.length} files)` : ''}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
