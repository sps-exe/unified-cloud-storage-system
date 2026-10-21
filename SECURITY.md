# Security Policy — Unified Cloud Storage System (UCSS)

Security and zero-leakage token hygiene are core architectural pillars of the Unified Cloud Storage System.

---

## 🔒 Security Architecture Highlights

### 1. Zero-Plaintext OAuth Tokens (AES-256-GCM)
- All Google OAuth 2.0 refresh tokens stored in the `drive_accounts` table are encrypted at rest using **AES-256-GCM**.
- Each encryption operation generates a cryptographically random **12-byte initialization vector (IV)** and computes a **16-byte authentication tag**.
- The encrypted payload format is stored as:
  ```
  iv:authTag:ciphertext (hex-encoded)
  ```
- Plaintext refresh tokens are deciphered strictly in-memory during transient Google Drive API calls and are permanently redacted from application logs via Pino redact filters:
  ```typescript
  redact: ['req.headers.authorization', 'req.headers.cookie']
  ```

### 2. Least Privilege OAuth 2.0 Scope
- The system requests only the narrowest possible scope:
  ```
  https://www.googleapis.com/auth/drive.file
  ```
- This ensures UCSS can only create, view, and modify files that UCSS itself has created inside its dedicated root folder (`_UCSS_ROOT_`). It cannot access, read, or delete personal photos, documents, or spreadsheets in your Google Drive.

### 3. Anti-CSRF Cryptographic State Validation
- Initiating account linking signs and encrypts a state payload containing the authenticated `userId`, a timestamp, and HMAC verification.
- Incoming callbacks to `/api/oauth/google/callback` verify the state envelope to eliminate cross-site request forgery and authorization code injection.

### 4. Row-Level Tenant Isolation & Advisory Locks
- Every database query enforces strict tenant isolation:
  ```sql
  WHERE user_id = ${userId}::uuid
  ```
- Storage allocations acquire transaction-scoped advisory locks:
  ```sql
  SELECT pg_advisory_xact_lock(hashtext('alloc_' || account_id::text));
  ```
- This prevents concurrency exploits and cross-tenant data leaks.

---

## 🛡️ Supported Versions

| Version | Supported          |
| :---    | :---               |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

---

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability within UCSS, **do not open a public GitHub issue**.

Please report security vulnerabilities directly to:
**shaurya@ucss.dev** (or via private GitHub Vulnerability Reporting)

### What to Include in Your Report
1. Description of the vulnerability and its potential impact.
2. Step-by-step reproduction instructions or proof-of-concept script.
3. Affected components, routes, or files.

### Response Commitment
- **Initial Response:** Within 48 hours of report receipt.
- **Triage & Patch:** We commit to releasing a patched version within 7 business days for verified high-severity issues.
