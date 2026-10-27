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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header Bar */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-4 bg-slate-950/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-slate-800 text-indigo-400 shrink-0">
              {isEncrypted ? (
                <Lock className="h-5 w-5 text-amber-400" />
              ) : isVideo ? (
                <FileVideo className="h-5 w-5" />
              ) : isAudio ? (
                <FileAudio className="h-5 w-5" />
              ) : isImage ? (
                <FileImage className="h-5 w-5" />
              ) : isTextOrCode ? (
                <FileText className="h-5 w-5" />
              ) : (
                <FileGeneric className="h-5 w-5" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white truncate max-w-xs sm:max-w-md md:max-w-xl" title={file.displayFilename}>
                  {file.displayFilename}
                </h3>
                {isEncrypted && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-full">
                    ZK-Encrypted
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-400">
                <span>{formatBytes(file.sizeBytes)}</span>
                <span>•</span>
                <span className="inline-flex items-center gap-1 font-mono text-slate-300">
                  <HardDrive className="h-3 w-3 text-indigo-400" />
                  {file.driveAccountEmail}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDownloadOriginal}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
              title="Download File"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Download</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Close Preview"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Preview Viewer Body */}
        <div className="flex-1 overflow-auto bg-slate-950 flex flex-col items-center justify-center min-h-[380px] p-4">
          {/* ── Case 1: ZK-Encrypted File Locked ── */}
          {isEncrypted && !decryptedBlobUrl && (
            <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center shadow-xl space-y-4">
              <div className="h-12 w-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
                <Lock className="h-6 w-6" />
              </div>
              <div>
                <h4 className="text-base font-semibold text-white">Zero-Knowledge Encrypted Vault</h4>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  This file was encrypted in your browser using AES-256-GCM before being stored on Google Drive.
                  Enter the master passphrase to decrypt and view it in memory.
                </p>
              </div>

              <form onSubmit={handleDecrypt} className="space-y-3">
                <div className="relative text-left">
                  <label className="text-[11px] font-medium text-slate-400 block mb-1">
                    Decryption Passphrase
                  </label>
                  <div className="relative">
                    <Key className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Enter passphrase used during upload"
                      className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                      required
                    />
                  </div>
                </div>

                {decryptionError && (
                  <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2 text-left">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{decryptionError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={decrypting || !passphrase.trim()}
                  className="w-full py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-2"
                >
                  {decrypting ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Decrypting In-Memory...
                    </>
                  ) : (
                    <>
                      <Key className="h-4 w-4" />
                      Decrypt & View
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
                className="max-h-[70vh] max-w-full rounded-xl shadow-2xl border border-slate-800 bg-black"
              >
                Your browser does not support HTML5 video streaming.
              </video>
            </div>
          )}

          {/* ── Case 3: Audio Player ── */}
          {(isAudio || (decryptedBlobUrl && decryptedMimeType.startsWith('audio/'))) && (
            <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-6 shadow-2xl">
              <div className="h-20 w-20 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto shadow-inner">
                <FileAudio className="h-10 w-10 animate-pulse" />
              </div>
              <div>
                <h4 className="text-base font-semibold text-white">{file.displayFilename}</h4>
                <p className="text-xs text-slate-400 mt-1">High-fidelity audio stream from Google Drive pool</p>
              </div>
              <audio
                src={decryptedBlobUrl || streamUrl}
                controls
                autoPlay
                className="w-full rounded-lg"
              />
            </div>
          )}

          {/* ── Case 4: Image Viewer ── */}
          {(isImage || (decryptedBlobUrl && decryptedMimeType.startsWith('image/'))) && (
            <div className="max-h-[72vh] flex items-center justify-center overflow-auto p-2">
              <img
                src={decryptedBlobUrl || streamUrl}
                alt={file.displayFilename}
                className="max-h-[68vh] max-w-full rounded-xl object-contain shadow-2xl border border-slate-800/80"
              />
            </div>
          )}

          {/* ── Case 5: PDF Viewer ── */}
          {(isPdf || (decryptedBlobUrl && decryptedMimeType === 'application/pdf')) && (
            <div className="w-full h-[72vh]">
              <iframe
                src={decryptedBlobUrl || streamUrl}
                title={file.displayFilename}
                className="w-full h-full rounded-xl border border-slate-800 bg-white"
              />
            </div>
          )}

          {/* ── Case 6: Text / Code Viewer ── */}
          {(isTextOrCode || (decryptedBlobUrl && decryptedMimeType.startsWith('text/'))) && (
            <div className="w-full h-[72vh] flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
              <div className="px-4 py-2 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono">
                <span>{textContent ? `${textContent.split('\n').length} lines` : 'Loading...'}</span>
                {textContent && (
                  <button
                    onClick={() => copyToClipboard(textContent, 'code')}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition"
                  >
                    {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-auto p-4 font-mono text-xs text-slate-200 leading-relaxed whitespace-pre selection:bg-indigo-500/30">
                {loadingText ? (
                  <div className="flex items-center justify-center h-full text-slate-500 gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Loading content...
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
            <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-5 shadow-2xl">
              <div className="h-16 w-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
                <FileGeneric className="h-8 w-8" />
              </div>
              <div>
                <h4 className="text-base font-semibold text-white">{file.displayFilename}</h4>
                <p className="text-xs text-slate-400 font-mono mt-1">{file.mimeType}</p>
              </div>

              <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 text-left space-y-2 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>File Size:</span>
                  <span className="font-mono text-white font-medium">{formatBytes(file.sizeBytes)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Target Node:</span>
                  <span className="font-mono text-indigo-400 truncate max-w-[180px]">{file.driveAccountEmail}</span>
                </div>
                {file.checksumSha256 && (
                  <div className="pt-2 border-t border-slate-800">
                    <span className="text-slate-400 block mb-1">SHA-256 Checksum:</span>
                    <button
                      onClick={() => copyToClipboard(file.checksumSha256!, 'sha')}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-300 hover:text-white transition"
                    >
                      <span className="truncate">{file.checksumSha256}</span>
                      {copiedSha ? <Check className="h-3 w-3 text-emerald-400 shrink-0" /> : <Copy className="h-3 w-3 opacity-60 shrink-0" />}
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={handleDownloadOriginal}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
              >
                <Download className="h-4 w-4" />
                Download Binary Payload
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
