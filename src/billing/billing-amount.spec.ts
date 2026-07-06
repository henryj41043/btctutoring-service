import { studentMonthlyCharge } from './billing-amount';
import { Student } from '../models/student.model';
import { Package } from './package.enum';

const succeed = (over: Partial<Student> = {}): Student =>
  ({ package: Package.SUCCEED, ...over }) as Student;

describe('studentMonthlyCharge (service)', () => {
  it('charges the full monthly cost for an ongoing month', () => {
    expect(
      studentMonthlyCharge(
        succeed({ package_start_date: '2026-05-01T00:00:00' }),
        2026,
        6,
      ),
    ).toBe(362);
  });

  it('charges full when started on the 1st', () => {
    expect(
      studentMonthlyCharge(
        succeed({ package_start_date: '2026-07-01T00:00:00' }),
        2026,
        6,
      ),
    ).toBe(362);
  });

  it('charges zero before the package starts', () => {
    expect(
      studentMonthlyCharge(
        succeed({ package_start_date: '2026-08-01T00:00:00' }),
        2026,
        6,
      ),
    ).toBe(0);
  });

  it('charges full for a legacy student with no start date', () => {
    expect(studentMonthlyCharge(succeed(), 2026, 6)).toBe(362);
  });

  it('charges zero for an unconfigured custom package', () => {
    expect(
      studentMonthlyCharge(succeed({ package: Package.CUSTOM }), 2026, 6),
    ).toBe(0);
  });

  it('prorates the first partial month from the sessions received', () => {
    // July 2026 Wednesdays: 1, 8, 15, 22, 29. Start Jul 15 → 3 remaining →
    // perSession round(400*12/52,2)=92.31 → round(92.31*3,2)=276.93.
    const student = {
      package: Package.CUSTOM,
      custom_monthly_cost: 400,
      custom_sessions_per_week: 1,
      custom_session_length_min: 45,
      package_start_date: '2026-07-15T00:00:00',
      schedule: [
        { weekday: 'WEDNESDAY', start_time: '10:00', end_time: '10:45' },
      ],
    } as Student;
    expect(studentMonthlyCharge(student, 2026, 6)).toBe(276.93);
  });

  it('charges one per-session cost when a single session remains (regression)', () => {
    // Succeed $362 → 83.54/wk → 41.77/session. June 2026: starting Tue Jun 30
    // (Tue/Thu schedule) leaves one session → $41.77, not $27.84.
    const student = succeed({
      package_start_date: '2026-06-30T00:00:00',
      schedule: [
        { weekday: 'TUESDAY', start_time: '10:00', end_time: '10:30' },
        { weekday: 'THURSDAY', start_time: '10:00', end_time: '10:30' },
      ] as Student['schedule'],
    });
    expect(studentMonthlyCharge(student, 2026, 5)).toBe(41.77);
  });

  it('falls back to full cost when a mid-month starter has no schedule', () => {
    expect(
      studentMonthlyCharge(
        succeed({ package_start_date: '2026-07-31T00:00:00' }),
        2026,
        6,
      ),
    ).toBe(362);
  });
});
