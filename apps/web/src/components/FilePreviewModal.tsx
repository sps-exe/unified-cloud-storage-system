// =============================================================================
// UCSS Web — Interactive File Preview & Media Player Modal
// =============================================================================
// Features:
//   - Inline HTTP 206 Range video streaming with seek controls
//   - Audio playback player
//   - High-resolution image zoom viewer
//   - PDF document reader
//   - Formatted code/text viewer with line numbers and copy
//   - In-memory Zero-Knowledge AES-256-GCM client-side decryption
// =============================================================================

import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  Lock,
  Key,
  Copy,
  Check,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  File as FileGeneric,
  HardDrive,
  AlertCircle,
  RefreshCw,
} from './icons';
import { api, resolveUrl } from '../lib/api';
import { decryptFileClientSide } from '../lib/zk-crypto';

export interface FileItem {
  id: string;
  originalFilename: string;
  displayFilename: string;
  mimeType: string;
  sizeBytes: string;
  checksumSha256: string | null;
  driveAccountEmail: string;
  createdAt: string;
  uploadStatus: string;
}

interface FilePreviewModalProps {
  file: FileItem | null;
  onClose: () => void;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({ file, onClose }) => {
  if (!file) return null;

  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [copiedSha, setCopiedSha] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Zero-Knowledge Decryption States
  const isEncrypted = file.displayFilename.endsWith('.enc');
  const [passphrase, setPassphrase] = useState('');
  const [decrypting, setDecrypting] = useState(false);
  const [decryptionError, setDecryptionError] = useState<string | null>(null);
  const [decryptedBlobUrl, setDecryptedBlobUrl] = useState<string | null>(null);
  const [decryptedMimeType, setDecryptedMimeType] = useState<string>('application/octet-stream');

  const token = api.getToken();
  const streamUrl = resolveUrl(`/api/files/${file.id}/stream?token=${encodeURIComponent(token || '')}`);
  const downloadUrl = resolveUrl(`/api/files/${file.id}/download`);

  const isImage = file.mimeType.startsWith('image/');
  const isVideo = file.mimeType.startsWith('video/');
  const isAudio = file.mimeType.startsWith('audio/');
  const isPdf = file.mimeType === 'application/pdf' || file.displayFilename.toLowerCase().endsWith('.pdf');
  const isTextOrCode =
    file.mimeType.startsWith('text/') ||
    file.mimeType.includes('json') ||
    file.mimeType.includes('javascript') ||
    file.mimeType.includes('typescript') ||
    file.mimeType.includes('xml') ||
    /\.(txt|md|json|js|ts|tsx|jsx|py|html|css|yaml|yml|sql|sh|env)$/i.test(file.displayFilename);

  // Fetch text file contents
  useEffect(() => {
    if (isTextOrCode && !isEncrypted) {
      setLoadingText(true);
      setTextError(null);
      fetch(streamUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then((text) => {
          setTextContent(text);
          setLoadingText(false);
        })
        .catch((err) => {
          setTextError('Failed to load text preview: ' + err.message);
          setLoadingText(false);
        });
    }
  }, [file.id, isTextOrCode, isEncrypted, streamUrl]);

  // Clean up decrypted blob URL
  useEffect(() => {
    return () => {
      if (decryptedBlobUrl) {
        window.URL.revokeObjectURL(decryptedBlobUrl);
      }
    };
  }, [decryptedBlobUrl]);

  const copyToClipboard = (text: string, type: 'sha' | 'code') => {
    navigator.clipboard.writeText(text);
    if (type === 'sha') {
      setCopiedSha(true);
      setTimeout(() => setCopiedSha(false), 2000);
    } else {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleDownloadOriginal = () => {
    fetch(downloadUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    })
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.displayFilename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      })
      .catch((err) => alert('Download failed: ' + err.message));
  };

  const handleDecrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim()) return;

    setDecrypting(true);
    setDecryptionError(null);

    try {
      const res = await fetch(downloadUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to download encrypted container');

      const encryptedBuffer = await res.arrayBuffer();
      const decryptedBytes = await decryptFileClientSide(encryptedBuffer, passphrase.trim());

      // Attempt to guess mime type from base filename
      const baseName = file.displayFilename.replace(/\.enc$/, '');
      let mime = 'application/octet-stream';
      if (/\.(png|jpe?g|gif|webp|svg)$/i.test(baseName)) mime = 'image/png';
      else if (/\.(mp4|webm|mov)$/i.test(baseName)) mime = 'video/mp4';
      else if (/\.(mp3|wav|ogg)$/i.test(baseName)) mime = 'audio/mpeg';
      else if (/\.pdf$/i.test(baseName)) mime = 'application/pdf';
      else if (/\.(txt|json|md|py|js|ts)$/i.test(baseName)) mime = 'text/plain';

      const blob = new Blob([decryptedBytes as unknown as BlobPart], { type: mime });
      const url = window.URL.createObjectURL(blob);

      setDecryptedMimeType(mime);
      setDecryptedBlobUrl(url);

      if (mime.startsWith('text/')) {
        const dec = new TextDecoder();
        setTextContent(dec.decode(decryptedBytes));
      }
    } catch (err) {
      setDecryptionError(err instanceof Error ? err.message : 'Decryption failed');
    } finally {
      setDecrypting(false);
    }
  };

  const formatBytes = (bytesStr: string) => {
    try {
      const b = BigInt(bytesStr);
      if (b < 1024n) return `${b} B`;
      if (b < 1048576n) return `${(Number(b) / 1024).toFixed(1)} KB`;
      if (b < 1073741824n) return `${(Number(b) / 1048576).toFixed(1)} MB`;
      return `${(Number(b) / 1073741824).toFixed(2)} GB`;
    } catch {
      return bytesStr;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header Bar */}
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between gap-4 bg-zinc-950/60">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-zinc-800 border border-zinc-700/80 text-zinc-300 shrink-0">
              {isEncrypted ? (
                <Lock className="h-4 w-4 text-amber-400" />
              ) : isVideo ? (
                <FileVideo className="h-4 w-4 text-zinc-300" />
              ) : isAudio ? (
                <FileAudio className="h-4 w-4 text-zinc-300" />
              ) : isImage ? (
                <FileImage className="h-4 w-4 text-zinc-300" />
              ) : isTextOrCode ? (
                <FileText className="h-4 w-4 text-zinc-300" />
              ) : (
                <FileGeneric className="h-4 w-4 text-zinc-300" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-medium font-mono text-zinc-100 truncate max-w-xs sm:max-w-md md:max-w-xl" title={file.displayFilename}>
                  {file.displayFilename}
                </h3>
                {isEncrypted && (
                  <span className="px-1.5 py-0.5 text-[10px] font-mono font-medium bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded">
                    ZK-Encrypted
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2.5 mt-0.5 text-[11px] text-zinc-400 font-mono tabular-nums">
                <span>{formatBytes(file.sizeBytes)}</span>
                <span className="text-zinc-600">•</span>
                <span className="inline-flex items-center gap-1 text-zinc-300">
                  <HardDrive className="h-3 w-3 text-zinc-400" />
                  {file.driveAccountEmail}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDownloadOriginal}
              className="px-3 py-1.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium flex items-center gap-1.5 transition"
              title="Download File"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Download</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
              title="Close Preview"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Preview Viewer Body */}
        <div className="flex-1 overflow-auto bg-zinc-950 flex flex-col items-center justify-center min-h-[380px] p-4">
          {/* ── Case 1: ZK-Encrypted File Locked ── */}
          {isEncrypted && !decryptedBlobUrl && (
            <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center shadow-xl space-y-4">
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-zinc-100">Zero-Knowledge Encrypted Vault</h4>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed font-sans">
                  This file was encrypted in your browser using AES-256-GCM before being stored on Google Drive.
                  Enter the master passphrase to decrypt and view it in memory.
                </p>
              </div>

              <form onSubmit={handleDecrypt} className="space-y-3">
                <div className="relative text-left">
                  <label className="text-[11px] font-mono text-zinc-400 block mb-1">
                    Decryption Passphrase
                  </label>
                  <div className="relative">
                    <Key className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Enter passphrase used during upload"
                      className="w-full pl-8 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500 font-mono"
                      required
                    />
                  </div>
                </div>

                {decryptionError && (
                  <div className="p-2.5 rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2 text-left font-mono">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{decryptionError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={decrypting || !passphrase.trim()}
                  className="w-full py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-zinc-950 text-xs font-medium rounded-md transition flex items-center justify-center gap-2"
                >
                  {decrypting ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Decrypting In-Memory...</span>
                    </>
                  ) : (
                    <>
                      <Key className="h-3.5 w-3.5" />
                      <span>Decrypt & View</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          )}

          {/* ── Case 2: Video Player (Stream with Range Seeking) ── */}
          {(isVideo || (decryptedBlobUrl && decryptedMimeType.startsWith('video/'))) && (
            <div className="w-full h-full flex flex-col items-center justify-center">
              <video
                src={decryptedBlobUrl || streamUrl}
                controls
                playsInline
                autoPlay
                className="max-h-[70vh] max-w-full rounded-lg shadow-2xl border border-zinc-800 bg-black"
              >
                Your browser does not support HTML5 video streaming.
              </video>
            </div>
          )}

          {/* ── Case 3: Audio Player ── */}
          {(isAudio || (decryptedBlobUrl && decryptedMimeType.startsWith('audio/'))) && (
            <div className="max-w-lg w-full bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center space-y-4 shadow-2xl">
              <div className="h-14 w-14 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 flex items-center justify-center mx-auto">
                <FileAudio className="h-7 w-7" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-zinc-100 font-mono truncate">{file.displayFilename}</h4>
                <p className="text-xs text-zinc-400 mt-1">Direct stream from Google Drive pool</p>
              </div>
              <audio
                src={decryptedBlobUrl || streamUrl}
                controls
                autoPlay
                className="w-full rounded-md"
              />
            </div>
          )}

          {/* ── Case 4: Image Viewer ── */}
          {(isImage || (decryptedBlobUrl && decryptedMimeType.startsWith('image/'))) && (
            <div className="max-h-[72vh] flex items-center justify-center overflow-auto p-2">
              <img
                src={decryptedBlobUrl || streamUrl}
                alt={file.displayFilename}
                className="max-h-[68vh] max-w-full rounded-lg object-contain shadow-2xl border border-zinc-800"
              />
            </div>
          )}

          {/* ── Case 5: PDF Viewer ── */}
          {(isPdf || (decryptedBlobUrl && decryptedMimeType === 'application/pdf')) && (
            <div className="w-full h-[72vh]">
              <iframe
                src={decryptedBlobUrl || streamUrl}
                title={file.displayFilename}
                className="w-full h-full rounded-lg border border-zinc-800 bg-white"
              />
            </div>
          )}

          {/* ── Case 6: Text / Code Viewer ── */}
          {(isTextOrCode || (decryptedBlobUrl && decryptedMimeType.startsWith('text/'))) && (
            <div className="w-full h-[72vh] flex flex-col bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden shadow-2xl">
              <div className="px-4 py-2 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between text-xs text-zinc-400 font-mono">
                <span>{textContent ? `${textContent.split('\n').length} lines` : 'Loading...'}</span>
                {textContent && (
                  <button
                    onClick={() => copyToClipboard(textContent, 'code')}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition"
                  >
                    {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-auto p-4 font-mono text-xs text-zinc-200 leading-relaxed whitespace-pre selection:bg-zinc-800">
                {loadingText ? (
                  <div className="flex items-center justify-center h-full text-zinc-500 gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Loading content...</span>
                  </div>
                ) : textError ? (
                  <div className="text-rose-400 text-center py-12">{textError}</div>
                ) : (
                  textContent || 'File is empty'
                )}
              </div>
            </div>
          )}

          {/* ── Case 7: Generic Binary File Inspector ── */}
          {!isEncrypted && !isImage && !isVideo && !isAudio && !isPdf && !isTextOrCode && (
            <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center space-y-4 shadow-2xl">
              <div className="h-12 w-12 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 flex items-center justify-center mx-auto">
                <FileGeneric className="h-6 w-6" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-zinc-100 font-mono">{file.displayFilename}</h4>
                <p className="text-xs text-zinc-400 font-mono mt-1">{file.mimeType}</p>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-left space-y-2 text-xs font-mono">
                <div className="flex justify-between text-zinc-400">
                  <span>File Size:</span>
                  <span className="text-zinc-200 tabular-nums">{formatBytes(file.sizeBytes)}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Target Node:</span>
                  <span className="text-zinc-300 truncate max-w-[180px]">{file.driveAccountEmail}</span>
                </div>
                {file.checksumSha256 && (
                  <div className="pt-2 border-t border-zinc-800">
                    <span className="text-zinc-400 block mb-1">SHA-256 Checksum:</span>
                    <button
                      onClick={() => copyToClipboard(file.checksumSha256!, 'sha')}
                      className="w-full flex items-center justify-between p-2 rounded-md bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-300 hover:text-zinc-100 transition"
                    >
                      <span className="truncate">{file.checksumSha256}</span>
                      {copiedSha ? <Check className="h-3 w-3 text-emerald-400 shrink-0" /> : <Copy className="h-3 w-3 opacity-60 shrink-0" />}
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={handleDownloadOriginal}
                className="w-full py-2 bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium rounded-md transition flex items-center justify-center gap-2"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download Binary Payload</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
