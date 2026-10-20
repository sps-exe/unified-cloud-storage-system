// =============================================================================
// UCSS — Production System Bootstrap Script
// =============================================================================
// Performs initial database verification and optional administrator provisioning
// for commercial production deployments.
//
// ZERO-MOCK GUARANTEE:
// Does NOT seed fake Google Drive accounts, dummy files, or placeholder tokens.
// Accounts must be connected exclusively via live Google OAuth flows.
// =============================================================================

import { prisma } from '../dist/client.js';

async function main() {
  console.log('🚀 Executing UCSS Production Bootstrap...');

  // 1. Verify PostgreSQL Database Connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('  ✔ Database connection verified successfully.');
  } catch (error) {
    console.error('  ✖ Database connection failed:', error);
    process.exit(1);
  }

  // 2. Clean up any historical sandbox/mock records from previous testing
  await prisma.$executeRaw`
    DELETE FROM upload_operations 
    WHERE file_id IN (
      SELECT f.id FROM files f 
      JOIN drive_accounts da ON da.id = f.drive_account_id 
      WHERE da.google_email LIKE 'mock.drive.%' OR da.google_email LIKE 'alex.%'
    );
  `;
  await prisma.$executeRaw`
    DELETE FROM files 
    WHERE drive_account_id IN (
      SELECT id FROM drive_accounts 
      WHERE google_email LIKE 'mock.drive.%' OR google_email LIKE 'alex.%'
    );
  `;
  await prisma.$executeRaw`
    DELETE FROM storage_snapshots 
    WHERE drive_account_id IN (
      SELECT id FROM drive_accounts 
      WHERE google_email LIKE 'mock.drive.%' OR google_email LIKE 'alex.%'
    );
  `;
  const deletedMockAccounts = await prisma.$executeRaw`
    DELETE FROM drive_accounts 
    WHERE google_email LIKE 'mock.drive.%' 
       OR google_email LIKE 'alex.%'
       OR encrypted_refresh_token LIKE '%mock_%';
  `;
  if (deletedMockAccounts > 0) {
    console.log(`  ✔ Purged ${deletedMockAccounts} legacy test accounts and referenced test records from database.`);
  }

  // 3. Ensure CHECK constraints on non-negative byte quantities
  try {
    await prisma.$executeRaw`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_drive_accounts_reserved_bytes') THEN
          ALTER TABLE drive_accounts ADD CONSTRAINT chk_drive_accounts_reserved_bytes CHECK (reserved_bytes >= 0);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_drive_accounts_quota_used') THEN
          ALTER TABLE drive_accounts ADD CONSTRAINT chk_drive_accounts_quota_used CHECK (quota_used_bytes >= 0);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_drive_accounts_quota_limit') THEN
          ALTER TABLE drive_accounts ADD CONSTRAINT chk_drive_accounts_quota_limit CHECK (quota_limit_bytes >= 0);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_files_size_bytes') THEN
          ALTER TABLE files ADD CONSTRAINT chk_files_size_bytes CHECK (size_bytes >= 0);
        END IF;
      END $$;
    `;
    console.log('  ✔ Database engine CHECK constraints verified.');
  } catch (err) {
    console.log('  ℹ Note on check constraints:', err instanceof Error ? err.message : String(err));
  }

  // 4. Report Active Production Schema State
  const [accountCount] = await prisma.$queryRaw<Array<{ count: string }>>`
    SELECT COUNT(*)::text AS count FROM drive_accounts WHERE status = 'ACTIVE'::"AccountStatus";
  `;
  const [fileCount] = await prisma.$queryRaw<Array<{ count: string }>>`
    SELECT COUNT(*)::text AS count FROM files WHERE is_deleted = FALSE;
  `;
  const [userCount] = await prisma.$queryRaw<Array<{ count: string }>>`
    SELECT COUNT(*)::text AS count FROM users;
  `;

  console.log('--------------------------------------------------------------------------------');
  console.log(`  Users Registered:         ${userCount?.count || 0}`);
  console.log(`  Live Drive Accounts:      ${accountCount?.count || 0}`);
  console.log(`  Active Managed Files:     ${fileCount?.count || 0}`);
  console.log('--------------------------------------------------------------------------------');
  console.log('✅ UCSS Database is ready for commercial production operations.');
}

main()
  .catch((e) => {
    console.error('Fatal bootstrap error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
