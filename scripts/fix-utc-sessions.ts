/**
 * One-off remediation for the auto-renew UTC timezone bug.
 *
 * The auto-renew cron (running on a UTC container clock) generated sessions
 * whose stored UTC time equals the schedule slot's EASTERN wall time — i.e. a
 * Tue 11:30 slot was stored as ...T11:30:00Z instead of ...T15:30:00Z, so the
 * calendar showed it 4-5 hours early. This script finds Pending tutoring
 * sessions still carrying that fingerprint (UTC clock time + UTC weekday match
 * one of the student's schedule slots exactly) and shifts them to the correct
 * Eastern-derived instant. Sessions an admin already hand-corrected no longer
 * match the fingerprint and are left untouched.
 *
 * Usage (from the repo root, with .env providing AWS creds/region):
 *   npx ts-node scripts/fix-utc-sessions.ts             # dry run (default)
 *   npx ts-node scripts/fix-utc-sessions.ts --execute   # apply the fixes
 */
import 'dotenv/config';
import { SessionsModel } from '../src/models/sessions.model';
import { StudentsModel } from '../src/models/students.model';
import { Student } from '../src/models/student.model';
import { Session, SessionType } from '../src/models/session.model';
import { easternSlotToUtc } from '../src/billing/eastern-time';

const PENDING = 'Pending';
const WEEKDAY_BY_JS_DAY = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

interface Fix {
  session: Session;
  newStart: string;
  newEnd: string;
}

function utcClock(iso: string): string {
  const d = new Date(iso);
  const h = d.getUTCHours().toString().padStart(2, '0');
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function findFixes(sessions: Session[], students: Student[]): Fix[] {
  const studentsById = new Map(students.map((s) => [s.id, s]));
  const fixes: Fix[] = [];

  for (const session of sessions) {
    if (session.type !== SessionType.TUTORING) continue;
    if (session.status !== PENDING) continue;
    if (!session.student_id || !session.start_datetime) continue;

    const student = studentsById.get(session.student_id);
    const schedule = student?.schedule ?? [];
    if (schedule.length === 0) continue;

    const start = new Date(session.start_datetime);
    const utcWeekday = WEEKDAY_BY_JS_DAY[start.getUTCDay()];
    // The untouched-cron fingerprint: the stored UTC clock time equals the
    // slot's Eastern wall time on the matching weekday. A correctly-generated
    // or hand-fixed session reads 4-5h later in UTC and won't match.
    const slot = schedule.find(
      (s) =>
        s.weekday === utcWeekday &&
        s.start_time === utcClock(session.start_datetime) &&
        s.end_time === utcClock(session.end_datetime),
    );
    if (!slot) continue;

    const y = start.getUTCFullYear();
    const mo = start.getUTCMonth();
    const d = start.getUTCDate();
    fixes.push({
      session,
      newStart: easternSlotToUtc(y, mo, d, slot.start_time).toISOString(),
      newEnd: easternSlotToUtc(y, mo, d, slot.end_time).toISOString(),
    });
  }
  return fixes;
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');

  const students = (await StudentsModel.scan()
    .all()
    .exec()) as unknown as Student[];
  const sessions = (await SessionsModel.scan()
    .all()
    .exec()) as unknown as Session[];
  const fixes = findFixes(sessions, students);

  console.log(`Scanned ${sessions.length} sessions / ${students.length} students.`);
  console.log(`${fixes.length} Pending session(s) carry the UTC fingerprint:\n`);
  for (const f of fixes) {
    console.log(
      `  ${f.session.student_name ?? f.session.student_id} — ` +
        `${f.session.start_datetime} → ${f.newStart}`,
    );
  }

  if (!execute) {
    console.log('\nDry run (no writes). Re-run with --execute to apply.');
    return;
  }

  for (const f of fixes) {
    await SessionsModel.update(
      { id: f.session.id },
      { start_datetime: f.newStart, end_datetime: f.newEnd },
    );
  }
  console.log(`\nApplied ${fixes.length} fix(es).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
