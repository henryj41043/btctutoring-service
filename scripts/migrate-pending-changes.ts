/**
 * One-off migration: fold each student's legacy single scheduled package
 * change (pending_package + pending_package_effective + custom overrides +
 * pending_schedule + pending_change_notice_sent) into the ordered
 * `pending_changes` list, and remove the legacy scalar fields.
 *
 * Idempotent: a re-run finds no candidates (only students still carrying a
 * legacy key qualify). The conversion itself is the covered normalizer
 * `pendingChangesOf`; this file only scans, prints and writes.
 *
 * Usage (from the repo root; prefix with
 * `eval "$(aws configure export-credentials --format env)"` — the .env keys
 * are stale):
 *   npx ts-node scripts/migrate-pending-changes.ts             # dry run
 *   npx ts-node scripts/migrate-pending-changes.ts --execute   # apply
 */
import 'dotenv/config';
import { StudentsModel } from '../src/models/students.model';
import { Student } from '../src/models/student.model';
import {
  LEGACY_PENDING_FIELDS,
  pendingChangesOf,
} from '../src/students/pending-changes';

/** True when the student still carries any legacy single-change key. */
export function hasLegacyPending(student: Student): boolean {
  const record = student as unknown as Record<string, unknown>;
  return LEGACY_PENDING_FIELDS.some(
    (field) => record[field] !== undefined && record[field] !== null,
  );
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const students = (await StudentsModel.scan()
    .all()
    .exec()) as unknown as Student[];
  const candidates = students.filter(hasLegacyPending);
  console.log(
    `Scanned ${students.length} student(s); ${candidates.length} carry legacy pending fields.\n`,
  );

  const plans = candidates.map((student) => {
    // A record that already has the list keeps it; the legacy scalars are
    // just dropped (the list is the source of truth once present).
    const list = Array.isArray(student.pending_changes)
      ? pendingChangesOf(student)
      : pendingChangesOf({
          ...student,
          pending_changes: undefined,
        } as Student);
    return { student, list };
  });

  for (const { student, list } of plans) {
    console.log(`${student.name} (${student.id})`);
    if (Array.isArray(student.pending_changes)) {
      console.log(
        '  already has pending_changes — legacy keys only will be removed',
      );
    }
    if (list.length === 0) {
      console.log(
        '  no convertible change (malformed legacy) — legacy keys dropped',
      );
    }
    for (const c of list) {
      console.log(
        `  → ${c.package} from ${c.effective} · ${c.schedule ? 'schedule set' : 'no schedule'}` +
          (c.notice_sent ? ` · notice_sent ${c.notice_sent}` : ''),
      );
    }
  }

  if (!execute) {
    console.log('\nDry run — nothing written. Re-run with --execute to apply.');
    return;
  }

  let updated = 0;
  for (const { student, list } of plans) {
    const update =
      list.length > 0
        ? {
            $SET: { pending_changes: list },
            $REMOVE: [...LEGACY_PENDING_FIELDS],
          }
        : { $REMOVE: [...LEGACY_PENDING_FIELDS] };
    await StudentsModel.update({ id: student.id }, update);
    updated++;
  }
  console.log(`\nUpdated ${updated} student(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
