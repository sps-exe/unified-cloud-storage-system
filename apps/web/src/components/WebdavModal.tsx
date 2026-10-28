// =============================================================================
// UCSS Web — WebDAV Network Drive Setup Modal
// =============================================================================
// Provides one-click copy and step-by-step instructions for mounting the
// Unified Cloud Storage System as a native physical network drive in macOS Finder,
// Windows File Explorer, and Linux file managers.
// =============================================================================

import React, { useState } from 'react';
import { X, Folder, Copy, Check, Terminal, HardDrive } from './icons';

interface WebdavModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
  webdavUrl?: string;
}

export const WebdavModal: React.FC<WebdavModalProps> = ({ isOpen, onClose, userEmail, webdavUrl: configuredUrl }) => {
  // Hooks must run on every render, so the early return comes after them.
  const [copiedUrl, setCopiedUrl] = useState(false);
  if (!isOpen) return null;

  const webdavUrl = configuredUrl || `${window.location.origin}/webdav`;

  const copyUrl = () => {
    navigator.clipboard.writeText(webdavUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-zinc-800 border border-zinc-700/80 text-zinc-300">
              <Folder className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <span>Mount Native Network Drive</span>
                <span className="px-1.5 py-0.5 text-[10px] font-mono bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded">
                  RFC 4918 WebDAV
                </span>
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Mount the aggregated Google Drive fabric directly in macOS Finder or Windows Explorer
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-auto max-h-[80vh]">
          {/* Server Endpoint Bar */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider block">
              Network Drive Server URL
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={webdavUrl}
                className="flex-1 px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-md text-xs font-mono text-zinc-200 focus:outline-none"
              />
              <button
                onClick={copyUrl}
                className="px-3 py-1.5 bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium rounded-md transition flex items-center gap-1.5 shrink-0"
              >
                {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedUrl ? 'Copied' : 'Copy URL'}</span>
              </button>
            </div>
          </div>

          {/* Platform Guides */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* macOS Finder */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-zinc-200 font-medium text-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                <span>macOS Finder Setup</span>
              </div>
              <ol className="text-xs text-zinc-400 space-y-1.5 list-decimal list-inside pl-1 leading-relaxed font-sans">
                <li>
                  Open <strong className="text-zinc-200">Finder</strong> and press <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded font-mono text-[10px] text-zinc-200">⌘ Cmd + K</kbd> (or <em className="text-zinc-400 not-italic font-mono">Go &gt; Connect to Server</em>).
                </li>
                <li>
                  Paste the <strong className="text-zinc-200">Server URL</strong> above and click <strong className="text-zinc-200">Connect</strong>.
                </li>
                <li>
                  Select <strong className="text-zinc-200">Registered User</strong>, enter your UCSS Email (<code className="text-zinc-300 font-mono text-[11px]">{userEmail}</code>) and your password.
                </li>
                <li>
                  Drag and drop files to upload directly to your multi-account pool.
                </li>
              </ol>
            </div>

            {/* Windows File Explorer */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-zinc-200 font-medium text-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-400"></span>
                <span>Windows Explorer Setup</span>
              </div>
              <ol className="text-xs text-zinc-400 space-y-1.5 list-decimal list-inside pl-1 leading-relaxed font-sans">
                <li>
                  Open <strong className="text-zinc-200">File Explorer</strong>, right-click <strong className="text-zinc-200">This PC</strong>, and choose <strong className="text-zinc-200">Map network drive...</strong>
                </li>
                <li>
                  Paste the <strong className="text-zinc-200">Server URL</strong> into the <strong className="text-zinc-200">Folder</strong> field.
                </li>
                <li>
                  Check <strong className="text-zinc-200">Connect using different credentials</strong> and click <strong className="text-zinc-200">Finish</strong>.
                </li>
                <li>
                  Sign in with your UCSS account credentials.
                </li>
              </ol>
            </div>
          </div>

          {/* Linux & CLI Mounting */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3.5 space-y-1.5">
            <div className="flex items-center gap-2 text-zinc-200 font-medium text-xs">
              <Terminal className="h-3.5 w-3.5 text-zinc-400" />
              <span>Linux / CLI (davfs2)</span>
            </div>
            <pre className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-md text-[11px] font-mono text-zinc-300 overflow-x-auto">
              sudo mount -t davfs {webdavUrl} /mnt/ucss -o username={userEmail}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-zinc-950/60 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-500">
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <HardDrive className="h-3.5 w-3.5 text-zinc-400" />
            <span>Streams transparently across all connected Drive accounts</span>
          </div>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs rounded-md transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
