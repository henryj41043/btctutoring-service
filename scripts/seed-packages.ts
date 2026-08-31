/**
 * One-off seed: folds the (former) hardcoded PACKAGE_CONFIG into the
 * BTCTutoring-Packages-Table so the dynamic package catalog starts life with
 * the exact definitions the code used to ship. Run BEFORE deploying the
 * service build that reads the table.
 *
 * Idempotent: rows are written with Model.create (implicit
 * attribute_not_exists), so an existing package is counted as
 * "skipped (exists)" and never overwritten. 'Custom' is never seeded — it is
 * a code-level per-student concept, not a catalog row.
 *
 * Usage (from the repo root, with AWS creds/region in the environment):
 *   npx ts-node scripts/seed-packages.ts             # dry run
 *   npx ts-node scripts/seed-packages.ts --execute   # apply
 */
import 'dotenv/config';
import { PackagesModel } from '../src/models/packages.model';

const SEED_PACKAGES = [
  { id: 'Thrive', monthlyCost: 181, sessionsPerWeek: 1, sessionLengthMin: 30 },
  { id: 'Excel', monthlyCost: 273, sessionsPerWeek: 1, sessionLengthMin: 45 },
  { id: 'Succeed', monthlyCost: 362, sessionsPerWeek: 2, sessionLengthMin: 30 },
  { id: 'Achieve', monthlyCost: 546, sessionsPerWeek: 3, sessionLengthMin: 30 },
  { id: 'Victory', monthlyCost: 546, sessionsPerWeek: 2, sessionLengthMin: 45 },
  { id: 'Empower', monthlyCost: 819, sessionsPerWeek: 3, sessionLengthMin: 45 },
  {
    id: 'Determination',
    monthlyCost: 728,
    sessionsPerWeek: 2,
    sessionLengthMin: 60,
  },
  { id: 'Triumph', monthlyCost: 728, sessionsPerWeek: 4, sessionLengthMin: 30 },
  {
    id: 'Power-Up',
    monthlyCost: 1092,
    sessionsPerWeek: 3,
    sessionLengthMin: 60,
  },
  {
    id: 'Conquest',
    monthlyCost: 1092,
    sessionsPerWeek: 4,
    sessionLengthMin: 45,
  },
  { id: 'Summit', monthlyCost: 1456, sessionsPerWeek: 4, sessionLengthMin: 60 },
  { id: 'Apex', monthlyCost: 1820, sessionsPerWeek: 5, sessionLengthMin: 60 },
];

function isAlreadyExists(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? '';
  const message = (error as { message?: string })?.message ?? '';
  return (
    name === 'ConditionalCheckFailedException' ||
    message.includes('ConditionalCheckFailedException') ||
    message.includes('The conditional request failed')
  );
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  console.log(
    `Seeding ${SEED_PACKAGES.length} packages ${execute ? '(EXECUTE)' : '(dry run — pass --execute to apply)'}`,
  );

  let created = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  for (const pkg of SEED_PACKAGES) {
    const label = `${pkg.id} — $${pkg.monthlyCost}/mo, ${pkg.sessionsPerWeek}×${pkg.sessionLengthMin}min/wk`;
    if (!execute) {
      console.log(`  would create: ${label}`);
      created++;
      continue;
    }
    try {
      await PackagesModel.create({
        ...pkg,
        retired: false,
        created_at: now,
        updated_at: now,
      });
      console.log(`  created: ${label}`);
      created++;
    } catch (err) {
      if (isAlreadyExists(err)) {
        console.log(`  skipped (exists): ${pkg.id}`);
        skipped++;
      } else {
        throw err;
      }
    }
  }
  console.log(
    `Done. ${execute ? '' : '[dry run] '}created: ${created}, skipped (exists): ${skipped}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
