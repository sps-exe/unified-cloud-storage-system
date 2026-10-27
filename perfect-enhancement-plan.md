# UCSS Perfection & Extreme Capability Plan

## Goal
Elevate the Unified Cloud Storage System into an elite virtual filesystem with native WebDAV macOS/Windows network drive support, HTTP 206 Range streaming with rich in-browser media preview, and client-side zero-knowledge AES-256-GCM encryption.

## Tasks
- [x] Task 1: Implement HTTP 206 Range & inline streaming endpoint in `routes/files.ts` and `services/google-drive.service.ts` → Verify: `curl -I -H "Range: bytes=0-100" http://localhost:4000/api/files/:id/stream` returns HTTP 206 Partial Content.
- [x] Task 2: Build Native WebDAV Router (`routes/webdav.ts`) supporting PROPFIND, GET, PUT, DELETE, MOVE, OPTIONS with Basic Auth → Verify: `curl -u "test@example.com:password" -X OPTIONS http://localhost:4000/webdav` returns DAV 1, 2 headers.
- [x] Task 3: Mount WebDAV router in Express `app.ts` and verify folder listing via `curl -X PROPFIND` → Verify: XML multistatus response lists user's active files with sizes and timestamps.
- [ ] Task 4: Create `FilePreviewModal.tsx` in `apps/web` with video, audio, image, PDF, and code/text viewers → Verify: Component renders cleanly and handles all MIME types.
- [ ] Task 5: Implement Web Crypto API Zero-Knowledge encryption in `UploadModal.tsx` and decryption in `FileManager.tsx` → Verify: Encrypted file uploads ciphertext to Google Drive and decrypts cleanly on client.
- [ ] Task 6: Integrate Preview & Encryption badges into `FileManager.tsx` and update Navbar with "Connect Network Drive" instructions → Verify: Clicking a file opens the preview modal with instant playback.
- [ ] Task 7: Comprehensive verification sweep (strict TypeScript check, automated test run, end-to-end endpoint validation) → Verify: `tsc --noEmit` exits 0 on api and web, tests pass 100%.

## Done When
- [ ] macOS Finder / Windows Explorer can connect to `http://localhost:4000/webdav` to view, drag-and-drop upload, and download files.
- [ ] Users can preview images, stream seekable 4K video/audio, and view PDFs/code directly inside the web UI.
- [ ] Zero-knowledge client-side encryption ensures Google Drive stores only unreadable ciphertext when enabled.
- [ ] Zero TypeScript errors and all automated tests passing.
