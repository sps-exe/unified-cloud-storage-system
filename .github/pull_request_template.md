## 📌 Description
<!-- Provide a summary of the changes introduced by this pull request. -->

## 🔗 Related Issues
<!-- Link related issues, e.g. Fixes #123 -->

## 🛠️ Type of Change
- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] ⚡ Performance optimization (database query tuning, caching, indexing)
- [ ] 🔒 Security hardening (crypto, auth, rate limiting)
- [ ] 📖 Documentation update
- [ ] 🧹 Refactoring / Tech debt cleanup

## 🧪 Verification & Testing
<!-- Describe the tests you executed to verify your changes. -->
- [ ] Master integration test suite passed (`python3 scripts/run-all-tests.py`)
- [ ] Manual verification in Web UI or Postman completed
- [ ] TypeScript compilation verified (`pnpm build`)

## 📋 Quality Checklist
- [ ] My code adheres to the project's coding standards and Conventional Commits.
- [ ] Zero unencrypted tokens or secrets are introduced in code or logs.
- [ ] SQL changes preserve row-level locking (`FOR UPDATE SKIP LOCKED`) and advisory locks where applicable.
- [ ] Soft deletion semantics (`is_deleted = TRUE`) are strictly maintained.
- [ ] Relevant documentation has been updated.
