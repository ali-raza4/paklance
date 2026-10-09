/**
 * update-admin-email.js
 *
 * ONE-TIME script to update the production Admin account email.
 *   FROM: admin@paklance.pk
 *   TO:   admin@paklance.com
 *
 * Safety guarantees:
 *  - Reads the existing record first and aborts if any pre-condition fails.
 *  - Updates ONLY the `email` field of the matching ADMIN user.
 *  - Does NOT touch passwordHash, role, id, or any other field.
 *  - Does NOT modify any other user record.
 *  - Does NOT print DATABASE_URL or any secret.
 *  - Runs in a single Prisma transaction so the change is atomic.
 *  - Prints a before/after summary (no password, no secrets).
 *
 * Usage:
 *   $env:DATABASE_URL="<production-connection-string>"
 *   node scripts/update-admin-email.js
 *
 * CONFIRM the printed plan before it executes:
 *   The script will pause and require you to set DRY_RUN=false to commit.
 *   e.g.  $env:DRY_RUN="false"   node scripts/update-admin-email.js
 */

'use strict';

const { PrismaClient } = require('@prisma/client');

const OLD_EMAIL = 'admin@paklance.pk';
const NEW_EMAIL = 'admin@paklance.com';
const DRY_RUN  = process.env.DRY_RUN !== 'false'; // default: dry-run ON

(async () => {
  const prisma = new PrismaClient();

  try {
    // 1. PRE-FLIGHT: find the existing admin record
    const existing = await prisma.user.findUnique({
      where: { email: OLD_EMAIL },
      select: {
        id:              true,
        email:           true,
        role:            true,
        isEmailVerified: true,
        createdAt:       true,
        // passwordHash intentionally EXCLUDED
      },
    });

    if (!existing) {
      console.error(`\nABORT: No user found with email "${OLD_EMAIL}".`);
      console.error('No changes have been made.');
      process.exit(1);
    }

    if (existing.role !== 'ADMIN') {
      console.error(`\nABORT: User with email "${OLD_EMAIL}" has role "${existing.role}", not ADMIN.`);
      console.error('No changes have been made.');
      process.exit(1);
    }

    // 2. Check that the target email is not already taken
    const collision = await prisma.user.findUnique({
      where:  { email: NEW_EMAIL },
      select: { id: true },
    });

    if (collision) {
      console.error(`\nABORT: A user with email "${NEW_EMAIL}" already exists (id: ${collision.id}).`);
      console.error('No changes have been made.');
      process.exit(1);
    }

    // 3. Print the exact change that WILL be made
    console.log('\n======================================================');
    console.log('  PAKLANCE - Admin Email Update');
    console.log('======================================================');
    console.log('  PRE-FLIGHT CHECKS PASSED');
    console.log('------------------------------------------------------');
    console.log(`  User ID   : ${existing.id}`);
    console.log(`  Role      : ${existing.role}      <- UNCHANGED`);
    console.log(`  Created   : ${existing.createdAt.toISOString()}`);
    console.log(`  Password  : [NOT PRINTED / NOT CHANGED]`);
    console.log('------------------------------------------------------');
    console.log(`  FROM email: ${existing.email}`);
    console.log(`  TO   email: ${NEW_EMAIL}`);
    console.log('------------------------------------------------------');

    if (DRY_RUN) {
      console.log('\n  DRY RUN - no changes written to the database.');
      console.log('  To commit, re-run with:  $env:DRY_RUN="false"');
      console.log('======================================================\n');
      process.exit(0);
    }

    // 4. EXECUTE - update ONLY the email field
    const updated = await prisma.$transaction(async (tx) => {
      return tx.user.update({
        where: { id: existing.id },           // keyed on immutable ID, not email
        data:  { email: NEW_EMAIL },
        select: {
          id:              true,
          email:           true,
          role:            true,
          isEmailVerified: true,
          updatedAt:       true,
        },
      });
    });

    // 5. POST-FLIGHT VERIFICATION
    console.log('\n  UPDATE COMMITTED');
    console.log('------------------------------------------------------');
    console.log(`  User ID        : ${updated.id}`);
    console.log(`  New email      : ${updated.email}`);
    console.log(`  Role           : ${updated.role}`);
    console.log(`  isEmailVerified: ${updated.isEmailVerified}`);
    console.log(`  Updated at     : ${updated.updatedAt.toISOString()}`);
    console.log('------------------------------------------------------');
    console.log('  Password       : [NOT PRINTED / NOT CHANGED]');
    console.log('  ID unchanged   : same record');
    console.log('======================================================\n');

  } catch (err) {
    console.error('\nScript error:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
