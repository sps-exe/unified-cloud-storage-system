import React, { useState, useRef } from 'react';
import { X, UploadCloud, File, AlertCircle, HardDrive } from './icons';
import { api, formatBytes, resolveUrl } from '../lib/api';
import type { DriveAccountDto } from '@ucss/shared';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: DriveAccountDto[];
  onUploadComplete: () => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  accounts,
  onUploadComplete,
}) => {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('auto');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      // 1. Pre-flight allocation
      setUploadProgress(30);
      const allocPayload: Record<string, unknown> = {
        originalFilename: selectedFile.name,
        displayFilename: displayName || selectedFile.name,
        fileSizeBytes: selectedFile.size,
        mimeType: selectedFile.type || 'application/octet-stream',
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
      formData.append('file', selectedFile);
      formData.append('fileId', allocRes.data.fileId);
      formData.append('uploadOperationId', allocRes.data.uploadOperationId);
      formData.append('displayFilename', displayName || selectedFile.name);
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
      setTimeout(() => {
        setIsUploading(false);
        onUploadComplete();
        onClose();
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UploadCloud className="h-5 w-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white">Upload File to Unified Storage</h2>
          </div>
          <button
            onClick={onClose}
            disabled={isUploading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="h-5 w-5" />
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
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
                dragOver
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : 'border-slate-700 hover:border-slate-600 bg-slate-950/40'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileChange}
              />
              <UploadCloud className="h-10 w-10 text-indigo-400 mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-200">
                Drag & drop a file here, or click to browse
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Supports all file types up to 100 MB per file
              </p>
            </div>
          ) : (
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                  <File className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{selectedFile.name}</p>
                  <p className="text-xs text-slate-400">{formatBytes(selectedFile.size)}</p>
                </div>
              </div>
              <button
                onClick={() => { setSelectedFile(null); setDisplayName(''); }}
                disabled={isUploading}
                className="p-1 rounded text-slate-400 hover:text-rose-400 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Display Name Input */}
          {selectedFile && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Display Name (Optional)
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={isUploading}
                placeholder={selectedFile.name}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}

          {/* Destination Google Drive Account Selection */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="font-medium text-slate-300 flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 text-indigo-400" />
                <span>Target Google Account</span>
              </label>
              <span className="text-[11px] text-slate-500">
                {selectedAccountId === 'auto' ? '⚡ Auto-Load Balanced' : 'Direct Selection'}
              </span>
            </div>

            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              disabled={isUploading || activeAccounts.length === 0}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
            >
              <option value="auto">
                ⚡ Auto-Select (Highest Headroom: {bestAccount ? bestAccount.googleEmail : 'None'})
              </option>
              {activeAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.googleEmail} ({formatBytes(acc.quotaAvailableBytes)} free)
                </option>
              ))}
            </select>

            {targetAccount ? (
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2.5 flex items-center justify-between text-xs">
                <span className="text-slate-400 truncate max-w-[240px]">
                  Routing to: <strong className="text-slate-200 font-mono">{targetAccount.googleEmail}</strong>
                </span>
                <span className="text-emerald-400 font-mono text-[11px] shrink-0">
                  {formatBytes(targetAccount.quotaAvailableBytes)} headroom
                </span>
              </div>
            ) : (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center gap-2 text-xs text-amber-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>No active Google Drive accounts connected. Connect an account first.</span>
              </div>
            )}

            <p className="text-[11px] text-slate-500 flex items-center gap-1 pt-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block shrink-0" />
              <span>500 MB safety margin enforced per account to prevent hard quota boundary errors.</span>
            </p>
          </div>

          {/* Progress bar */}
          {isUploading && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Streaming upload to Google Drive...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  style={{ width: `${uploadProgress}%` }}
                  className="h-full bg-indigo-500 transition-all duration-300"
                />
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 bg-slate-950/60 border-t border-slate-800 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isUploading}
            className="px-4 py-2 text-xs font-medium rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!selectedFile || isUploading || !bestAccount}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white shadow-lg shadow-indigo-600/20 transition flex items-center gap-2"
          >
            {isUploading ? (
              <>
                <span className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
