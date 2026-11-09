/**
 * Read-only: lists sessions that double-book a tutor or a student, using
 * the same rule as the service's double-booking guard (session-conflicts.ts):
 * intersecting times, the same tutor or a shared student, Cancelled ignored,
 * back-to-back allowed. Writes nothing.
 *
 * Each line pairs a session with the EARLIER one it collides with, so the
 * later copy is the one to review. "Duplicate" = same tutor, student, type
 * and times (the client's 2026-11-04 screenshot).
 *
 * Usage (from the repo root; prefix with
 * `eval "$(aws configure export-credentials --format env)"`):
 *   npx ts-node scripts/report-session-overlaps.ts            # from today
 *   npx ts-node scripts/report-session-overlaps.ts 2026-10-01 # from a date
 */
import 'dotenv/config';
import { SessionsModel } from '../src/models/sessions.model';
import { Session } from '../src/models/session.model';
import { findConflicts, slotPhrase } from '../src/sessions/session-conflicts';

const isDuplicate = (a: Session, b: Session): boolean =>
  a.tutor_id === b.tutor_id &&
  (a.student_id ?? '') === (b.student_id ?? '') &&
  (a.type ?? '') === (b.type ?? '') &&
  Date.parse(a.start_datetime) === Date.parse(b.start_datetime) &&
  Date.parse(a.end_datetime) === Date.parse(b.end_datetime);

const label = (s: Session): string =>
  `${s.type ?? 'TUTORING'} ${s.tutor_name ?? s.tutor_id ?? '?'} with ${s.student_name ?? '(no student)'} [${s.status}] id=${s.id}`;

async function main(): Promise<void> {
  const fromArg = process.argv[2];
  const from = fromArg
    ? new Date(`${fromArg}T00:00:00-05:00`)
    : new Date(new Date().toISOString().slice(0, 10));
  if (isNaN(from.getTime())) {
    throw new Error('usage: report-session-overlaps.ts [YYYY-MM-DD]');
  }
  // A day earlier so a session already running at `from` is still compared.
  const scanFrom = new Date(from.getTime() - 24 * 60 * 60 * 1000);
  const sessions = (
    (await SessionsModel.scan()
      .where('start_datetime')
      .ge(scanFrom.toISOString())
      .all()
      .exec()) as unknown as Session[]
  )
    .map((s) => ({ ...s }) as Session)
    .sort(
      (a, b) =>
        Date.parse(a.start_datetime) - Date.parse(b.start_datetime) ||
        (a.id ?? '').localeCompare(b.id ?? ''),
    );
  const hits = findConflicts(sessions, []).filter(
    (hit) => Date.parse(sessions[hit.index].start_datetime) >= from.getTime(),
  );

  const duplicates = hits.filter((h) =>
    isDuplicate(sessions[h.index], h.existing),
  );
  const overlaps = hits.filter((h) => !duplicates.includes(h));
  console.log(
    `Scanned ${sessions.length} sessions starting on or after ${scanFrom.toISOString().slice(0, 10)}.`,
  );
  console.log(
    `${duplicates.length} exact duplicate(s), ${overlaps.length} other overlap(s) from ${from.toISOString().slice(0, 10)}.\n`,
  );
  for (const [title, list] of [
    ['EXACT DUPLICATES', duplicates],
    ['OVERLAPS', overlaps],
  ] as const) {
    console.log(`== ${title} ==`);
    for (const hit of list) {
      const later = sessions[hit.index];
      console.log(`${slotPhrase(later)} | shared ${hit.shared}`);
      console.log(
        `   keep?   ${label(hit.existing)} ${slotPhrase(hit.existing)}`,
      );
      console.log(`   review  ${label(later)}`);
    }
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
