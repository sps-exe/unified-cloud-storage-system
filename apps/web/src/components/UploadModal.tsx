import React, { useState, useRef, useEffect } from 'react';
import { X, UploadCloud, File, AlertCircle, HardDrive, Lock, Key } from './icons';
import { api, formatBytes, resolveUrl } from '../lib/api';
import { encryptFileClientSide } from '../lib/zk-crypto';
import { useToast } from './Toast';
import type { DriveAccountDto } from '@ucss/shared';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: DriveAccountDto[];
  onUploadComplete: () => void;
  initialFile?: File | null;
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  accounts,
  onUploadComplete,
  initialFile = null,
}) => {
  const toast = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('auto');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [encryptVault, setEncryptVault] = useState(false);
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialFile) {
      setSelectedFile(initialFile);
      setDisplayName(initialFile.name);
      setError(null);
    }
  }, [initialFile]);

  if (!isOpen) return null;

  // Find optimal account based on highest headroom
  const activeAccounts = accounts.filter((a) => a.status === 'ACTIVE');
  const bestAccount = [...activeAccounts].sort((a, b) => {
    const availA = Number(a.quotaAvailableBytes) || 0;
    const availB = Number(b.quotaAvailableBytes) || 0;
    return availB - availA;
  })[0];

  const targetAccount = selectedAccountId === 'auto'
    ? bestAccount
    : (activeAccounts.find((a) => a.id === selectedAccountId) || bestAccount);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setDisplayName(file.name);
      setError(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      setDisplayName(file.name);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadProgress(10);
    setError(null);

    try {
      let fileToUpload = selectedFile;
      let finalDisplayName = displayName || selectedFile.name;

      if (encryptVault) {
        if (!vaultPassphrase.trim()) {
          throw new Error('Please enter a master passphrase for zero-knowledge encryption');
        }
        setUploadProgress(15);
        fileToUpload = await encryptFileClientSide(selectedFile, vaultPassphrase.trim());
        if (!finalDisplayName.endsWith('.enc')) {
          finalDisplayName = `${finalDisplayName}.enc`;
        }
      }

      // 1. Pre-flight allocation
      setUploadProgress(30);
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

      setUploadProgress(50);

      // 2. Multipart upload
      const formData = new FormData();
      formData.append('file', fileToUpload);
      formData.append('fileId', allocRes.data.fileId);
      formData.append('uploadOperationId', allocRes.data.uploadOperationId);
      formData.append('displayFilename', finalDisplayName);
      if (selectedAccountId && selectedAccountId !== 'auto') {
        formData.append('driveAccountId', selectedAccountId);
      }

      setUploadProgress(70);

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
        throw new Error(body.error?.message || 'Upload failed');
      }

      setUploadProgress(100);
      toast.success(`Uploaded "${finalDisplayName}" successfully!`);
      setTimeout(() => {
        setIsUploading(false);
        onUploadComplete();
        onClose();
      }, 400);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Upload failed';
      setError(errMsg);
      toast.error(errMsg);
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UploadCloud className="h-4 w-4 text-zinc-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Upload to Virtual Storage</h2>
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
        <div className="p-6 space-y-4">
          {/* Dropzone */}
          {!selectedFile ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border border-dashed rounded-lg p-7 text-center cursor-pointer transition ${
                dragOver
                  ? 'border-zinc-400 bg-zinc-800/40'
                  : 'border-zinc-800 hover:border-zinc-700 bg-zinc-950/60'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileChange}
              />
              <UploadCloud className="h-8 w-8 text-zinc-400 mx-auto mb-2.5" />
              <p className="text-xs font-medium text-zinc-200">
                Drag & drop a file here, or click to browse
              </p>
              <p className="text-[11px] text-zinc-500 mt-1 font-mono">
                Supports all file types up to 100 MB per file
              </p>
            </div>
          ) : (
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 shrink-0">
                  <File className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-200 truncate">{selectedFile.name}</p>
                  <p className="text-[11px] text-zinc-400 font-mono tabular-nums">{formatBytes(selectedFile.size)}</p>
                </div>
              </div>
              <button
                onClick={() => { setSelectedFile(null); setDisplayName(''); }}
                disabled={isUploading}
                className="p-1 rounded text-zinc-400 hover:text-rose-400 transition"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Display Name Input */}
          {selectedFile && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Display Name (Optional)
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={isUploading}
                placeholder={selectedFile.name}
                className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 font-mono"
              />
            </div>
          )}

          {/* Destination Google Drive Account Selection */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="font-medium text-zinc-400 flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 text-zinc-400" />
                <span>Target Google Drive Account</span>
              </label>
              <span className="text-[11px] text-zinc-500 font-mono">
                {selectedAccountId === 'auto' ? 'Dynamic Load-Balanced' : 'Direct Selection'}
              </span>
            </div>

            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              disabled={isUploading || activeAccounts.length === 0}
              className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 font-mono"
            >
              <option value="auto">
                Auto-Select (Highest Headroom: {bestAccount ? bestAccount.googleEmail : 'None'})
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

            <p className="text-[11px] text-zinc-500 flex items-center gap-1.5 pt-0.5 font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block shrink-0" />
              <span>500 MB safety margin enforced per account to prevent hard quota boundary errors.</span>
            </p>
          </div>

          {/* Zero-Knowledge Client-Side Encryption Toggle */}
          <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-amber-400" />
                <div>
                  <span className="text-xs font-medium text-zinc-200 block">Zero-Knowledge Vault</span>
                  <span className="text-[10px] text-zinc-500 font-mono">Encrypt with client-side AES-256-GCM before upload</span>
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
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-zinc-400 font-mono tabular-nums">
                <span>Streaming upload to Google Drive...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                <div
                  style={{ width: `${uploadProgress}%` }}
                  className="h-full bg-emerald-500 transition-all duration-300"
                />
              </div>
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
        <div className="px-6 py-3.5 bg-zinc-950/60 border-t border-zinc-800 flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            disabled={isUploading}
            className="px-3.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!selectedFile || isUploading || !bestAccount}
            className="px-4 py-1.5 text-xs font-medium rounded-md bg-zinc-100 hover:bg-white disabled:opacity-50 text-zinc-950 transition flex items-center gap-2"
          >
            {isUploading ? (
              <>
                <span className="h-3 w-3 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin" />
                <span>Uploading...</span>
              </>
            ) : (
              <span>Start Upload</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
