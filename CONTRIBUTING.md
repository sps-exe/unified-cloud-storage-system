# Contributing to Unified Cloud Storage System (UCSS)

Thank you for your interest in contributing to UCSS! We welcome contributions to enhance storage allocation, expand provider integrations, and optimize high-throughput distributed file workflows.

---

## 🛠️ Development Workflow

### 1. Prerequisites
- **Node.js** >= 20.x
- **pnpm** >= 9.x
- **PostgreSQL** 16 (or Docker Compose)
- **Python** 3.10+ (for integration test runners)

### 2. Local Setup
```bash
# Clone the repository
git clone https://github.com/your-username/unified-cloud-storage-system.git
cd unified-cloud-storage-system

# Install dependencies across the monorepo
pnpm install

# Configure environment variables
cp .env.example .env
# Populate JWT secrets and encryption keys as indicated in .env.example

# Start local PostgreSQL via Docker
docker-compose up -d postgres

# Run database schema migrations
pnpm --filter @ucss/database prisma migrate dev

# Start development daemon
python3 scripts/dev-server.py start
```

---

## 🌿 Branch Naming Conventions

All feature and bugfix branches must follow this structure:

- `feat/<short-description>`: New features or capabilities (e.g. `feat/s3-compatible-api`)
- `fix/<short-description>`: Bug fixes (e.g. `fix/oauth-token-rotation`)
- `perf/<short-description>`: Performance improvements (e.g. `perf/sql-window-indexing`)
- `docs/<short-description>`: Documentation changes (e.g. `docs/architecture-guide`)
- `test/<short-description>`: Test suite updates (e.g. `test/concurrency-race-conditions`)

---

## 📝 Commit Conventions (Conventional Commits)

We enforce [Conventional Commits](https://www.conventionalcommits.org/). Commit messages must follow:

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### Allowed Types
- `feat`: A new feature
- `fix`: A bug fix
- `perf`: Code change that improves performance
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding or correcting tests
- `docs`: Documentation only changes
- `chore`: Build process, package updates, or auxiliary tool changes

### Examples
- `feat(allocation): add manual target drive account selection override`
- `fix(auth): persist session across OAuth redirects using root cookie path`
- `perf(database): add composite index on user_id and is_deleted`

---

## 🛡️ Coding & Architectural Standards

1. **PostgreSQL-First & Raw SQL Strictness**:
   - Critical concurrency paths (byte reservation, worker locking, browsing queries) must utilize raw SQL with explicit row locking (`FOR UPDATE SKIP LOCKED`) or transaction advisory locks (`pg_advisory_xact_lock`).
   - Never introduce N+1 query patterns. Prefer window functions (`COUNT(*) OVER ()`) and Common Table Expressions (CTEs).
2. **Strict TypeScript**:
   - Zero `any` types without explicit lint disables and comments.
   - All API endpoints must enforce input validation via **Zod**.
3. **Data Integrity & Non-Destructive Storage**:
   - File deletions are strictly soft deletions (`is_deleted = TRUE`, `deleted_at = NOW()`). Never execute raw `DELETE FROM files`.
4. **Token Security**:
   - OAuth tokens must always pass through `encryptToken()` / `decryptToken()` using AES-256-GCM. Unencrypted tokens must never appear in logs or client-facing responses.

---

## 🧪 Testing Guidelines

Before opening a pull request, ensure all tests pass:

```bash
# Run full master test suite (all assertions must pass 100%)
python3 scripts/run-all-tests.py
```

---

## 📬 Pull Request Process

1. Fork the repo and create your branch from `main`.
2. Ensure linting and tests pass.
3. Submit a PR against `main` using the provided Pull Request template.
4. Maintainers will review your submission for architectural adherence, security hygiene, and database performance.
