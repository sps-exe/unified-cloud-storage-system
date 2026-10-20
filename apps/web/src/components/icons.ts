// =============================================================================
// UCSS Web — Targeted Icon Exports (Avoids Barrel File Exhaustion)
// =============================================================================
// Importing from the root 'lucide-react' barrel exports 1500+ icons, which
// causes Rollup/Vite to open 1500 concurrent file descriptors and stall on macOS.
// Directly importing only the icons we use resolves in < 500ms.
// =============================================================================

// @ts-nocheck
export { default as Activity } from 'lucide-react/dist/esm/icons/activity.mjs';
export { default as AlertCircle } from 'lucide-react/dist/esm/icons/alert-circle.mjs';
export { default as AlertTriangle } from 'lucide-react/dist/esm/icons/alert-triangle.mjs';
export { default as ArrowRight } from 'lucide-react/dist/esm/icons/arrow-right.mjs';
export { default as Check } from 'lucide-react/dist/esm/icons/check.mjs';
export { default as CheckCircle2 } from 'lucide-react/dist/esm/icons/check-circle-2.mjs';
export { default as ChevronLeft } from 'lucide-react/dist/esm/icons/chevron-left.mjs';
export { default as ChevronRight } from 'lucide-react/dist/esm/icons/chevron-right.mjs';
export { default as Copy } from 'lucide-react/dist/esm/icons/copy.mjs';
export { default as Database } from 'lucide-react/dist/esm/icons/database.mjs';
export { default as Download } from 'lucide-react/dist/esm/icons/download.mjs';
export { default as Edit2 } from 'lucide-react/dist/esm/icons/edit-2.mjs';
export { default as File } from 'lucide-react/dist/esm/icons/file.mjs';
export { default as FileArchive } from 'lucide-react/dist/esm/icons/file-archive.mjs';
export { default as FileAudio } from 'lucide-react/dist/esm/icons/file-audio.mjs';
export { default as FileImage } from 'lucide-react/dist/esm/icons/file-image.mjs';
export { default as FileText } from 'lucide-react/dist/esm/icons/file-text.mjs';
export { default as FileVideo } from 'lucide-react/dist/esm/icons/file-video.mjs';
export { default as HardDrive } from 'lucide-react/dist/esm/icons/hard-drive.mjs';
export { default as Lock } from 'lucide-react/dist/esm/icons/lock.mjs';
export { default as LogOut } from 'lucide-react/dist/esm/icons/log-out.mjs';
export { default as Mail } from 'lucide-react/dist/esm/icons/mail.mjs';
export { default as Plus } from 'lucide-react/dist/esm/icons/plus.mjs';
export { default as RefreshCw } from 'lucide-react/dist/esm/icons/refresh-cw.mjs';
export { default as Search } from 'lucide-react/dist/esm/icons/search.mjs';
export { default as ShieldAlert } from 'lucide-react/dist/esm/icons/shield-alert.mjs';
export { default as ShieldCheck } from 'lucide-react/dist/esm/icons/shield-check.mjs';
export { default as Trash2 } from 'lucide-react/dist/esm/icons/trash-2.mjs';
export { default as Upload } from 'lucide-react/dist/esm/icons/upload.mjs';
export { default as UploadCloud } from 'lucide-react/dist/esm/icons/upload-cloud.mjs';
export { default as User } from 'lucide-react/dist/esm/icons/user.mjs';
export { default as X } from 'lucide-react/dist/esm/icons/x.mjs';
export { default as Zap } from 'lucide-react/dist/esm/icons/zap.mjs';
