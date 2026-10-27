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
}

export const WebdavModal: React.FC<WebdavModalProps> = ({ isOpen, onClose, userEmail }) => {
  if (!isOpen) return null;

  const [copiedUrl, setCopiedUrl] = useState(false);
  const webdavUrl = `${window.location.protocol}//${window.location.hostname}:4000/webdav`;

  const copyUrl = () => {
    navigator.clipboard.writeText(webdavUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Folder className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Mount Native Network Drive</span>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full">
                  RFC 4918 WebDAV
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Access your aggregated Google Drive fabric directly in Finder or Explorer
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-auto max-h-[80vh]">
          {/* Server Endpoint Bar */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
              Network Drive Server URL
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={webdavUrl}
                className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-indigo-300 focus:outline-none"
              />
              <button
                onClick={copyUrl}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition flex items-center gap-1.5 shrink-0"
              >
                {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedUrl ? 'Copied' : 'Copy URL'}</span>
              </button>
            </div>
          </div>

          {/* Platform Guides */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* macOS Finder */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-white font-semibold text-xs">
                <span className="h-2 w-2 rounded-full bg-indigo-400"></span>
                <span>macOS Finder Setup</span>
              </div>
              <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside pl-1 leading-relaxed">
                <li>
                  Open <strong className="text-white">Finder</strong> and press <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono text-[10px] text-indigo-300">⌘ Cmd + K</kbd> (or <em className="text-slate-400">Go &gt; Connect to Server</em>).
                </li>
                <li>
                  Paste the <strong className="text-indigo-400">Server URL</strong> above and click <strong className="text-white">Connect</strong>.
                </li>
                <li>
                  Select <strong className="text-white">Registered User</strong>, enter your UCSS Email (<code className="text-slate-400 font-mono text-[11px]">{userEmail}</code>) and your password.
                </li>
                <li>
                  Drag and drop files to upload directly to your multi-account pool!
                </li>
              </ol>
            </div>

            {/* Windows File Explorer */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-white font-semibold text-xs">
                <span className="h-2 w-2 rounded-full bg-sky-400"></span>
                <span>Windows Explorer Setup</span>
              </div>
              <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside pl-1 leading-relaxed">
                <li>
                  Open <strong className="text-white">File Explorer</strong>, right-click <strong className="text-white">This PC</strong>, and choose <strong className="text-white">Map network drive...</strong>
                </li>
                <li>
                  Paste the <strong className="text-sky-400">Server URL</strong> into the <strong className="text-white">Folder</strong> field.
                </li>
                <li>
                  Check <strong className="text-white">Connect using different credentials</strong> and click <strong className="text-white">Finish</strong>.
                </li>
                <li>
                  Sign in with your UCSS account credentials.
                </li>
              </ol>
            </div>
          </div>

          {/* Linux & CLI Mounting */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-white font-semibold text-xs">
              <Terminal className="h-4 w-4 text-emerald-400" />
              <span>Linux / CLI (davfs2)</span>
            </div>
            <pre className="p-2.5 bg-slate-900 rounded-lg text-[11px] font-mono text-emerald-400 overflow-x-auto">
              sudo mount -t davfs {webdavUrl} /mnt/ucss -o username={userEmail}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-950/60 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <HardDrive className="h-3.5 w-3.5 text-indigo-400" />
            <span>Streams transparently across all connected Drive accounts</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
